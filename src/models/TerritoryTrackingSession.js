const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    accuracy: { type: Number, required: true },
    speed: { type: Number, default: null },
    timestamp: { type: Number, required: true },
  },
  { _id: false },
);

const trackingSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: ['CREATE_TERRITORY', 'CONQUEST'], required: true },
    status: { type: String, enum: ['ACTIVE', 'COMPLETE', 'CONSUMED', 'ABANDONED'], default: 'ACTIVE' },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date, default: null },
    loopClosed: { type: Boolean, default: false },
    locations: { type: [locationSchema], default: [] },
    coordinates: { type: [[Number]], default: [] },
    startPoint: {
      lat: Number,
      lng: Number,
    },
    gpsUncertain: { type: Boolean, default: false },
    distanceKm: { type: Number, default: 0 },
  },
  { timestamps: true },
);

trackingSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('TerritoryTrackingSession', trackingSessionSchema);
