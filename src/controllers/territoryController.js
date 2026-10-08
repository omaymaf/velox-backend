const mongoose = require('mongoose');
const Territory = require('../models/Territory');
const Ride = require('../models/Ride');
const TerritoryTrackingSession = require('../models/TerritoryTrackingSession');
const TerritoryConquest = require('../models/TerritoryConquest');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { applyXp } = require('../utils/xp');
const { getUserColor } = require('../utils/userColor');
const { serializeTerritory } = require('../utils/serializeTerritory');
const { buildRoadSegments } = require('../utils/roadSegments');
const { isValidConquestAccuracy } = require('../utils/gpsAccuracy');
const { routeMetrics, routeLengthKm, simplifyCoordinates } = require('../utils/geo');
const { buildAreaPolygon, isClosedLoop } = require('../utils/loopGeometry');
const { snapCoordinates } = require('../services/googleRoadsService');

const ROAD_ROUTE_SOURCES = ['GPS_MAP_MATCHED', 'VALHALLA_OSM_BICYCLE'];

const validateSessionId = (id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(400, 'Identifiant de session GPS invalide');
};

exports.list = asyncHandler(async (req, res) => {
  const territories = await Territory.find({
    routeSource: { $in: ROAD_ROUTE_SOURCES },
    routeCoordinates: { $exists: true, $ne: [] },
  })
    .populate('owner', 'territoryColor')
    .populate('creator', 'territoryColor')
    .sort({ createdAt: -1 });
  res.json({ success: true, territories: territories.map((territory) => serializeTerritory(territory, req.user)) });
});

exports.getOne = asyncHandler(async (req, res) => {
  const territory = await Territory.findOne({
    slug: req.params.slug,
    routeSource: { $in: ROAD_ROUTE_SOURCES },
    routeCoordinates: { $exists: true, $ne: [] },
  })
    .populate('owner', 'territoryColor')
    .populate('creator', 'territoryColor');
  if (!territory) throw new ApiError(404, 'Territoire introuvable');
  res.json({ success: true, territory: serializeTerritory(territory, req.user) });
});

exports.startTracking = asyncHandler(async (req, res) => {
  const { purpose, location } = req.body;
  if (!isValidConquestAccuracy(location.accuracy)) {
    throw new ApiError(422, 'La precision GPS recue est invalide');
  }
  const session = await TerritoryTrackingSession.create({
    user: req.user._id,
    purpose,
    locations: [location],
    startPoint: { lat: location.latitude, lng: location.longitude },
    gpsUncertain: location.accuracy > 50,
  });
  res.status(201).json({ success: true, trackingId: String(session._id) });
});

