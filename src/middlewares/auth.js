const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken } = require('../utils/token');

// Protege une route : exige l'en-tete  Authorization: Bearer <token>
const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Authentification requise');

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new ApiError(401, 'Token invalide ou expire');
  }

  const user = await User.findById(payload.id);
  if (!user) throw new ApiError(401, 'Utilisateur introuvable');
  if (!user.territoryColor) await user.save();
  req.user = user;
  next();
});

module.exports = { protect };
