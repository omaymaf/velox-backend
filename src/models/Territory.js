const mongoose = require('mongoose');

const territorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true }, // ex: 'bastille-4' (id utilise par le front)
    tacticalId: { type: String, required: true },
    name: { type: String, required: true },
    shortName: { type: String, required: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    creatorName: { type: String, default: '' },
    status: { type: String, enum: ['CONTESTED', 'SECURED', 'NEUTRAL'], default: 'NEUTRAL' },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ownerName: { type: String, default: 'Unclaimed' },
    challenger: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    challengerControlPercent: { type: Number, default: 0, min: 0, max: 100 },
    areaKm2: { type: Number, default: 0 },
    defenseLevel: { type: String, default: 'No Shield' },
    rewardXp: { type: Number, default: 100 },
    controlPercent: { type: Number, default: 0, min: 0, max: 100 },
    color: { type: String, default: '#87909b' },
    routeSource: {
      type: String,
      enum: ['GPS_MAP_MATCHED', 'VALHALLA_OSM_BICYCLE'],
      default: null,
    },
    routeCoordinates: { type: [[Number]], default: [] },
    isClosedLoop: { type: Boolean, default: false },
    areaPolygon: { type: [[Number]], default: [] },
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
    startPoint: {
      lat: Number,
      lng: Number,
    },
    distanceKm: { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 },
    gpsUncertain: { type: Boolean, default: false },
    conquestCount: { type: Number, default: 0 },
    center: {
      label: String,
      lat: Number,
      lng: Number,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Territory', territorySchema);
