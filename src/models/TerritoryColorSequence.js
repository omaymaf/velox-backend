const mongoose = require('mongoose');

const territoryColorSequenceSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'territory-colors' },
    value: { type: Number, default: 0 },
  },
  { versionKey: false },
);

module.exports = mongoose.model('TerritoryColorSequence', territoryColorSequenceSchema);
