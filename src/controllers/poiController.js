const Poi = require('../models/Poi');
const PoiVisit = require('../models/PoiVisit');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { applyXp } = require('../utils/xp');

exports.list = asyncHandler(async (req, res) => {
  const [pois, visits] = await Promise.all([
    Poi.find().sort({ distanceMeters: 1 }),
    PoiVisit.find({ user: req.user._id }).select('poi'),
  ]);
  const visitedIds = new Set(visits.map((v) => String(v.poi)));

  res.json({
    success: true,
    pois: pois.map((p) => {
      const visited = visitedIds.has(String(p._id));
      return {
        id: p.slug,
        name: p.name,
        category: visited ? 'Verified Landmark' : p.category,
        distanceMeters: visited ? 0 : p.distanceMeters,
        xpReward: p.xpReward,
        visited,
        isTarget: p.isTarget,
        corridorHint: visited ? 'Landmark already captured in current session' : p.corridorHint,
        coords: p.coords,
      };
    }),
  });
});

exports.checkIn = asyncHandler(async (req, res) => {
  const poi = await Poi.findOne({ slug: req.params.slug });
  if (!poi) throw new ApiError(404, 'POI introuvable');

  try {
    await PoiVisit.create({ user: req.user._id, poi: poi._id });
  } catch (err) {
    if (err.code === 11000) throw new ApiError(409, 'POI deja valide');
    throw err;
  }

  const progress = applyXp(req.user, poi.xpReward);
  await req.user.save();
  res.status(201).json({ success: true, xpGained: poi.xpReward, progress, user: req.user });
});
