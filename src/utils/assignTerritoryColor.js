const TerritoryColorSequence = require('../models/TerritoryColorSequence');
const { PALETTE } = require('./userColor');

async function assignTerritoryColor() {
  const sequence = await TerritoryColorSequence.findOneAndUpdate(
    { _id: 'territory-colors' },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return PALETTE[(sequence.value - 1) % PALETTE.length];
}

module.exports = { assignTerritoryColor };
