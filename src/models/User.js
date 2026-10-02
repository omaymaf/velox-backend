const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const hardwareSchema = new mongoose.Schema(
  { name: String, status: String },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: false, minlength: 6, select: false },
    displayName: { type: String, trim: true, default: '' },
    avatarUrl: { type: String, default: '' },
    club: { type: String, default: '' },
    xp: { type: Number, default: 0, min: 0 },
    level: { type: Number, default: 1, min: 1 },
    gpsGranted: { type: Boolean, default: false },
    stats: {
      totalDistanceKm: { type: Number, default: 0 },
      totalElevationM: { type: Number, default: 0 },
      bestPower5s: { type: Number, default: 0 },
      zonesSecured: { type: Number, default: 0 },
    },
    hardware: { type: [hardwareSchema], default: [] },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
