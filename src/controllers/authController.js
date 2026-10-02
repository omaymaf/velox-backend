const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { signToken } = require('../utils/token');

exports.register = asyncHandler(async (req, res) => {
  const { username, email, password, displayName } = req.body;
  const exists = await User.findOne({ $or: [{ email }, { username }] });
  if (exists) throw new ApiError(409, 'Email ou nom d\'utilisateur deja utilise');

  const user = await User.create({ username, email, password, displayName: displayName || username });
  res.status(201).json({ success: true, token: signToken(user._id), user });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Email ou mot de passe incorrect');
  }
  res.json({ success: true, token: signToken(user._id), user });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user });
});
