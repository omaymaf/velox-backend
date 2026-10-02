const Ride = require('../models/Ride');
const asyncHandler = require('../utils/asyncHandler');
const { nextLevelXp } = require('../utils/xp');

exports.getMe = asyncHandler(async (req, res) => {
  const u = req.user;
  res.json({ success: true, user: u, nextLevelXp: nextLevelXp(u.level) });
});

exports.updateMe = asyncHandler(async (req, res) => {
  Object.assign(req.user, req.body);
  await req.user.save();
  res.json({ success: true, user: req.user });
});

exports.setGps = asyncHandler(async (req, res) => {
  req.user.gpsGranted = req.body.gpsGranted;
  await req.user.save();
  res.json({ success: true, user: req.user });
});

// Telemetrie des 7 derniers jours (carte "WEEKLY TELEMETRY" de l'ecran Home)
exports.weekly = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const prev = new Date(Date.now() - 14 * 24 * 3600 * 1000);

  const agg = (from, to) =>
    Ride.aggregate([
      { $match: { user: req.user._id, createdAt: { $gte: from, ...(to ? { $lt: to } : {}) } } },
      {
        $group: {
          _id: null,
          distanceKm: { $sum: '$distanceKm' },
          durationSec: { $sum: '$durationSec' },
          elevationM: { $sum: '$elevationM' },
          avgPowerW: { $avg: '$avgPowerW' },
          rides: { $sum: 1 },
        },
      },
    ]);

  const [[cur], [old]] = await Promise.all([agg(since), agg(prev, since)]);
  const c = cur || { distanceKm: 0, durationSec: 0, elevationM: 0, avgPowerW: 0, rides: 0 };
  const hours = c.durationSec / 3600;
  const changePct = old && old.distanceKm > 0 ? ((c.distanceKm - old.distanceKm) / old.distanceKm) * 100 : null;

  res.json({
    success: true,
    weekly: {
      distanceKm: Number(c.distanceKm.toFixed(1)),
      durationSec: c.durationSec,
      elevationM: Math.round(c.elevationM),
      avgSpeedKmh: hours > 0 ? Number((c.distanceKm / hours).toFixed(1)) : 0,
      avgPowerW: Math.round(c.avgPowerW || 0),
      rides: c.rides,
      distanceChangePct: changePct === null ? null : Number(changePct.toFixed(1)),
    },
  });
});
