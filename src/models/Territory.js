const mongoose = require('mongoose');

const territorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true }, // ex: 'bastille-4' (id utilise par le front)
    tacticalId: { type: String, required: true },
    name: { type: String, required: true },
    shortName: { type: String, required: true },
    status: { type: String, enum: ['CONTESTED', 'SECURED', 'NEUTRAL'], default: 'NEUTRAL' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ownerName: { type: String, default: 'Unclaimed' },
    areaKm2: { type: Number, default: 0 },
    defenseLevel: { type: String, default: 'No Shield' },
    rewardXp: { type: Number, default: 100 },
    controlPercent: { type: Number, default: 0, min: 0, max: 100 },
    color: { type: String, enum: ['magenta', 'lime', 'cyan', 'neutral'], default: 'neutral' },
    center: {
      label: String,
      lat: Number,
      lng: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Territory', territorySchema);
