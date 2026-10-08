const env = require('../config/env');
const { distanceMeters } = require('./geo');

const EARTH_RADIUS_METERS = 6371008.8;

function isClosedLoop(coordinates, thresholdMeters = env.TERRITORY_LOOP_CLOSURE_METERS) {
  return Array.isArray(coordinates) &&
    coordinates.length >= 4 &&
    distanceMeters(coordinates[0], coordinates[coordinates.length - 1]) <= thresholdMeters;
}

function calculatePolygonAreaKm2(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [latitude1, longitude1] = ring[index].map((value) => value * Math.PI / 180);
    const [latitude2, longitude2] = ring[index + 1].map((value) => value * Math.PI / 180);
    sum += (longitude2 - longitude1) * (2 + Math.sin(latitude1) + Math.sin(latitude2));
  }
  return Math.abs(sum * EARTH_RADIUS_METERS ** 2 / 2) / 1_000_000;
}

function hasAreaExtent(ring) {
  const origin = ring[0];
  const baselineIndex = ring.findIndex((point, index) =>
    index > 0 && (point[0] !== origin[0] || point[1] !== origin[1])
  );
  if (baselineIndex < 0) return false;

  const baseline = ring[baselineIndex];
  for (let index = baselineIndex + 1; index < ring.length - 1; index += 1) {
    const cross =
      (baseline[0] - origin[0]) * (ring[index][1] - origin[1]) -
      (baseline[1] - origin[1]) * (ring[index][0] - origin[0]);
    if (Math.abs(cross) > 1e-12) return true;
  }
  return false;
}

function buildAreaPolygon(coordinates, thresholdMeters = env.TERRITORY_LOOP_CLOSURE_METERS) {
  if (!isClosedLoop(coordinates, thresholdMeters)) return null;

  const ring = coordinates.map((point) => [...point]);
  ring[ring.length - 1] = [...ring[0]];
  const distinctVertices = new Set(ring.slice(0, -1).map(([lat, lng]) => `${lat},${lng}`));
  if (distinctVertices.size < 3 || !hasAreaExtent(ring)) return null;

  const areaKm2 = calculatePolygonAreaKm2(ring);
  if (!Number.isFinite(areaKm2)) return null;
  return { areaPolygon: ring, areaKm2: Number(areaKm2.toFixed(6)) };
}

module.exports = { buildAreaPolygon, isClosedLoop, calculatePolygonAreaKm2 };