exports.appendLocations = asyncHandler(async (req, res) => {
  validateSessionId(req.params.id);
  const session = await TerritoryTrackingSession.findOne({
    _id: req.params.id,
    user: req.user._id,
    status: 'ACTIVE',
  });
  if (!session) throw new ApiError(404, 'Session GPS active introuvable');
  const merged = new Map(session.locations.map((location) => [location.timestamp, location.toObject()]));
  const validLocations = req.body.locations.filter((location) =>
    isValidConquestAccuracy(location.accuracy)
  );
  for (const location of validLocations) {
    const existing = merged.get(location.timestamp);
    if (!existing || location.accuracy < existing.accuracy) merged.set(location.timestamp, location);
  }
  if (merged.size > 15000) throw new ApiError(413, 'La session GPS depasse la limite de points autorisee');

  const locations = [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
  session.locations = locations;
  session.gpsUncertain ||= req.body.locations.some((location) =>
    !isValidConquestAccuracy(location.accuracy)
  );
  await session.save();
  res.json({ success: true, count: locations.length });
});

exports.finishTracking = asyncHandler(async (req, res) => {
  validateSessionId(req.params.id);
  const session = await TerritoryTrackingSession.findOne({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!session) throw new ApiError(404, 'Session GPS introuvable');
  if (session.status === 'COMPLETE') {
    res.json({
      success: true,
      trackingId: String(session._id),
      coordinates: session.coordinates,
      startPoint: session.startPoint,
      distanceKm: session.distanceKm,
      gpsUncertain: session.gpsUncertain,
      loopClosed: session.loopClosed,
    });
    return;
  }
  if (session.status !== 'ACTIVE') throw new ApiError(409, 'Cette session GPS ne peut plus etre terminee');

  const rawCoordinates = session.locations.map(({ latitude, longitude }) => [latitude, longitude]);
  if (rawCoordinates.length < 4 || routeLengthKm(rawCoordinates) < 0.2) {
    throw new ApiError(422, 'Le parcours GPS doit contenir au moins 200 m et 4 positions');
  }
  if (session.locations.some((location) =>
    !isValidConquestAccuracy(location.accuracy)
  )) {
    throw new ApiError(422, 'La precision GPS du parcours est insuffisante pour valider cette conquete');
  }

  const rawLoopClosed = isClosedLoop(rawCoordinates);
  const matched = await snapCoordinates(simplifyCoordinates(rawCoordinates), rawLoopClosed);
  session.coordinates = matched.coordinates;
  session.distanceKm = Number(routeLengthKm(matched.coordinates).toFixed(2));
  session.gpsUncertain ||= matched.gpsUncertain;
  session.startPoint = {
    lat: matched.coordinates[0][0],
    lng: matched.coordinates[0][1],
  };
  session.status = 'COMPLETE';
  session.endTime = new Date();
  session.loopClosed = rawLoopClosed && isClosedLoop(matched.coordinates);
  await session.save();

  res.json({
    success: true,
    trackingId: String(session._id),
    coordinates: session.coordinates,
    startPoint: session.startPoint,
    distanceKm: session.distanceKm,
    gpsUncertain: session.gpsUncertain,
    loopClosed: session.loopClosed,
  });
});

exports.abandonTracking = asyncHandler(async (req, res) => {
  validateSessionId(req.params.id);
  const session = await TerritoryTrackingSession.findOne({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!session) throw new ApiError(404, 'Session GPS introuvable');
  if (session.status === 'ACTIVE') {
    session.status = 'ABANDONED';
    await session.save();
  }
  res.json({ success: true });
});

exports.create = asyncHandler(async (req, res) => {
  const session = await TerritoryTrackingSession.findOne({
    _id: req.body.trackingId,
    user: req.user._id,
    purpose: 'CREATE_TERRITORY',
    status: 'COMPLETE',
  });
  if (!session) throw new ApiError(422, 'Une session GPS de creation terminee est requise');

  const routeCoordinates = session.coordinates.map((point) => [...point]);
  if (routeCoordinates.length < 2 || session.distanceKm < 0.2) {
    throw new ApiError(422, 'Le trace routier est insuffisant pour creer un territoire');
  }
  const closedLoop = Boolean(session.loopClosed && isClosedLoop(routeCoordinates));
  const area = closedLoop ? buildAreaPolygon(routeCoordinates) : null;
  if (closedLoop && !area) {
    throw new ApiError(422, 'Le contour ferme est invalide ou se croise et ne peut pas definir une surface');
  }
  const metrics = routeMetrics(routeCoordinates);
  const slugBase = req.body.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'territoire';
  const slug = `${slugBase}-${new mongoose.Types.ObjectId().toString().slice(-8)}`;
  const rewardXp = 250;
  const durationSec = Math.max(
    0,
    Math.round((session.locations[session.locations.length - 1].timestamp - session.locations[0].timestamp) / 1000),
  );

  const territory = await Territory.create({
    slug,
    tacticalId: `TN-${slug.slice(-6).toUpperCase()}`,
    name: req.body.name,
    shortName: req.body.name.toUpperCase().slice(0, 24),
    creator: req.user._id,
    creatorName: req.user.username,
    owner: req.user._id,
    ownerName: req.user.username,
    status: 'SECURED',
    areaKm2: area?.areaKm2 || 0,
    isClosedLoop: closedLoop,
    areaPolygon: area?.areaPolygon || [],
    perimeterKm: session.distanceKm,
    defenseLevel: 'Lvl 1 Shield',
    rewardXp,
    controlPercent: 100,
    color: getUserColor(req.user._id, req.user.territoryColor),
    routeSource: 'GPS_MAP_MATCHED',
    routeCoordinates,
    segments: buildRoadSegments(routeCoordinates, req.user, req.user.username),
    startPoint: session.startPoint,
    distanceKm: session.distanceKm,
    durationSec,
    gpsUncertain: session.gpsUncertain,
    conquestCount: 0,
    center: {
      label: req.body.name,
      lat: metrics.center.lat,
      lng: metrics.center.lng,
    },
  });

  const ride = await Ride.create({
    user: req.user._id,
    title: `Création: ${req.body.name}`,
    subtitle: `Nouvelle route de ${session.distanceKm.toFixed(2)} km`,
    mode: 'CONQUEST',
    targetDistanceKm: session.distanceKm,
    xpReward: rewardXp,
    distanceKm: session.distanceKm,
    durationSec,
    avgSpeedKmh: durationSec > 0
      ? Number(((session.distanceKm / durationSec) * 3600).toFixed(1))
      : 0,
    territory: territory._id,
    xpEarned: rewardXp,
  });

  await TerritoryConquest.create({
    user: req.user._id,
    territory: territory._id,
    trackingSession: session._id,
    ride: ride._id,
    startTime: session.startTime,
    endTime: session.endTime,
    distanceKm: session.distanceKm,
    loopClosed: session.loopClosed,
    areaPolygon: territory.areaPolygon,
    segmentsCaptured: territory.segments.length,
    coordinates: routeCoordinates,
    segments: territory.segments,
    previousOwner: null,
    newOwner: req.user._id,
    color: getUserColor(req.user._id, req.user.territoryColor),
    status: 'CREATED',
  });

  const progress = applyXp(req.user, rewardXp);
  req.user.stats.zonesSecured += 1;
  req.user.stats.totalDistanceKm = Number((req.user.stats.totalDistanceKm + session.distanceKm).toFixed(2));
  session.status = 'CONSUMED';
  await session.save();
  await req.user.save();

  res.status(201).json({
    success: true,
    territory: serializeTerritory(territory, req.user),
    ride,
    xpEarned: rewardXp,
    progress,
    user: req.user,
  });
});

exports.serialize = serializeTerritory;
