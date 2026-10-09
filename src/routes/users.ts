import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { Ride } from '../models/Ride.js';
import { User, toUserProfile } from '../models/User.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import type { UpdateProfileRequest, UserResponse, WeeklyResponse, WeeklyStats } from '../types/domain.js';

/**
 * Routes utilisateur. A monter sur `/api/users`. Toutes exigent un jeton.
 *
 * Reponses : `{ user }` pour les PATCH, `{ weekly }` pour les statistiques.
 */

const DAY_MS = 86_400_000;

/** Fenetre d agregation de `/me/weekly` : 7 jours glissants. */
const WEEK_DAYS = 7;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Longueurs maximales alignees sur le schema `User`. Une valeur plus longue
 * ferait echouer `save()` : on la refuse donc en amont avec un 400 clair.
 */
const TEXT_LIMITS = {
  firstName: 60,
  lastName: 60,
  phone: 32,
  city: 80,
  postalCode: 16,
  country: 80,
  bio: 1000,
  birthDate: 10,
} as const;

type OptionalTextField = keyof typeof TEXT_LIMITS;

const OPTIONAL_TEXT_FIELDS = Object.keys(TEXT_LIMITS) as OptionalTextField[];

export const usersRouter = Router();

/** Toutes les routes de ce fichier sont privees. */
usersRouter.use(requireAuth);

/** Corps de requete garanti objet (express.json peut laisser `undefined`). */
function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

/** Chaine non vide apres trim, ou undefined si absente/vide. */
function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

/** 1 decimale (l'app affiche la valeur brute dans ses tuiles). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// PATCH /api/users/me/profile
// ---------------------------------------------------------------------------

usersRouter.patch('/me/profile', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  const body = bodyRecord(req.body);
  const updates: UpdateProfileRequest = {};

  // --- Champs texte optionnels (une chaine vide efface le champ) ---
  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (!(field in body)) continue;
    const raw = body[field];
    if (raw !== null && typeof raw !== 'string') {
      res.status(400).json({ message: `Le champ "${field}" doit etre une chaine` });
      return;
    }
    const value = trimmed(raw);
    if (value !== undefined && value.length > TEXT_LIMITS[field]) {
      res.status(400).json({ message: `Le champ "${field}" depasse ${TEXT_LIMITS[field]} caracteres` });
      return;
    }
    updates[field] = value;
  }

  // --- Email : identifiant de connexion, donc valide et unique ---
  if ('email' in body) {
    const email = trimmed(body.email)?.toLowerCase();
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ message: "L'adresse e-mail est invalide" });
      return;
    }
    if (email.length > 254) {
      res.status(400).json({ message: "L'adresse e-mail est trop longue" });
      return;
    }
    if (email !== user.email) {
      const owner = await User.findOne({ email }).exec();
      if (owner && String(owner._id) !== String(user._id)) {
        res.status(409).json({ message: 'Cette adresse e-mail est deja utilisee' });
        return;
      }
    }
    updates.email = email;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ message: 'Aucun champ modifiable dans la requete' });
    return;
  }

  // --- Application ---
  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (field in body) user.set(field, updates[field]);
  }
  if (updates.email) {
    user.email = updates.email;
  }

  // `displayName` suit prenom/nom des que l'un des deux change (l'app s'en
  // sert de repli dans `personalInfoFromUser`). Tronque plutot que d'echouer.
  if ('firstName' in body || 'lastName' in body) {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    if (fullName.length > 0) {
      user.displayName = fullName.slice(0, 80);
    }
  }

  try {
    await user.save();
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      res.status(409).json({ message: 'Cette adresse e-mail est deja utilisee' });
      return;
    }
    throw err;
  }

  const payload: UserResponse = { user: toUserProfile(user) };
  res.json(payload);
});

// ---------------------------------------------------------------------------
// PATCH /api/users/me/gps
// ---------------------------------------------------------------------------

usersRouter.patch('/me/gps', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  const body = bodyRecord(req.body);
  if (typeof body.gpsGranted !== 'boolean') {
    res.status(400).json({ message: 'Le champ "gpsGranted" doit etre un booleen' });
    return;
  }

  user.gpsGranted = body.gpsGranted;
  await user.save();

  const payload: UserResponse = { user: toUserProfile(user) };
  res.json(payload);
});

// ---------------------------------------------------------------------------
// GET /api/users/me/weekly
// ---------------------------------------------------------------------------

/** Ligne d agregation : `_id` = 0 (7 derniers jours) ou 1 (7 precedents). */
interface WeeklyBucket {
  _id: 0 | 1;
  distanceKm: number;
  durationSec: number;
  elevationM: number;
  powerWeighted: number;
  rides: number;
}

usersRouter.get('/me/weekly', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  const userId = String(user._id);
  const userFilter = mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const now = Date.now();
  const currentStart = new Date(now - WEEK_DAYS * DAY_MS);
  const previousStart = new Date(now - 2 * WEEK_DAYS * DAY_MS);

  const rows = await Ride.aggregate<WeeklyBucket>([
    { $match: { user: userFilter, createdAt: { $gte: previousStart } } },
    {
      $project: {
        week: { $cond: [{ $gte: ['$createdAt', currentStart] }, 0, 1] },
        distanceKm: 1,
        durationSec: 1,
        elevationM: 1,
        avgPowerW: 1,
      },
    },
    {
      $group: {
        _id: '$week',
        distanceKm: { $sum: '$distanceKm' },
        durationSec: { $sum: '$durationSec' },
        elevationM: { $sum: '$elevationM' },
        // Moyenne de puissance ponderee par la duree.
        powerWeighted: { $sum: { $multiply: ['$durationSec', '$avgPowerW'] } },
        rides: { $sum: 1 },
      },
    },
  ]).exec();

  const current = rows.find((row) => row._id === 0);
  const previous = rows.find((row) => row._id === 1);

  const distanceRaw = current?.distanceKm ?? 0;
  const durationRaw = current?.durationSec ?? 0;
  const previousDistance = previous?.distanceKm ?? 0;

  const weekly: WeeklyStats = {
    distanceKm: round1(distanceRaw),
    durationSec: Math.round(durationRaw),
    elevationM: Math.round(current?.elevationM ?? 0),
    avgSpeedKmh: durationRaw > 0 ? round1(distanceRaw / (durationRaw / 3600)) : 0,
    avgPowerW: durationRaw > 0 ? Math.round((current?.powerWeighted ?? 0) / durationRaw) : 0,
    rides: Math.round(current?.rides ?? 0),
    // null = pas de semaine precedente comparable (valeur attendue par l'app).
    distanceChangePct:
      previousDistance > 0 ? Math.round(((distanceRaw - previousDistance) / previousDistance) * 100) : null,
  };

  const payload: WeeklyResponse = { weekly };
  res.json(payload);
});
