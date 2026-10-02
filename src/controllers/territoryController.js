const Territory = require('../models/Territory');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const serialize = (t, userId) => {
  const o = t.toObject();
  const mine = userId && t.owner && String(t.owner) === String(userId);
  return {
    id: o.slug,
    tacticalId: o.tacticalId,
    name: o.name,
    shortName: o.shortName,
    status: o.status,
    owner: mine ? `${o.ownerName} (You)` : o.ownerName,
    areaKm2: o.areaKm2,
    defenseLevel: o.defenseLevel,
    rewardXp: o.rewardXp,
    controlPercent: o.controlPercent,
    color: o.color,
    center: o.center,
  };
};

exports.list = asyncHandler(async (req, res) => {
  const territories = await Territory.find().sort({ tacticalId: 1 });
  res.json({ success: true, territories: territories.map((t) => serialize(t, req.user._id)) });
});

exports.getOne = asyncHandler(async (req, res) => {
  const t = await Territory.findOne({ slug: req.params.slug });
  if (!t) throw new ApiError(404, 'Territoire introuvable');
  res.json({ success: true, territory: serialize(t, req.user._id) });
});

exports.serialize = serialize;
