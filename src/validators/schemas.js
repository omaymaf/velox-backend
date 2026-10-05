const { z } = require("zod");

const register = z.object({
  username: z.string().trim().min(3).max(30),
  email: z.string().trim().email(),
  password: z.string().min(6).max(100),
  displayName: z.string().trim().max(60).optional(),
});

const login = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const updateProfile = z.object({
  displayName: z.string().trim().max(60).optional(),
  avatarUrl: z.string().url().optional(),
  club: z.string().trim().max(60).optional(),
});

const setGps = z.object({ gpsGranted: z.boolean() });

const createRide = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  mode: z.enum(["PERFORMANCE", "CONQUEST", "DISCOVERY", "FREE RIDE"]),
  targetTime: z.string().optional(),
  pbTime: z.string().optional(),
  targetDistanceKm: z.number().min(0).optional(),
  xpReward: z.number().min(0).max(5000).optional(),
  distanceKm: z.number().min(0).max(1000),
  durationSec: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600),
  avgPowerW: z.number().min(0).max(2500).optional(),
  maxPowerW: z.number().min(0).max(2500).optional(),
  elevationM: z.number().min(0).max(20000).optional(),
  territoryId: z.string().optional(),
});

const createPost = z.object({
  rideId: z.string().optional(),
  title: z.string().trim().min(1).max(120),
  category: z
    .enum(["Trending", "Sprint", "Climb", "Friends", "Hardcore"])
    .optional(),
});

const coach = z.object({
  avgWatts: z.number().optional(),
  distanceKm: z.number().optional(),
  lastRideMode: z.string().optional(),
});

// CONNEXION GOOGLE
const googleLogin = z.object({
  idToken: z.string().min(1, "Le token Google est requis"),
});

module.exports = {
  register,
  login,
  updateProfile,
  setGps,
  createRide,
  createPost,
  coach,
  googleLogin,
};
