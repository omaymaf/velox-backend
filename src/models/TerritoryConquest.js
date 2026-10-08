const mongoose = require('mongoose');

const territoryConquestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    territory: { type: mongoose.Schema.Types.ObjectId, ref: 'Territory', required: true, index: true },
    trackingSession: { type: mongoose.Schema.Types.ObjectId, ref: 'TerritoryTrackingSession', required: true },
    ride: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', default: null },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    distanceKm: { type: Number, required: true, min: 0 },
    loopClosed: { type: Boolean, required: true },
    areaPolygon: { type: [[Number]], default: [] },
    segmentsCaptured: { type: Number, required: true, min: 0 },
    coordinates: { type: [[Number]], required: true },
    segments: {
      type: [{
        start: { type: [Number], required: true },
        end: { type: [Number], required: true },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        ownerName: { type: String, default: 'Unclaimed' },
        color: { type: String, default: '#87909b' },
      }],
      default: [],
    },
    previousOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    newOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    color: { type: String, required: true },
    status: { type: String, enum: ['CREATED', 'CAPTURED', 'FORTIFIED'], required: true },
  },
  { timestamps: true },
);

territoryConquestSchema.index({ territory: 1, createdAt: -1 });

module.exports = mongoose.model('TerritoryConquest', territoryConquestSchema);
