// controllers/authController.js
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const asyncHandler = require("../utils/asyncHandler");
const { signToken } = require("../utils/token");
const { OAuth2Client } = require("google-auth-library");

function getGoogleClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID manquant dans le .env du backend");
  }
  return new OAuth2Client(clientId);
}

exports.register = asyncHandler(async (req, res) => {
  const { username, email, password, displayName } = req.body;
  const exists = await User.findOne({ $or: [{ email }, { username }] });
  if (exists)
    throw new ApiError(409, "Email ou nom d'utilisateur deja utilise");
  const user = await User.create({
    username,
    email,
    password,
    displayName: displayName || username,
  });
  res.status(201).json({ success: true, token: signToken(user._id), user });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, "Email ou mot de passe incorrect");
  }
  if (!user.territoryColor) await user.save();
  res.json({ success: true, token: signToken(user._id), user });
});

// NOUVELLE FONCTION GOOGLE
exports.googleLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) throw new ApiError(400, "Token Google manquant");

  const client = getGoogleClient();
  // Vérification du token auprès de Google
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  const { sub: googleId, email, name, picture } = payload;

  // Chercher l'utilisateur par googleId ou email
  let user = await User.findOne({ $or: [{ googleId }, { email }] });

  if (user) {
    // Si l'utilisateur existe mais n'a pas de googleId (inscription classique), on le lie
    if (!user.googleId) {
      user.googleId = googleId;
      if (!user.avatarUrl) user.avatarUrl = picture;
      await user.save();
    }
  } else {
    // Créer un nouvel utilisateur
    // Générer un username unique basé sur l'email ou le nom
    let baseUsername = email.split("@")[0];
    let username = baseUsername;
    let counter = 1;
    while (await User.findOne({ username })) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    user = await User.create({
      googleId,
      email,
      username,
      displayName: name,
      avatarUrl: picture,
    });
  }

  if (!user.territoryColor) await user.save();
  res.json({ success: true, token: signToken(user._id), user });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: req.user });
});
