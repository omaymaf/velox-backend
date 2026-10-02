const mongoose = require('mongoose');

const poiSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true }, // ex: 'pont-neuf'
    name: { type: String, required: true },
    category: { type: String, required: true },
    distanceMeters: { type: Number, default: 0 },
    xpReward: { type: Number, default: 50 },
    isTarget: { type: Boolean, default: false },
    corridorHint: { type: String, default: '' },
    coords: { top: String, left: String }, // position sur la carte "radar" du front
    location: { lat: Number, lng: Number }, // position GPS reelle
  },
  { timestamps: true }
);

module.exports = mongoose.model('Poi', poiSchema);
