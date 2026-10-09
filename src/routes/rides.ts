import { Router, type Request, type Response } from 'express';
import mongoose, { type ClientSession } from 'mongoose';
import { Ride, RIDE_MODES } from '../models/Ride.js';
import { Territory } from '../models/Territory.js';
import { User, toUserProfile, type UserDoc } from '../models/User.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
// Progression : on REUTILISE la formule de /api/pois (100 XP par niveau) pour
// que `user.level` et `progress.nextLevelXp` ne puissent pas diverger entre le
// check-in d'un POI et l'enregistrement d'une sortie.
import { levelFromXp, nextLevelXpFromXp } from './pois.js';
import type {
  RideCreated,
  RideMode,
  RideProgress,
  RideResponse,
  SerializedUser,
} from '../types/domain.js';

/**
 * Enregistrement d'une sortie terminee. A monter sur `/api/rides`.
 *
 * Une seule route, `POST /`, qui fait tout le travail de fin de sortie :
 * document `rides`, XP, niveau, statistiques de carriere et controle du
 * territoire — dans une seule ecriture logique, transactionnelle si possible.
 *
 * Reponse : `{ ride, progress, user }` (cf. `RideResponse`). Le champ lu par
 * l'app est `ride._id` (PAS `rideId`).
 */

// ---------------------------------------------------------------------------
// Constantes metier
// ---------------------------------------------------------------------------

/**
 * Puissance de reference de l'effort, en watts : le "TARGET: 320 W (OPTIMAL
 * ZONE 4)" affiche par le HUD en PERFORMANCE, et le `recommendedWatts` du
 * repli du coach IA.
 */
const REFERENCE_WATTS = 320;

/**
 * Plafond de la prime annoncee par la config du mode (`xpReward` ; 350 en
 * PERFORMANCE). Borne de securite : sans elle, un client pourrait attribuer
 * un XP arbitraire en un seul POST.
 */
const MAX_CONFIG_XP = 2_000;

/** Majoration appliquee quand la sortie est un record personnel. */
const PERSONAL_BEST_XP_MULTIPLIER = 1.2;

/**
 * Points de controle gagnes dans un territoire par sortie de conquest.
 * 4 sorties => 100 % => zone conquise.
 */
const TERRITORY_CONTROL_PER_RIDE = 25;

/** Longueurs maximales : garde-fous serveur (le schema Ride n'en impose pas). */
const TITLE_MAX = 200;
const SUBTITLE_MAX = 300;
const TIME_LABEL_MAX = 40;
const TERRITORY_ID_MAX = 64;

export const ridesRouter = Router();

/** Toutes les routes de ce fichier sont privees. */
ridesRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/rides
// ---------------------------------------------------------------------------

ridesRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  // --- Validation AVANT tout acces a la base ---
  const validated = validateCreateRide(req.body);
  if ('error' in validated) {
    res.status(400).json({ message: validated.error });
    return;
  }
  const input = validated.value;

  // --- Coherence des ecritures ---
  //
  // On tente une transaction Mongo (replica set / Atlas). Sur un Mongo
  // "standalone" (Docker local sans replica set), les transactions n'existent
  // pas : on bascule alors en mode degrade. L'ordre des ecritures y est choisi
  // pour qu'un echec ne laisse JAMAIS de XP sans ride : on insere d'abord le
  // ride, puis on credite l'utilisateur.
  const session = await startSession();
  try {
    let outcome: RideOutcome;
    try {
      outcome = session
        ? await session.withTransaction(() => persistRide(user, input, session))
        : await persistRide(user, input, null);
    } catch (err: unknown) {
      if (!session || !isTransactionsUnsupported(err)) throw err;
      // Serveur sans transactions : dernier recours, meme code, sans session.
      // Avertissement unique : sinon chaque sortie repete le meme message.
      if (!transactionsUnavailable) {
        transactionsUnavailable = true;
        console.warn(
          '[rides] Transactions Mongo indisponibles (serveur sans replica set) : ecriture sans session.',
        );
      }
      outcome = await persistRide(user, input, null);
    }

    const response: RideResponse = {
      ride: outcome.ride,
      progress: outcome.progress,
      user: outcome.user,
    };
    res.status(201).json(response);
  } finally {
    if (session) await endSession(session);
  }
});

