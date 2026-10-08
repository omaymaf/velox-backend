// Remplit MongoDB avec les donnees de depart (reprises de veloxData.ts du front).
// Usage :  npm run seed         -> ajoute/maj territoires + POI + comptes de demo
//          npm run seed:reset   -> vide d'abord TOUTES les collections
require('../config/env');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Ride = require('../models/Ride');
const Territory = require('../models/Territory');
const Poi = require('../models/Poi');
const PoiVisit = require('../models/PoiVisit');
const Post = require('../models/Post');
const TerritoryConquest = require('../models/TerritoryConquest');
const TerritoryColorSequence = require('../models/TerritoryColorSequence');
const { routeMetrics, routeLengthKm, distanceMeters } = require('../utils/geo');
const { getUserColor } = require('../utils/userColor');
const { decodePolyline6 } = require('../utils/polyline');
const { buildRoadSegments } = require('../utils/roadSegments');
const { buildAreaPolygon } = require('../utils/loopGeometry');
const sfaxTerritories = require('./sfaxTerritories.json');

const pois = [
  { slug: 'pont-neuf', name: 'Pont Neuf Arch', category: 'Target Landmark', distanceMeters: 350, xpReward: 50, isTarget: true, corridorHint: 'Follow glowing cyan corridor via Quai des Orfèvres', coords: { top: '480px', left: '225px' }, location: { lat: 48.8570, lng: 2.3413 } },
  { slug: 'clock-tower', name: 'Clock Tower', category: 'Historic Monument', distanceMeters: 620, xpReward: 75, corridorHint: 'Continue north along Boulevard du Palais sprint lane', coords: { top: '340px', left: '285px' }, location: { lat: 48.8559, lng: 2.3452 } },
  { slug: 'st-paul-vaults', name: 'St. Paul Vaults', category: 'Historic Monument', distanceMeters: 480, xpReward: 50, corridorHint: 'Head east through the Marais side streets', coords: { top: '540px', left: '140px' }, location: { lat: 48.8553, lng: 2.3622 } },
  { slug: 'place-des-vosges', name: 'Place des Vosges', category: 'Historic Monument', distanceMeters: 900, xpReward: 50, corridorHint: 'Ride the arcades north-east of Rue de Rivoli', coords: { top: '750px', left: '50px' }, location: { lat: 48.8555, lng: 2.3658 } },
];

