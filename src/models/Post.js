const mongoose = require('mongoose');

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ride: { type: mongoose.Schema.Types.ObjectId, ref: 'Ride', default: null },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: ['Trending', 'Sprint', 'Climb', 'Friends', 'Hardcore'], default: 'Trending' },
    distanceKm: { type: Number, default: 0 },
    elevationM: { type: Number, default: 0 },
    thirdMetricLabel: { type: String, default: 'Avg Speed' },
    thirdMetricValue: { type: String, default: '' },
    thirdMetricUnit: { type: String, default: 'KM/H' },
    footerIcon: { type: String, default: 'military_tech' },
    footerText: { type: String, default: '' },
    accentColor: { type: String, enum: ['lime', 'cyan', 'magenta'], default: 'lime' },
    kudosBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

postSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Post', postSchema);
