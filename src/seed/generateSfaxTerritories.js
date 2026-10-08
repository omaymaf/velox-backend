const fs = require('node:fs/promises');
const path = require('node:path');
const { decodePolyline6 } = require('../utils/polyline');
const { distanceMeters, isTunisiaPosition, routeLengthKm } = require('../utils/geo');

const OUTPUT_PATH = path.join(__dirname, 'sfaxTerritories.json');
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const USER_AGENT = 'VELOX territory route generator/1.0';

const places = [
  { key: 'bab-jebli', query: 'Bab Jebli, Sfax, Tunisia' },
  { key: 'bab-diwan', query: 'Bab Diwan, Sfax, Tunisia' },
  { key: 'municipal-theatre', query: 'Sfax Municipal Theatre, Tunisia' },
  { key: 'railway-station', query: 'Sfax railway station, Tunisia' },
  { key: 'route-de-tunis', query: 'Route de Tunis, Sfax, Tunisia' },
  { key: 'el-ain', query: 'El Ain, Sfax, Tunisia' },
  { key: 'sakiet-ezzit', query: 'Sakiet Ezzit, Sfax, Tunisia' },
];

const territories = [
  {
    slug: 'sfax-centre-bab-jebli',
    name: 'Sfax Centre - Bab Jebli',
    ownerEmail: 'clara@velox.app',
    creatorEmail: 'clara@velox.app',
    status: 'SECURED',
    controlPercent: 100,
    rewardXp: 220,
    defenseLevel: 'Lvl 2 Shield',
    waypoints: ['bab-jebli', 'municipal-theatre', 'railway-station', 'route-de-tunis', 'bab-jebli'],
  },
  {
    slug: 'sfax-centre-bab-diwan',
    name: 'Sfax Centre - Bab Diwan',
    ownerEmail: 'thomas@velox.app',
    creatorEmail: 'thomas@velox.app',
    status: 'SECURED',
    controlPercent: 100,
    rewardXp: 200,
    defenseLevel: 'Lvl 1 Shield',
    waypoints: ['bab-diwan', 'route-de-tunis', 'bab-jebli', 'railway-station', 'bab-diwan'],
  },
  {
    slug: 'sfax-sud-el-ain',
    name: 'Sfax Sud - El Ain',
    ownerEmail: null,
    creatorEmail: 'marc@velox.app',
    status: 'NEUTRAL',
    controlPercent: 0,
    rewardXp: 260,
    defenseLevel: 'No Shield',
    waypoints: ['el-ain', 'bab-jebli', 'municipal-theatre', 'railway-station', 'el-ain'],
  },
  {
    slug: 'sfax-est-sakiet-ezzit',
    name: 'Sfax Est - Sakiet Ezzit',
    ownerEmail: null,
    creatorEmail: 'alex@velox.app',
    status: 'NEUTRAL',
    controlPercent: 0,
    rewardXp: 280,
    defenseLevel: 'No Shield',
    waypoints: ['sakiet-ezzit', 'route-de-tunis', 'bab-diwan', 'railway-station', 'sakiet-ezzit'],
  },
];

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

async function geocodePlaces() {
  const results = new Map();
  for (const [index, place] of places.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', place.query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'tn');
    const [result] = await fetchJson(url, `OSM geocoder for "${place.query}"`);
    if (!result) throw new Error(`OSM geocoder could not find "${place.query}"`);

    const point = { lat: Number(result.lat), lon: Number(result.lon) };
    if (!isTunisiaPosition([point.lat, point.lon])) {
      throw new Error(`OSM geocoder resolved "${place.query}" outside Tunisia`);
    }
    results.set(place.key, {
      query: place.query,
      displayName: result.display_name,
      osmType: result.osm_type,
      osmId: result.osm_id,
      ...point,
    });
  }
  return results;
}

async function routeLoop(territory, geocodedPlaces) {
  const url = new URL(VALHALLA_URL);
  const request = {
    locations: territory.waypoints.map((key) => {
      const place = geocodedPlaces.get(key);
      if (!place) throw new Error(`Missing geocoded waypoint "${key}" for ${territory.slug}`);
      return { lat: place.lat, lon: place.lon };
    }),
    costing: 'bicycle',
    shape_format: 'polyline6',
    units: 'kilometers',
  };
  url.searchParams.set('json', JSON.stringify(request));
  const result = await fetchJson(url, `Valhalla bicycle router for ${territory.slug}`);
  const legs = result.trip?.legs;
  if (result.trip?.status !== 0 || !Array.isArray(legs) || legs.length !== territory.waypoints.length - 1) {
    throw new Error(`Valhalla did not return every road leg for ${territory.slug}`);
  }

  const route = legs.flatMap((leg, index) =>
    decodePolyline6(leg.shape).slice(index === 0 ? 0 : 1),
  );
  if (
    route.length < 4 ||
    route.some((point) => !isTunisiaPosition(point)) ||
    distanceMeters(route[0], route[route.length - 1]) > 35
  ) {
    throw new Error(`Valhalla returned an invalid or unclosed road route for ${territory.slug}`);
  }
  route[route.length - 1] = [...route[0]];
  const distanceKm = Number(routeLengthKm(route).toFixed(3));
  if (distanceKm < 0.2 || Math.abs(distanceKm - result.trip.summary.length) > 0.1) {
    throw new Error(`Valhalla route distance validation failed for ${territory.slug}`);
  }

  return {
    ...territory,
    distanceKm,
    polylines: legs.map((leg) => leg.shape),
    routeSource: 'VALHALLA_OSM_BICYCLE',
    sourceAttribution: '© OpenStreetMap contributors; routed by Valhalla',
    waypoints: territory.waypoints.map((key) => {
      const { query, displayName, osmType, osmId } = geocodedPlaces.get(key);
      return { key, query, displayName, osmType, osmId };
    }),
  };
}

async function main() {
  const geocodedPlaces = await geocodePlaces();
  const generated = [];
  for (const territory of territories) {
    generated.push(await routeLoop(territory, geocodedPlaces));
  }
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(generated, null, 2)}\n`, 'utf8');
  console.log(`[seed] Generated ${generated.length} verified Sfax bicycle routes via Valhalla/OSM.`);
}

main().catch((error) => {
  console.error('[seed] Sfax route generation failed:', error);
  process.exitCode = 1;
});