async function run() {
  await connectDB();

  if (process.argv.includes('--reset')) {
    await Promise.all([User.deleteMany(), Ride.deleteMany(), Territory.deleteMany(), TerritoryConquest.deleteMany(), TerritoryColorSequence.deleteMany(), Poi.deleteMany(), PoiVisit.deleteMany(), Post.deleteMany()]);
    console.log('[seed] Collections videes');
  }

  // Comptes de demo (le mot de passe est hache automatiquement par le modele)
  const ensureUser = async (data) => {
    let u = await User.findOne({ email: data.email });
    if (!u) u = await User.create(data);
    else if (!u.territoryColor) await u.save();
    return u;
  };

  const alex = await ensureUser({
    username: 'Alex_Velox', email: 'alex@velox.app', password: 'velox1234',
    displayName: 'Alexandre "Velox" Dupont', club: 'Paris Bastille Club',
    xp: 1840, level: 24, gpsGranted: true,
    stats: { totalDistanceKm: 1842, totalElevationM: 14250, bestPower5s: 914, zonesSecured: 8 },
    hardware: [
      { name: 'Smart Trainer: Wahoo KICKR v6', status: 'ONLINE' },
      { name: 'Heart Rate: Polar H10 (BLE)', status: 'CONNECTED' },
      { name: 'Power Meter: Favero Assioma Duo', status: 'CALIBRATED' },
    ],
  });
  const clara = await ensureUser({ username: 'Clara_Wheels', email: 'clara@velox.app', password: 'velox1234', displayName: 'Clara', xp: 3100, level: 18 });
  const thomas = await ensureUser({ username: 'Thomas_V', email: 'thomas@velox.app', password: 'velox1234', displayName: 'Thomas', xp: 5200, level: 30 });
  const marc = await ensureUser({ username: 'Marc_Sprint', email: 'marc@velox.app', password: 'velox1234', displayName: 'Marc', xp: 900, level: 12 });

  // Retire uniquement les anciens territoires fictifs qui plaçaient la carte à Paris.
  await Territory.deleteMany({
    slug: { $in: ['bastille-4', 'republique-02', 'marais-01', 'neutral-12'] },
  });

  const demoUsersByEmail = new Map(
    [alex, clara, thomas, marc].map((user) => [user.email, user]),
  );
  for (const sample of sfaxTerritories) {
    const route = sample.polylines.flatMap((encoded, index) =>
      decodePolyline6(encoded).slice(index === 0 ? 0 : 1),
    );
    if (sample.routeSource !== 'VALHALLA_OSM_BICYCLE') {
      throw new Error(`La route de demonstration ${sample.slug} n'a pas de source de routage verifiable`);
    }
    if (route.length < 4 || distanceMeters(route[0], route[route.length - 1]) > 25) {
      throw new Error(`La boucle routiere de demonstration ${sample.slug} n'est pas fermee`);
    }
    route[route.length - 1] = [...route[0]];
    const metrics = routeMetrics(route);
    const area = buildAreaPolygon(route);
    if (!area) throw new Error(`Le contour routier ferme de ${sample.slug} ne definit pas une surface valide`);
    const owner = sample.ownerEmail ? demoUsersByEmail.get(sample.ownerEmail) : null;
    const creator = demoUsersByEmail.get(sample.creatorEmail);
    if (!creator || (sample.ownerEmail && !owner)) {
      throw new Error(`Compte de demonstration manquant pour ${sample.slug}`);
    }
    await Territory.findOneAndUpdate(
      { slug: sample.slug },
      {
        slug: sample.slug,
        tacticalId: `SFX-${sample.slug.slice(-3).toUpperCase()}`,
        name: sample.name,
        shortName: sample.name.toUpperCase().slice(0, 24),
        creator: creator._id,
        creatorName: creator.username,
        owner: owner?._id || null,
        ownerName: owner?.username || 'Unclaimed',
        challenger: null,
        challengerControlPercent: 0,
        status: sample.status,
        controlPercent: sample.controlPercent,
        areaKm2: area.areaKm2,
        isClosedLoop: true,
        areaPolygon: area.areaPolygon,
        perimeterKm: metrics.perimeterKm,
        defenseLevel: sample.defenseLevel,
        rewardXp: sample.rewardXp,
        color: owner ? getUserColor(owner._id, owner.territoryColor) : '#87909b',
        routeSource: sample.routeSource,
        routeCoordinates: route,
        segments: buildRoadSegments(route, owner, owner?.username || 'Unclaimed'),
        startPoint: { lat: route[0][0], lng: route[0][1] },
        distanceKm: Number(routeLengthKm(route).toFixed(2)),
        durationSec: 0,
        gpsUncertain: false,
        conquestCount: 0,
        center: {
          label: sample.name,
          lat: metrics.center.lat,
          lng: metrics.center.lng,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
  }
  for (const p of pois) await Poi.findOneAndUpdate({ slug: p.slug }, p, { upsert: true, new: true });

  if ((await Post.countDocuments()) === 0) {
    await Post.create([
      { author: clara._id, title: 'Canal Saint-Martin Sprint Loop', category: 'Sprint', distanceKm: 12.4, elevationM: 85, thirdMetricLabel: 'Avg Pace', thirdMetricValue: '34.2', thirdMetricUnit: 'KM/H', footerIcon: 'group', footerText: '6 riders pacing now', accentColor: 'lime', kudosBy: Array(1).fill(thomas._id) },
      { author: thomas._id, title: 'Montmartre Climber Challenge', category: 'Climb', distanceKm: 8.2, elevationM: 210, thirdMetricLabel: 'Max Grade', thirdMetricValue: '14.8', thirdMetricUnit: '%', footerIcon: 'local_fire_department', footerText: 'Gradient King segment', accentColor: 'cyan', kudosBy: [clara._id, marc._id] },
      { author: alex._id, title: 'Evening Urban Sprint • Paris Bastille Loop', category: 'Trending', distanceKm: 10.4, elevationM: 145, thirdMetricLabel: 'Max Peak', thirdMetricValue: '41.5', thirdMetricUnit: 'KM/H', footerText: 'New 10km PB Record (-1:15)', accentColor: 'magenta', kudosBy: [alex._id, clara._id] },
    ]);
  }

  console.log('[seed] 4 boucles cyclables routées par Valhalla sur OpenStreetMap chargées à Sfax (2 conquises, 2 neutres).');
  console.log('[seed] Comptes de demo : alex@velox.app / clara@velox.app / thomas@velox.app / marc@velox.app  (mot de passe : velox1234)');
  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
