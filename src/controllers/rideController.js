const Ride = require('../models/Ride');
const Territory = require('../models/Territory');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { applyXp } = require('../utils/xp');

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
    territory = await Territory.findOne({ slug: b.territoryId }).catch(() => null);
    if (!territory) throw new ApiError(404, 'Territoire introuvable');
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

  // Mode conquete : on fait progresser le controle de la zone
  let territoryResult = null;
  if (territory && b.mode === 'CONQUEST') {
    const wasMine = String(territory.owner) === String(user._id);
    territory.controlPercent = Math.min(100, territory.controlPercent + 20);
    if (!wasMine && territory.controlPercent >= 50) {
      territory.owner = user._id;
      territory.ownerName = user.username;
      territory.status = 'SECURED';
      territory.color = 'lime';
      user.stats.zonesSecured += 1;
    }
    await territory.save();
    territoryResult = territory;
  }

  await user.save();

  res.status(201).json({
    success: true,
    ride,
    progress: { ...progress, leveledUp: user.level > before },
    user,
    territory: territoryResult,
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