// ---------------------------------------------------------------------------
// Coeur de metier
// ---------------------------------------------------------------------------

/** Requete `/rides` validee et normalisee. */
interface RideInput {
  title: string;
  subtitle: string;
  mode: RideMode;
  targetTime: string;
  pbTime: string;
  targetDistanceKm: number;
  xpReward: number;
  distanceKm: number;
  durationSec: number;
  avgPowerW: number;
  maxPowerW: number;
  elevationM: number;
  territoryId?: string;
}

/** Resultat interne du coeur de metier. */
interface RideOutcome {
  ride: RideCreated;
  progress: RideProgress;
  user: SerializedUser;
}

/**
 * Enregistre la sortie : document Ride, progression, stats, territoire.
 *
 * Toutes les ecritures utilisent des VALEURS ABSOLUES (issues d'un instantane
 * pris avant) et non des `$inc` : l'operation est donc idempotente si Mongo
 * rejoue la transaction (comportement normal de `withTransaction` sur erreur
 * transitoire).
 */
async function persistRide(
  owner: UserDoc,
  input: RideInput,
  session: ClientSession | null,
): Promise<RideOutcome> {
  const options = session ? { session } : {};
  const userId = new mongoose.Types.ObjectId(String(owner._id));

  // 1. Instantane AVANT toute ecriture.
  const levelBefore = Math.max(1, Math.trunc(finite(owner.level, 1)));
  const xpBefore = Math.max(0, Math.trunc(finite(owner.xp, 0)));
  const statsBefore = {
    totalDistanceKm: Math.max(0, finite(owner.stats?.totalDistanceKm, 0)),
    totalElevationM: Math.max(0, finite(owner.stats?.totalElevationM, 0)),
    bestPower5s: Math.max(0, finite(owner.stats?.bestPower5s, 0)),
    zonesSecured: Math.max(0, Math.trunc(finite(owner.stats?.zonesSecured, 0))),
  };

  // 2. Normalisation des mesures.
  const rideDurationSec = Math.round(input.durationSec);
  const rideDistanceKm = round2(input.distanceKm);
  const rideAvgPowerW = Math.round(input.avgPowerW);
  const rideMaxPowerW = Math.round(input.maxPowerW);
  const rideElevationM = Math.round(input.elevationM);
  const avgSpeedKmh = round2(input.distanceKm / (rideDurationSec / 3600));

  // 3. Insertion du document. On cree un NOUVEAU document a chaque appel :
  //    si la transaction est rejouee, l'objet ne doit pas basculer en update
  //    (mongoose memorise `isNew = false` apres le premier `save`).
  const ride = await new Ride({
    user: userId,
    title: input.title,
    subtitle: input.subtitle,
    mode: input.mode,
    targetTime: input.targetTime,
    pbTime: input.pbTime,
    targetDistanceKm: input.targetDistanceKm,
    xpReward: input.xpReward,
    distanceKm: rideDistanceKm,
    durationSec: rideDurationSec,
    avgSpeedKmh,
    avgPowerW: rideAvgPowerW,
    maxPowerW: rideMaxPowerW,
    elevationM: rideElevationM,
    xpEarned: 0,
    isPersonalBest: false,
    ...(input.territoryId ? { territoryId: input.territoryId } : {}),
    createdAt: new Date(),
    updatedAt: new Date(),
  }).save(options);

  // 4. Record personnel : recalcule APRES insertion, sur l'historique complet
  //    de ce couple (utilisateur, titre, mode). Une premiere sortie sur ce
  //    titre n'a rien a battre : elle compte donc comme un record.
  const bestRow = await bestDurationSec(userId, input.title, input.mode, session);
  const isPersonalBest = bestRow === null ? true : rideDurationSec <= bestRow;

  // 5. XP gagne (formule documentee dans `computeXpEarned`).
  const xpEarned = computeXpEarned({
    baseXp: input.xpReward,
    distanceKm: rideDistanceKm,
    targetDistanceKm: input.targetDistanceKm,
    avgPowerW: rideAvgPowerW,
    isPersonalBest,
  });

  ride.xpEarned = xpEarned;
  ride.isPersonalBest = isPersonalBest;
  await ride.save(options);

  // 6. Progression + statistiques de carriere.
  const xpAfter = xpBefore + xpEarned;
  const levelAfter = levelFromXp(xpAfter);

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        xp: xpAfter,
        level: levelAfter,
        'stats.totalDistanceKm': round2(statsBefore.totalDistanceKm + rideDistanceKm),
        'stats.totalElevationM': Math.round(statsBefore.totalElevationM + rideElevationM),
        'stats.bestPower5s': Math.max(Math.round(statsBefore.bestPower5s), rideMaxPowerW),
      },
    },
    options,
  ).exec();

  // 7. Conquest. Territoire inconnu => information non bloquante : la sortie
  //    reste enregistree, `territoryId` n'est qu'une indication de l'app.
  if (input.territoryId) {
    const justSecured = await claimTerritory(input.territoryId, String(owner.username), options);
    // `claimTerritory` renvoie `false` pour une zone simplement renforcee et
    // `undefined` pour un slug inconnu : seul `true` compte une zone conquise.
    if (justSecured === true) {
      await User.updateOne(
        { _id: userId },
        { $set: { 'stats.zonesSecured': statsBefore.zonesSecured + 1 } },
        options,
      ).exec();
    }
  }

  // 8. Profil REELU en base : la reponse `user` decrit exactement ce qui est
  //    stocke (le document porte par `requireAuth` pourrait etre perime).
  const updatedUser = await User.findOne({ _id: userId }, null, options).exec();
  if (!updatedUser) {
    throw new Error('Utilisateur introuvable apres enregistrement de la sortie.');
  }

  const rideCreated: RideCreated = {
    _id: String(ride._id),
    distanceKm: rideDistanceKm,
    durationSec: rideDurationSec,
    avgSpeedKmh,
    avgPowerW: rideAvgPowerW,
    xpEarned,
    isPersonalBest,
  };

  const progress: RideProgress = {
    nextLevelXp: nextLevelXpFromXp(xpAfter),
    leveledUp: levelAfter > levelBefore,
  };

  return { ride: rideCreated, progress, user: toUserProfile(updatedUser) };
}

