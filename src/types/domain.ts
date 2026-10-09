/**
 * CONTRAT DE SORTIE JSON — NE PAS DIVERGER SANS VALIDER L'APP MOBILE.
 *
 * Source de verite : C:\Users\LENOVO\VeloxMobile\src\types\velox.ts
 * (les types sont repris mot pour mot : ce sont des interfaces TS de sortie,
 *  pas des schemas mongoose).
 *
 * Regle d'or : l'app lit des champs bien precis (`user._id`, `route.kudos`,
 * `weekly.distanceChangePct`, ...) et ne tolere ni champ manquant ni valeur
 * dechainee. Ne jamais "simplifier" un type de ce fichier.
 */

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Identifiants d'ecrans. `'performance-hud'` : le TIRET est la valeur wire exacte. */
export type ScreenId =
  | 'home'
  | 'modes'
  | 'conquest'
  | 'performance-hud'
  | 'discovery'
  | 'ride-complete'
  | 'community'
  | 'location-permission'
  | 'profile';

// ---------------------------------------------------------------------------
// Unions de valeurs
// ---------------------------------------------------------------------------

export type TerritoryStatus = 'CONTESTED' | 'SECURED' | 'NEUTRAL';

export type AccentColor = 'lime' | 'cyan' | 'magenta';

/** La couleur de territoire accepte en plus la valeur neutre. */
export type TerritoryColor = AccentColor | 'neutral';

export type RouteCategory = 'Trending' | 'Sprint' | 'Climb' | 'Friends' | 'Hardcore';

export type RideMode = 'PERFORMANCE' | 'CONQUEST' | 'DISCOVERY' | 'FREE RIDE';

// ---------------------------------------------------------------------------
// Conquest
// ---------------------------------------------------------------------------

/** Geometrie optionnelle (pour la carte) ; absente = zone non geolocalisee. */
export interface TerritoryCenter {
  label: string;
  lat: number;
  lng: number;
}

