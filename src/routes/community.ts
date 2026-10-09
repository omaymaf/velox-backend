import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { CommunityRoute, toCommunityRoute } from '../models/CommunityRoute.js';
import { Ride } from '../models/Ride.js';
import { FIXTURE_IMAGES } from '../fixtures.js';
import type { AccentColor, CommunityResponse, RideMode, RouteCategory, RouteResponse } from '../types/domain.js';

/**
 * Fil communautaire. A monter sur `/api/community`.
 *
 * - `GET /` : toutes les routes, `liked` deduit de `likedBy` pour le viewer ;
 * - `POST /` : publication d'une sortie terminee (corps `{ rideId, title }`) ;
 * - `POST /:id/kudos` : toggle like (+/- 1 kudos).
 *
 * Le like est PAR UTILISATEUR (champ `likedBy`) alors que `kudos` est un
 * compteur global fourni par les fixtures. Invariant : `kudos === likedBy.length`,
 * maintenu par des `$addToSet` / `$pull` atomiques (voir le toggle plus bas).
 */

/** Longueur max du `title` d'une publication (aligne sur le schema). */
const TITLE_MAX = 140;

/** Longueur max d'un `id` de route (aligne sur le schema). */
const ID_MAX = 96;

/**
 * Identifiant de route valide : kebab-case ASCII, 1 a `max` caracteres.
 * Les fixtures (`canal-st-martin`) et les publications (`title-ab12cd`) sont
 * des slugs ; on refuse donc tout caractere exotique avant d'aller en base.
 */
