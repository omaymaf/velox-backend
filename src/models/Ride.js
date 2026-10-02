const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    mode: { type: String, enum: ['PERFORMANCE', 'CONQUEST', 'DISCOVERY', 'FREE RIDE'], required: true },
    targetTime: { type: String, default: '' },
    pbTime: { type: String, default: '' },
    targetDistanceKm: { type: Number, default: 0 },
    xpReward: { type: Number, default: 0 },
    // Resultats reels de la sortie
    distanceKm: { type: Number, required: true, min: 0 },
    durationSec: { type: Number, required: true, min: 0 },
    avgSpeedKmh: { type: Number, default: 0 },
    avgPowerW: { type: Number, default: 0 },
    maxPowerW: { type: Number, default: 0 },
    elevationM: { type: Number, default: 0 },
    territory: { type: mongoose.Schema.Types.ObjectId, ref: 'Territory', default: null },
    xpEarned: { type: Number, default: 0 },
    isPersonalBest: { type: Boolean, default: false },
  },
  { timestamps: true }
);

rideSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Ride', rideSchema);