/** Meilleure duree (en secondes) pour ce (utilisateur, titre, mode). */
async function bestDurationSec(
  userId: mongoose.Types.ObjectId,
  title: string,
  mode: RideMode,
  session: ClientSession | null,
): Promise<number | null> {
  const query = Ride.aggregate<{ minDurationSec: number }>([
    { $match: { user: userId, title, mode } },
    { $group: { _id: null, minDurationSec: { $min: '$durationSec' } } },
  ]);
  if (session) query.session(session);
  const [row] = await query.exec();
  return row ? Number(row.minDurationSec) : null;
}

// ---------------------------------------------------------------------------
// Helpers : validation
// ---------------------------------------------------------------------------

/** Corps de requete garanti objet (express.json peut laisser `undefined`). */
function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

/** Chaine non vide apres trim, ou undefined. */
function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Mesure numerique. Renvoie `NaN` si la valeur est presente mais
 * inexploitable ("abc", true, {}...) : l'appelant peut alors refuser en 400.
 * Un champ absent vaut `fallback` (le HUD envoie par exemple
 * `elevationM: 0`, `targetDistanceKm` peut manquer sur un FREE RIDE).
 */
function measure(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Nombre fini, ou `fallback`. */
function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Resultat de validation : soit une erreur 400, soit la requete normalisee. */
type Validated<RideBody> = { error: string } | { value: RideBody };

/** Valide et normalise le corps de POST /rides. Aucune requete Mongo ici. */
function validateCreateRide(body: unknown): Validated<RideInput> {
  const source = bodyRecord(body);

  const title = trimmed(source.title);
  if (!title) return { error: 'Le champ "title" est requis' };
  if (title.length > TITLE_MAX) return { error: `Le champ "title" depasse ${TITLE_MAX} caracteres` };

  const subtitle = trimmed(source.subtitle) ?? '';
  if (subtitle.length > SUBTITLE_MAX) {
    return { error: `Le champ "subtitle" depasse ${SUBTITLE_MAX} caracteres` };
  }

  const mode = trimmed(source.mode) ?? '';
  if (!RIDE_MODES.includes(mode as RideMode)) {
    return { error: `Le champ "mode" doit valoir ${RIDE_MODES.join(', ')}` };
  }

  const targetTime = trimmed(source.targetTime) ?? '';
  const pbTime = trimmed(source.pbTime) ?? '';
  if (targetTime.length > TIME_LABEL_MAX || pbTime.length > TIME_LABEL_MAX) {
    return { error: `Les champs "targetTime" et "pbTime" depassent ${TIME_LABEL_MAX} caracteres` };
  }

  const targetDistanceKm = measure(source.targetDistanceKm, 0);
  const xpReward = measure(source.xpReward, 0);
  const distanceKm = measure(source.distanceKm, 0);
  const durationSec = measure(source.durationSec, 0);
  const avgPowerW = measure(source.avgPowerW, 0);
  const maxPowerW = measure(source.maxPowerW, 0);
  const elevationM = measure(source.elevationM, 0);

  const measured = [targetDistanceKm, xpReward, distanceKm, durationSec, avgPowerW, maxPowerW, elevationM];
  if (measured.some((value) => !Number.isFinite(value))) {
    return { error: 'Les mesures doivent etre des nombres' };
  }
  if (targetDistanceKm < 0 || xpReward < 0 || distanceKm < 0) {
    return { error: 'distanceKm, targetDistanceKm et xpReward doivent etre positifs ou nuls' };
  }
  if (avgPowerW < 0 || maxPowerW < 0 || elevationM < 0) {
    return { error: 'avgPowerW, maxPowerW et elevationM doivent etre positifs ou nuls' };
  }
  // Seule condition bloquante : `durationSec <= 0` rend `avgSpeedKmh` infini
  // (division par zero) et fausserait l'agregat "weekly".
  if (durationSec <= 0) {
    return { error: 'Le champ "durationSec" doit etre strictement positif' };
  }

  const territoryId = trimmed(source.territoryId);
  if (territoryId && territoryId.length > TERRITORY_ID_MAX) {
    return { error: `Le champ "territoryId" depasse ${TERRITORY_ID_MAX} caracteres` };
  }

  return {
    value: {
      title,
      subtitle,
      mode: mode as RideMode,
      targetTime,
      pbTime,
      targetDistanceKm,
      xpReward,
      distanceKm,
      durationSec,
      avgPowerW,
      maxPowerW,
      elevationM,
      ...(territoryId ? { territoryId } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers : calcul
// ---------------------------------------------------------------------------

/** 2 decimales (evite le bruit flottant dans le JSON renvoye a l'app). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Borne une valeur dans [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * XP GAGNE — FORMULE RETENUE (source de verite unique cote serveur) :
 *
 *   xpEarned = round( base * completion * performance * bonus )
 *
 *   base        = prime annoncee par la config du mode (`xpReward`, 350 en
 *                 PERFORMANCE), bornee a [0, MAX_CONFIG_XP] pour qu'un client
 *                 ne puisse pas s'auto-attribuer un XP arbitraire.
 *   completion  = part REELLEMENT parcourue de l'objectif de distance :
 *                 clamp(distanceKm / targetDistanceKm, 0, 1).
 *                 Sortie sans objectif (`targetDistanceKm <= 0`, ex. FREE
 *                 RIDE) => completion = 1. Sortie de 0 km => 0 XP.
 *   performance = 0.5 + 0.5 * effort, avec
 *                 effort = clamp(avgPowerW / REFERENCE_WATTS, 0, 1.25)
 *                 => 0.5 sans puissance mesuree, 1.0 a 320 W, 1.125 au-dela
 *                    de 400 W.
 *   bonus       = PERSONAL_BEST_XP_MULTIPLIER (x1.2) si record personnel.
 *
 * Effet : une sortie qui atteint son objectif a la puissance de reference
 * rapporte la prime complete (~350 XP en PERFORMANCE) ; la meme sortie a
 * 160 W n'en rapporte que la moitie ; une sortie record rapporte +20 %.
 *
 * La PROGRESSION (niveau, prochain palier) n'est PAS reimplementee ici : elle
 * vient de `levelFromXp` / `nextLevelXpFromXp` (routes/pois.ts).
 */
function computeXpEarned(input: {
  baseXp: number;
  distanceKm: number;
  targetDistanceKm: number;
  avgPowerW: number;
  isPersonalBest: boolean;
}): number {
  const base = Math.min(MAX_CONFIG_XP, Math.max(0, Math.trunc(input.baseXp)));
  if (base <= 0 || input.distanceKm <= 0) return 0;

  const completion =
    input.targetDistanceKm > 0 ? clamp(input.distanceKm / input.targetDistanceKm, 0, 1) : 1;
  const effort = clamp(input.avgPowerW / REFERENCE_WATTS, 0, 1.25);
  const performance = 0.5 + 0.5 * effort;
  const bonus = input.isPersonalBest ? PERSONAL_BEST_XP_MULTIPLIER : 1;

  return Math.max(0, Math.round(base * completion * performance * bonus));
}

// ---------------------------------------------------------------------------
// Helpers : conquest
// ---------------------------------------------------------------------------

/**
 * Ajoute `TERRITORY_CONTROL_PER_RIDE` points de controle a la zone.
 * Renvoie true si la zone vient d'etre conquise (100 %), false sinon,
 * undefined si le territoire n'existe pas.
 *
 * Mise a jour en valeur ABSOLUE (lecture puis ecriture) : la fonction reste
 * idempotente si la transaction Mongo est rejouee.
 */
async function claimTerritory(
  territoryId: string,
  username: string,
  options: { session?: ClientSession },
): Promise<boolean | undefined> {
  const territory = await Territory.findOne({ id: territoryId.toLowerCase() }, null, options).exec();
  if (!territory) {
    // Slug inconnu : on n'invalide pas la sortie pour autant.
    return undefined;
  }

  const controlBefore = clamp(finite(territory.controlPercent, 0), 0, 100);
  const controlAfter = Math.min(100, controlBefore + TERRITORY_CONTROL_PER_RIDE);
  const justSecured = controlAfter >= 100 && territory.status !== 'SECURED';

  const update: Record<string, unknown> = { controlPercent: controlAfter };
  if (justSecured) {
    update.status = 'SECURED';
    update.owner = username.length > 0 ? `@${username}` : territory.owner;
  }

  await Territory.updateOne({ _id: territory._id }, { $set: update }, options).exec();
  return justSecured;
}

// ---------------------------------------------------------------------------
// Helpers : transactions
// ---------------------------------------------------------------------------

/** true si le serveur ne supporte pas les transactions (avertissement unique). */
let transactionsUnavailable = false;

/**
 * Ouvre une session Mongo. Renvoie null si le serveur refuse (rare) : l'appelant
 * bascule alors en mode degrade.
 */
async function startSession(): Promise<ClientSession | null> {
  try {
    return await mongoose.startSession();
  } catch {
    return null;
  }
}

/** Ferme la session sans jamais faire echouer la requete. */
async function endSession(session: ClientSession): Promise<void> {
  try {
    await session.endSession();
  } catch {
    // Une session qui ne se ferme pas ne doit pas casser la reponse.
  }
}

/**
 * true si l'erreur vient d'un serveur SANS support des transactions
 * (Mongo "standalone" : ni replica set, ni mongos).
 *
 * Code 20 = IllegalOperation, message officiel :
 * "Transaction numbers are only allowed on a replica set member or mongos".
 */
function isTransactionsUnsupported(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { code?: number | string; codeName?: string; message?: string };
  if (candidate.code === 20) return true;
  const text = `${candidate.codeName ?? ''} ${candidate.message ?? ''}`.toLowerCase();
  return (
    text.includes('transaction numbers are only allowed') ||
    text.includes('transactions are not supported') ||
    text.includes('replica set member or mongos')
  );
}