const ROUTE_ID_RE = new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,${ID_MAX - 2}}[a-z0-9])?$`);

/**
 * Rang interne des routes publiees : -1 pour qu'elles passent devant les
 * fixtures (0, 1, 2), ce que l'app fait deja de son cote en optimiste.
 */
const USER_ROUTE_ORDER = -1;

/** Slug ASCII a partir d'un titre libre (accents retires, tirets). */
function slugify(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base.length > 0 ? base : 'ride';
}

/** Corps de requete garanti objet (express.json peut laisser `undefined`). */
function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

/** Accent et categorie derives du mode de la sortie publiee. */
function presentFromMode(mode: RideMode): { accentColor: AccentColor; category: RouteCategory } {
  switch (mode) {
    case 'CONQUEST':
      return { accentColor: 'magenta', category: 'Hardcore' };
    case 'PERFORMANCE':
      return { accentColor: 'cyan', category: 'Sprint' };
    case 'DISCOVERY':
      return { accentColor: 'lime', category: 'Climb' };
    case 'FREE RIDE':
    default:
      return { accentColor: 'lime', category: 'Trending' };
  }
}

/** true si l'erreur vient d'une violation d'unicite Mongo (index unique). */
function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** 1 decimale, comme les fixtures ("34.2"). */
function format1(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0.0';
  return (Math.round(parsed * 10) / 10).toFixed(1);
}

export const communityRouter = Router();

/** Toutes les routes de ce fichier sont privees. */
communityRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// GET /api/community
// ---------------------------------------------------------------------------

communityRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  const docs = await CommunityRoute.find().sort({ order: 1, createdAt: -1, id: 1 }).exec();
  const viewerId = String(user._id);

  const payload: CommunityResponse = {
    routes: docs.map((doc) => toCommunityRoute(doc, viewerId)),
  };
  res.json(payload);
});

// ---------------------------------------------------------------------------
// POST /api/community
// ---------------------------------------------------------------------------

communityRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  // --- Validation AVANT tout acces a la base ---
  const body = bodyRecord(req.body);

  const rawRideId = typeof body.rideId === 'string' ? body.rideId.trim() : '';
  if (rawRideId.length === 0) {
    res.status(400).json({ message: 'Le champ "rideId" est requis' });
    return;
  }
  if (!mongoose.isValidObjectId(rawRideId)) {
    res.status(400).json({ message: 'Le champ "rideId" est invalide' });
    return;
  }

  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
  if (rawTitle.length === 0) {
    res.status(400).json({ message: 'Le champ "title" est requis' });
    return;
  }
  if (rawTitle.length > TITLE_MAX) {
    res.status(400).json({ message: `Le champ "title" depasse ${TITLE_MAX} caracteres` });
    return;
  }

  const rideId = new mongoose.Types.ObjectId(rawRideId);

  const ride = await Ride.findById(rideId).exec();
  if (!ride) {
    res.status(404).json({ message: 'Sortie introuvable' });
    return;
  }
  // On ne publie que ses propres sorties (pas de fuite de donnees d'autrui).
  if (String(ride.user) !== String(user._id)) {
    res.status(403).json({ message: 'Impossible de publier la sortie d un autre utilisateur' });
    return;
  }

  const existing = await CommunityRoute.exists({ rideId });
  if (existing) {
    res.status(409).json({ message: 'Cette sortie est deja publiee' });
    return;
  }

  // Identifiant stable et unique : slug du titre + suffixe de la sortie.
  const id = `${slugify(rawTitle)}-${String(rideId).slice(-6)}`;

  const { accentColor, category } = presentFromMode(ride.mode);
  const displayName = user.displayName || user.username;

  try {
    const created = new CommunityRoute({
      id,
      handle: `@${user.username}`,
      badge: `LVL ${user.level}`,
      title: rawTitle,
      avatarUrl: user.avatarUrl || FIXTURE_IMAGES.avatarCommunityHeader,
      avatarAlt: `${displayName} sur le velo`,
      kudos: 0,
      likedBy: [],
      distanceKm: ride.distanceKm,
      elevationM: ride.elevationM,
      thirdMetricLabel: 'Avg Speed',
      thirdMetricValue: format1(ride.avgSpeedKmh),
      thirdMetricUnit: 'KM/H',
      footerIcon: 'route',
      footerText: ride.subtitle || ride.title,
      accentColor,
      category,
      user: user._id,
      rideId,
      order: USER_ROUTE_ORDER,
    });
    await created.save();

    const payload: RouteResponse = { route: toCommunityRoute(created, String(user._id)) };
    res.status(201).json(payload);
  } catch (err: unknown) {
    if (isDuplicateKey(err)) {
      res.status(409).json({ message: 'Cette sortie est deja publiee' });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /api/community/:id/kudos
// ---------------------------------------------------------------------------

communityRouter.post('/:id/kudos', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  // --- Validation AVANT tout acces a la base ---
  const rawId = typeof req.params.id === 'string' ? req.params.id.trim().toLowerCase() : '';
  if (rawId.length === 0) {
    res.status(400).json({ message: 'Identifiant de route invalide' });
    return;
  }
  if (rawId.length > ID_MAX || !ROUTE_ID_RE.test(rawId)) {
    res.status(400).json({ message: 'Identifiant de route invalide' });
    return;
  }

  const route = await CommunityRoute.findOne({ id: rawId }).exec();
  if (!route) {
    res.status(404).json({ message: 'Route introuvable' });
    return;
  }

  const userId = new mongoose.Types.ObjectId(String(user._id));
  const wasLiked = route.likedBy.some((entry) => String(entry) === String(userId));

  // Le filtre rend l'operation atomique : si deux requetes identiques
  // arrivent en meme temps, une seule modifie le document (modifiedCount 1),
  // l'autre lit l'etat deja inverse et le renvoie tel quel.
  const filter = wasLiked ? { _id: route._id, likedBy: userId } : { _id: route._id, likedBy: { $ne: userId } };
  const update = wasLiked
    ? { $pull: { likedBy: userId }, $inc: { kudos: -1 } }
    : { $addToSet: { likedBy: userId }, $inc: { kudos: 1 } };

  await CommunityRoute.updateOne(filter, update).exec();

  // Filet : un compteur incoherent (donnee heritee, double toggle ancien)
  // ne doit jamais sortir en negatif vers l'app.
  await CommunityRoute.updateOne({ _id: route._id, kudos: { $lt: 0 } }, { $set: { kudos: 0 } }).exec();

  const updated = await CommunityRoute.findById(route._id).exec();
  if (!updated) {
    res.status(404).json({ message: 'Route introuvable' });
    return;
  }

  const payload: RouteResponse = { route: toCommunityRoute(updated, String(userId)) };
  res.json(payload);
});
