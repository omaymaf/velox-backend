const mongoose = require('mongoose');

// Un utilisateur ne peut valider un POI qu'une seule fois (index unique).
const poiVisitSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    poi: { type: mongoose.Schema.Types.ObjectId, ref: 'Poi', required: true },
  },
  { timestamps: true }
);

poiVisitSchema.index({ user: 1, poi: 1 }, { unique: true });

module.exports = mongoose.model('PoiVisit', poiVisitSchema);
