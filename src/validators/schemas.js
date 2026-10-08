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

const gpsLocation = z.object({
  latitude: z.number().min(30).max(37.6),
  longitude: z.number().min(7.4).max(11.7),
  accuracy: z.number().min(0).max(1000),
  speed: z.number().min(0).nullable().optional(),
  timestamp: z.number().int().positive(),
});
const coordinate = z.tuple([
  z.number().min(30).max(37.6),
  z.number().min(7.4).max(11.7),
]);

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
  trackingId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  routeCoordinates: z.array(coordinate).max(5000).optional(),
});

const startTerritoryTracking = z.object({
  purpose: z.enum(['CREATE_TERRITORY', 'CONQUEST']),
  location: gpsLocation,
});
const appendTerritoryLocations = z.object({
  locations: z.array(gpsLocation).min(1).max(1000),
});
const createTerritory = z.object({
  name: z.string().trim().min(2).max(50),
  trackingId: z.string().regex(/^[a-f\d]{24}$/i),
});
const snapToRoads = z.object({
  coordinates: z.array(coordinate).min(2).max(5000),
  closeLoop: z.boolean().optional(),
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
  startTerritoryTracking,
  appendTerritoryLocations,
  createTerritory,
  snapToRoads,
  createPost,
  coach,
  googleLogin,
};
