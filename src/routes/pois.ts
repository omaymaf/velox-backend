import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { Poi, PoiCheckin, toDiscoveryPoi, type PoiDoc } from '../models/Poi.js';
import { toUserProfile } from '../models/User.js';
import type { DiscoveryPoi, PoisResponse, UserResponse } from '../types/domain.js';

/**
 * Routes de decouverte. A monter sur `/api/pois`.
 *
 * - `GET /` : la liste des lieux, `visited` et `distanceMeters` deduits des
 *   check-ins du viewer (voir models/Poi.ts pour le choix d'architecture) ;
 * - `POST /:slug/checkin` : la SEULE route de cette vague qui modifie
 *   l'utilisateur. Elle credite l'XP du lieu et renvoie l'utilisateur a jour.
 */

/** Un slug de POI : kebab-case, 1 a 64 caracteres. */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;

export const poisRouter = Router();

/** Toutes les routes de ce fichier sont privees. */
poisRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Progression XP / niveau
// ---------------------------------------------------------------------------
//
// XP gagne par niveau (formule documentee ci-dessous).
const XP_PER_LEVEL = 100;
//
// FORMULE RETENUE : 100 XP par niveau, lineaire.
//
//   xpRequisPourNiveau(n) = (n - 1) * 100      // n >= 1
//   niveauDepuisXp(xp)    = floor(xp / 100) + 1
//   xpProchainNiveau(xp)  = xpRequisPourNiveau(niveauDepuisXp(xp) + 1)
//
// Invariants garantis par construction :
//   - niveauDepuisXp(0) === 1 (coherent avec `User.level` a la creation) ;
//   - niveauDepuisXp(xpRequisPourNiveau(n)) === n  pour tout n >= 1
//     (la fonction est l'inverse exact de la table de seuils) ;
//   - xp < xpProchainNiveau(xp) <= xp + 100 : la barre de progression de
//     l'ecran "ride complete" (`xp / nextLevelXp`) reste toujours dans [0, 1[.
//
// Ecart assume avec l'app d'origine : celle-ci affichait le NIVEAU 24 pour
// 2200 XP. 2200 / 23 = 95,65 XP par niveau : ce palier n'etait ni entier ni
// lineaire, donc impossible a reprendre tel quel sans arbitraire. La formule
// ci-dessus donne le niveau 23 a 2200 XP (ecart d'un seul niveau) tout en
// etant exactement inversible et sans flottants.
//
// Ces trois fonctions sont exportees : POST /api/rides (vague 2c) doit
// appliquer EXACTEMENT la meme formule pour `User.level` et
// `RideResult.nextLevelXp`, sinon la progression divergerait entre les deux
// points d'entree.

/** XP cumules necessaires pour atteindre le niveau demande. */
export function xpForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.trunc(Number.isFinite(level) ? level : 1));
  return (safeLevel - 1) * XP_PER_LEVEL;
}

/** Niveau courant correspondant a un total d'XP. */
export function levelFromXp(xp: number): number {
  const safeXp = Math.max(0, Math.trunc(Number.isFinite(xp) ? xp : 0));
  return Math.floor(safeXp / XP_PER_LEVEL) + 1;
}

/** Seuil d'XP du niveau suivant (valeur affichee par l'app). */
export function nextLevelXpFromXp(xp: number): number {
  return xpForLevel(levelFromXp(xp) + 1);
}

/** true si l'erreur vient d'une violation d'unicite Mongo (index unique). */
function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

// ---------------------------------------------------------------------------
// GET /api/pois
// ---------------------------------------------------------------------------

poisRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  const docs = await Poi.find().sort({ order: 1, id: 1 }).exec();

  // Un seul aller-retour pour tous les etats de visite du viewer.
  const visited = await visitedPoiIds(String(user._id));

  const payload: PoisResponse = {
    pois: docs.map((doc) => toDiscoveryPoiFor(doc, visited)),
  };
  res.json(payload);
});

// ---------------------------------------------------------------------------
// POST /api/pois/:slug/checkin
// ---------------------------------------------------------------------------

poisRouter.post('/:slug/checkin', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  // --- Validation AVANT tout acces a la base ---
  const rawSlug = typeof req.params.slug === 'string' ? req.params.slug : '';
  const slug = rawSlug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    res.status(400).json({ message: 'Identifiant de point d interet invalide' });
    return;
  }

  const poi = await Poi.findOne({ id: slug }).exec();
  if (!poi) {
    res.status(404).json({ message: 'Point d interet introuvable' });
    return;
  }

  const userId = new mongoose.Types.ObjectId(String(user._id));

  // --- Idempotence : deja visite => aucun XP recredite, utilisateur inchange ---
  const alreadyVisited = await PoiCheckin.exists({ user: userId, poiId: slug });
  if (alreadyVisited) {
    const payload: UserResponse = { user: toUserProfile(user) };
    res.json(payload);
    return;
  }

  // L'insert porte l'idempotence reelle (index unique { user, poiId }) : deux
  // check-ins simultanes ne peuvent pas crediter deux fois l'XP.
  try {
    await PoiCheckin.create({ user: userId, poiId: slug });
  } catch (err: unknown) {
    if (isDuplicateKey(err)) {
      // Course perdue contre une requete identique : on renvoie l'utilisateur
      // tel quel, sans recrediter (le credits a ete fait par l'autre requete).
      const payload: UserResponse = { user: toUserProfile(user) };
      res.json(payload);
      return;
    }
    throw err;
  }

  // --- Credit d'XP + recalcul du niveau ---
  const reward = Math.max(0, Math.trunc(Number.isFinite(poi.xpReward) ? poi.xpReward : 0));
  const currentXp = Math.max(0, Math.trunc(Number.isFinite(user.xp) ? user.xp : 0));
  user.xp = currentXp + reward;
  user.level = levelFromXp(user.xp);
  await user.save();

  const payload: UserResponse = { user: toUserProfile(user) };
  res.json(payload);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set des slugs de POI deja visites par cet utilisateur. */
async function visitedPoiIds(userId: string): Promise<Set<string>> {
  if (!mongoose.isValidObjectId(userId)) return new Set<string>();
  const rows = await PoiCheckin.find({ user: new mongoose.Types.ObjectId(userId) })
    .select({ poiId: 1, _id: 0 })
    .exec();
  return new Set(rows.map((row) => String(row.poiId)));
}

/** Serialise un POI en tenant compte des visites du viewer. */
function toDiscoveryPoiFor(doc: PoiDoc, visited: Set<string>): DiscoveryPoi {
  return toDiscoveryPoi(doc, visited.has(String(doc.id)));
}