export interface TerritoryZone {
  id: string;
  tacticalId: string;
  name: string;
  shortName: string;
  status: TerritoryStatus;
  owner: string;
  areaKm2: number;
  defenseLevel: string;
  rewardXp: number;
  controlPercent: number;
  color: TerritoryColor;
  center?: TerritoryCenter;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface DiscoveryPoi {
  id: string;
  name: string;
  category: string;
  distanceMeters: number;
  xpReward: number;
  visited: boolean;
  isTarget?: boolean;
  corridorHint: string;
  /** Positionnement CSS sur la carte de l'app (chaines, ex. "480px"). */
  coords: { top: string; left: string };
  /**
   * Coordonnees GPS reelles, optionnelles.
   * Non consommees par l'app actuellement (elle utilise `coords`) : reservees
   * a la v2 du HUD. Ajout additif : ne casse pas le contrat existant.
   */
  lat?: number;
  lng?: number;
}

// ---------------------------------------------------------------------------
// Communaute
// ---------------------------------------------------------------------------

export interface CommunityRoute {
  id: string;
  handle: string;
  badge: string;
  title: string;
  avatarUrl: string;
  avatarAlt: string;
  kudos: number;
  liked?: boolean;
  distanceKm: number;
  elevationM: number;
  thirdMetricLabel: string;
  thirdMetricValue: string;
  thirdMetricUnit: string;
  footerIcon: string;
  footerText: string;
  accentColor: AccentColor;
  category: RouteCategory;
}

/**
 * Equivalent de `copyWith` : copie immuable d'une route, avec au moins un champ
 * modifie. Utilise pour reponses de POST /community/:id/kudos.
 */
export function copyWithRoute(route: CommunityRoute, patch: Partial<CommunityRoute>): CommunityRoute {
  return { ...route, ...patch };
}

/** Raccourci : applique un nouveau score de kudos + l'etat "liked" du viewer. */
export function withKudos(route: CommunityRoute, kudos: number, liked: boolean): CommunityRoute {
  return copyWithRoute(route, { kudos, liked });
}

// ---------------------------------------------------------------------------
// Ride / profil
// ---------------------------------------------------------------------------

export interface RideConfig {
  title: string;
  subtitle: string;
  targetTime: string;
  pbTime: string;
  targetDistanceKm: number;
  mode: RideMode;
  xpReward: number;
}

export interface RideStats {
  totalDistanceKm: number;
  totalElevationM: number;
  bestPower5s: number;
  zonesSecured: number;
}

export interface HardwareDevice {
  name: string;
  status: string;
}

export interface UserProfile {
  _id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  club: string;
  xp: number;
  level: number;
  gpsGranted: boolean;
  stats: RideStats;
  hardware: HardwareDevice[];
  /**
   * Champs d'edition du profil (PATCH /users/me/profile).
   * Optionnels : l'app affiche une valeur vide plutot que de crasher.
   */
  firstName?: string;
  lastName?: string;
  phone?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  bio?: string;
  birthDate?: string;
}

export interface WeeklyStats {
  distanceKm: number;
  durationSec: number;
  elevationM: number;
  avgSpeedKmh: number;
  avgPowerW: number;
  rides: number;
  /** null = pas de semaine precedente comparable (l'app gere le cas). */
  distanceChangePct: number | null;
}

/** Resume envoye par le HUD a la fin d'une sortie. */
export interface RideSummary {
  distanceKm: number;
  durationSec: number;
  avgPowerW: number;
  maxPowerW: number;
  elevationM: number;
}

/** Resultat renvoye par le serveur apres POST /rides. */
export interface RideResult {
  rideId: string;
  distanceKm: number;
  durationSec: number;
  avgSpeedKmh: number;
  avgPowerW: number;
  xpEarned: number;
  isPersonalBest: boolean;
  leveledUp: boolean;
  nextLevelXp: number;
}

// ---------------------------------------------------------------------------
// Serialisation : `_id` ET `id`
// ---------------------------------------------------------------------------

/** Le contrat expose `_id` ; certains clients lisent `id`. On garantit les deux. */
export type SerializedUser = UserProfile & { id: string };

/**
 * Source acceptable par `serializeUser` : un document mongoose passe au
 * travers de `toObject()`, ou un objet deja en forme.
 */
export type UserSource = Omit<UserProfile, '_id'> & { _id: unknown; id?: unknown };

/**
 * Normalise un utilisateur Mongo en JSON stable pour l'app :
 * la sortie contient TOUJOURS `_id` ET `id`, tous deux des chaines.
 */
export function serializeUser(source: UserSource): SerializedUser {
  const { _id, id, ...rest } = source;
  const stringId = _id !== undefined && _id !== null ? String(_id) : String(id);
  return { _id: stringId, id: stringId, ...rest };
}

// ---------------------------------------------------------------------------
// Coach IA
// ---------------------------------------------------------------------------

/** Reponse de POST /coach (cf. app mobile : services/geminiService.ts). */
export interface AIAnalysisResult {
  coachAdvice: string;
  recommendedWatts: number;
  cadenceFocus: string;
  nextChallenge: string;
}

// ---------------------------------------------------------------------------
// Enveloppes de reponse API
// ---------------------------------------------------------------------------

export interface UserResponse {
  user: UserProfile;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface TerritoriesResponse {
  territories: TerritoryZone[];
}

export interface PoisResponse {
  pois: DiscoveryPoi[];
}

export interface CommunityResponse {
  routes: CommunityRoute[];
}

export interface RouteResponse {
  route: CommunityRoute;
}

export interface WeeklyResponse {
  weekly: WeeklyStats;
}

export interface CoachResponse {
  coach: AIAnalysisResult;
}

/** Partie `ride` de la reponse de POST /rides (l'app lit `ride._id`). */
export interface RideCreated {
  _id: string;
  distanceKm: number;
  durationSec: number;
  avgSpeedKmh: number;
  avgPowerW: number;
  xpEarned: number;
  isPersonalBest: boolean;
}

/** Partie `progress` de la reponse de POST /rides. */
export interface RideProgress {
  nextLevelXp: number;
  leveledUp: boolean;
}

export interface RideResponse {
  ride: RideCreated;
  progress: RideProgress;
  user: UserProfile;
}

// ---------------------------------------------------------------------------
// Corps de requete (recopies depuis l'app mobile, pour la vague 2)
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

/** PATCH /users/me/profile */
export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  bio?: string;
  birthDate?: string;
}

/** PATCH /users/me/gps */
export interface UpdateGpsRequest {
  gpsGranted: boolean;
}

/** POST /rides : config de la sortie + resume du HUD, a plat. */
export interface CreateRideRequest extends RideSummary {
  title: string;
  subtitle: string;
  mode: RideMode;
  targetTime: string;
  pbTime: string;
  targetDistanceKm: number;
  xpReward: number;
  territoryId?: string;
}

/** POST /community : publication d'une sortie. */
export interface ShareRouteRequest {
  rideId: string;
  title: string;
}

/** POST /coach */
export interface CoachRequest {
  avgWatts?: number;
  distanceKm?: number;
  lastRideMode?: string;
}

/** GET /api/health */
export interface HealthResponse {
  ok: boolean;
  db: boolean;
}