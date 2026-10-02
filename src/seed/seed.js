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

const territories = [
  { slug: 'bastille-4', tacticalId: 'SEC-04B', name: 'Zone: Bastille Sector 4', shortName: 'BASTILLE SECTOR 4', status: 'CONTESTED', ownerName: 'Marc_Sprint', areaKm2: 2.8, defenseLevel: 'Lvl 4 Shield', rewardXp: 250, controlPercent: 64, color: 'magenta', center: { label: 'Place de la Bastille, Paris', lat: 48.853, lng: 2.3698 } },
  { slug: 'republique-02', tacticalId: 'SEC-02D', name: 'Zone: République D-02', shortName: 'REPUBLIQUE D-02', status: 'SECURED', ownerName: 'Alex_Velox', areaKm2: 5.4, defenseLevel: 'Lvl 5 Bastion', rewardXp: 180, controlPercent: 98, color: 'lime', center: { label: 'Place de la République, Paris', lat: 48.8675, lng: 2.3638 }, _ownerIsDemo: true },
  { slug: 'marais-01', tacticalId: 'SEC-01S', name: 'Zone: Marais S-01', shortName: 'MARAIS S-01', status: 'SECURED', ownerName: 'Alex_Velox', areaKm2: 4.2, defenseLevel: 'Lvl 6 Fortress', rewardXp: 150, controlPercent: 100, color: 'cyan', center: { label: 'Le Marais, Paris', lat: 48.8575, lng: 2.358 }, _ownerIsDemo: true },
  { slug: 'neutral-12', tacticalId: 'SEC-12N', name: 'Zone: Neutral Sector 12', shortName: 'NEUTRAL SECTOR 12', status: 'NEUTRAL', ownerName: 'Unclaimed', areaKm2: 3.1, defenseLevel: 'No Shield', rewardXp: 300, controlPercent: 0, color: 'neutral', center: { label: 'Gare de Lyon, Paris', lat: 48.846, lng: 2.378 } },
];

const pois = [
  { slug: 'pont-neuf', name: 'Pont Neuf Arch', category: 'Target Landmark', distanceMeters: 350, xpReward: 50, isTarget: true, corridorHint: 'Follow glowing cyan corridor via Quai des Orfèvres', coords: { top: '480px', left: '225px' }, location: { lat: 48.8570, lng: 2.3413 } },
  { slug: 'clock-tower', name: 'Clock Tower', category: 'Historic Monument', distanceMeters: 620, xpReward: 75, corridorHint: 'Continue north along Boulevard du Palais sprint lane', coords: { top: '340px', left: '285px' }, location: { lat: 48.8559, lng: 2.3452 } },
  { slug: 'st-paul-vaults', name: 'St. Paul Vaults', category: 'Historic Monument', distanceMeters: 480, xpReward: 50, corridorHint: 'Head east through the Marais side streets', coords: { top: '540px', left: '140px' }, location: { lat: 48.8553, lng: 2.3622 } },
  { slug: 'place-des-vosges', name: 'Place des Vosges', category: 'Historic Monument', distanceMeters: 900, xpReward: 50, corridorHint: 'Ride the arcades north-east of Rue de Rivoli', coords: { top: '750px', left: '50px' }, location: { lat: 48.8555, lng: 2.3658 } },
];

async function run() {
  await connectDB();

  if (process.argv.includes('--reset')) {
    await Promise.all([User.deleteMany(), Ride.deleteMany(), Territory.deleteMany(), Poi.deleteMany(), PoiVisit.deleteMany(), Post.deleteMany()]);
    console.log('[seed] Collections videes');
  }

  // Comptes de demo (le mot de passe est hache automatiquement par le modele)
  const ensureUser = async (data) => {
    let u = await User.findOne({ email: data.email });
    if (!u) u = await User.create(data);
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

  for (const t of territories) {
    const { _ownerIsDemo, ...data } = t;
    const owner = _ownerIsDemo ? alex._id : data.ownerName === 'Marc_Sprint' ? marc._id : null;
    await Territory.findOneAndUpdate({ slug: data.slug }, { ...data, owner }, { upsert: true, new: true });
  }
  for (const p of pois) await Poi.findOneAndUpdate({ slug: p.slug }, p, { upsert: true, new: true });

  if ((await Post.countDocuments()) === 0) {
    await Post.create([
      { author: clara._id, title: 'Canal Saint-Martin Sprint Loop', category: 'Sprint', distanceKm: 12.4, elevationM: 85, thirdMetricLabel: 'Avg Pace', thirdMetricValue: '34.2', thirdMetricUnit: 'KM/H', footerIcon: 'group', footerText: '6 riders pacing now', accentColor: 'lime', kudosBy: Array(1).fill(thomas._id) },
      { author: thomas._id, title: 'Montmartre Climber Challenge', category: 'Climb', distanceKm: 8.2, elevationM: 210, thirdMetricLabel: 'Max Grade', thirdMetricValue: '14.8', thirdMetricUnit: '%', footerIcon: 'local_fire_department', footerText: 'Gradient King segment', accentColor: 'cyan', kudosBy: [clara._id, marc._id] },
      { author: alex._id, title: 'Evening Urban Sprint • Paris Bastille Loop', category: 'Trending', distanceKm: 10.4, elevationM: 145, thirdMetricLabel: 'Max Peak', thirdMetricValue: '41.5', thirdMetricUnit: 'KM/H', footerText: 'New 10km PB Record (-1:15)', accentColor: 'magenta', kudosBy: [alex._id, clara._id] },
    ]);
  }

  console.log('[seed] Termine. Comptes de demo : alex@velox.app / clara@velox.app / thomas@velox.app / marc@velox.app  (mot de passe : velox1234)');
  await mongoose.disconnect();
}

run().catch((e) => { console.error(e); process.exit(1); });
