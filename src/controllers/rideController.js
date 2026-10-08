const Ride = require('../models/Ride');
const Territory = require('../models/Territory');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { applyXp } = require('../utils/xp');
const TerritoryTrackingSession = require('../models/TerritoryTrackingSession');
const TerritoryConquest = require('../models/TerritoryConquest');
const { coversRoute } = require('../utils/geo');
const { applyTerritoryConquest } = require('../utils/territoryConquest');
const { serializeTerritory } = require('../utils/serializeTerritory');
const { buildRoadSegments } = require('../utils/roadSegments');

const ROAD_ROUTE_SOURCES = ['GPS_MAP_MATCHED', 'VALHALLA_OSM_BICYCLE'];

// "29:45" -> secondes ; "≤ 31:00" -> 1860 ; "N/A" -> null
const parseTime = (str) => {
  const m = /(\d{1,3}):(\d{2})/.exec(str || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

exports.createRide = asyncHandler(async (req, res) => {
  const b = req.body;
  const user = req.user;

  let territory = null;
  if (b.territoryId) {
    territory = await Territory.findOne({
      slug: b.territoryId,
      routeSource: { $in: ROAD_ROUTE_SOURCES },
      routeCoordinates: { $exists: true, $ne: [] },
    });
    if (!territory) throw new ApiError(404, 'Territoire introuvable');
  }

  let trackingSession = null;
  if (territory && b.mode === 'CONQUEST') {
    if (!b.trackingId) throw new ApiError(422, 'Une session GPS de conquete terminee est requise');
    trackingSession = await TerritoryTrackingSession.findOne({
      _id: b.trackingId,
      user: user._id,
      purpose: 'CONQUEST',
      status: 'COMPLETE',
    });
    if (!trackingSession) {
      throw new ApiError(422, 'Une session GPS de conquete terminee est requise');
    }
    if (!trackingSession.loopClosed) {
      throw new ApiError(422, 'La boucle GPS doit etre fermee avant de valider la conquete');
    }
    const territoryRoute = territory.routeCoordinates;
    if (!coversRoute(trackingSession.coordinates, territoryRoute)) {
      throw new ApiError(422, 'Le parcours GPS ne couvre pas entierement les segments routiers du territoire');
    }
  }

  const hours = b.durationSec / 3600;
  const avgSpeedKmh = hours > 0 ? Number((b.distanceKm / hours).toFixed(1)) : 0;

  // Record perso : le temps est meilleur que le PB du mode, ou meilleur que tous tes trajets precedents
  const pbSec = parseTime(b.pbTime);
  const isPersonalBest = pbSec !== null && b.durationSec > 0 && b.durationSec < pbSec;

  // Anti-triche simple : l'XP gagne ne peut pas depasser la recompense annoncee ni 5000
  const xpEarned = Math.min(b.xpReward ?? 100, 5000);

  const ride = await Ride.create({
    user: user._id,
    title: b.title,
    subtitle: b.subtitle,
    mode: b.mode,
    targetTime: b.targetTime,
    pbTime: b.pbTime,
    targetDistanceKm: b.targetDistanceKm,
    xpReward: b.xpReward,
    distanceKm: b.distanceKm,
    durationSec: b.durationSec,
    avgSpeedKmh,
    avgPowerW: b.avgPowerW || 0,
    maxPowerW: b.maxPowerW || 0,
    elevationM: b.elevationM || 0,
    territory: territory ? territory._id : null,
    xpEarned,
    isPersonalBest,
  });

  // Mise a jour du profil
  const before = user.level;
  const progress = applyXp(user, xpEarned);
  user.stats.totalDistanceKm = Number((user.stats.totalDistanceKm + b.distanceKm).toFixed(2));
  user.stats.totalElevationM += b.elevationM || 0;
  user.stats.bestPower5s = Math.max(user.stats.bestPower5s, b.maxPowerW || 0);

  // Mode conquete : le serveur ne progresse le controle qu'apres validation de la trace GPS.
  let territoryResult = null;
  if (territory && b.mode === 'CONQUEST') {
    const outcome = applyTerritoryConquest(territory, user);
    if (outcome.captured) user.stats.zonesSecured += 1;
    const territoryRoute = territory.routeCoordinates;
    territory.segments = buildRoadSegments(territoryRoute, user, user.username);
    await territory.save();
    await TerritoryConquest.create({
      user: user._id,
      territory: territory._id,
      trackingSession: trackingSession._id,
      ride: ride._id,
      startTime: trackingSession.startTime,
      endTime: trackingSession.endTime,
      distanceKm: trackingSession.distanceKm,
      loopClosed: trackingSession.loopClosed,
      areaPolygon: territory.areaPolygon || [],
      segmentsCaptured: territory.segments.length,
      coordinates: trackingSession.coordinates,
      segments: territory.segments,
      previousOwner: outcome.previousOwner,
      newOwner: user._id,
      color: outcome.ownerColor,
      status: outcome.status,
    });
    trackingSession.status = 'CONSUMED';
    await trackingSession.save();
    territoryResult = {
      territoryId: territory.slug,
      territoryName: territory.name,
      ...outcome,
      previousOwner: outcome.previousOwner ? String(outcome.previousOwner) : null,
      newOwner: String(user._id),
      defenseLevel: territory.defenseLevel,
      status: territory.status,
      rewardXp: territory.rewardXp,
      isMine: String(territory.owner) === String(user._id),
      ownerColor: serializeTerritory(territory, user).ownerColor,
      segmentsCaptured: territory.segments.length,
    };
  }

  await user.save();

  res.status(201).json({
    success: true,
    ride,
    progress: { ...progress, leveledUp: user.level > before },
    user,
    territory: territoryResult ? serializeTerritory(territory, user) : null,
    territoryConquest: territoryResult,
  });
});

exports.listMyRides = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rides = await Ride.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(limit);
  res.json({ success: true, count: rides.length, rides });
});

exports.getRide = asyncHandler(async (req, res) => {
  const ride = await Ride.findOne({ _id: req.params.id, user: req.user._id });
  if (!ride) throw new ApiError(404, 'Sortie introuvable');
  res.json({ success: true, ride });
});
