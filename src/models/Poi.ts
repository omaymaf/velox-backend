import mongoose, { Schema, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import type { DiscoveryPoi } from '../types/domain.js';

/**
 * Points d'interet de decouverte (collection `pois`) + etat de visite par
 * utilisateur (collection `poi_checkins`).
 *
 * ---------------------------------------------------------------------------
 * CHOIX D'ARCHITECTURE : la visite est stockee par utilisateur (option (a)).
 * ---------------------------------------------------------------------------
 * Un POI est une donnee de REFERENCE partagee par tous les utilisateurs. Un
 * champ `visited: boolean` sur le document POI serait donc faux des la
 * premiere connexion : l'utilisateur A verrait le lieu deja capture alors que
 * l'utilisateur B ne l'a jamais visite. Stocker un tableau `visitedBy`
 *>(option (b)) marcherait, mais grossit le document lu par tous et melange
 * deux responsabilites.
 *
 * On prefere donc une collection dediee `poi_checkins` : un document par
 * couple (utilisateur, POI), avec un index unique sur `{ user, poiId }`.
 * Benefices :
 *  - `GET /api/pois` lit uniquement la collection de reference (rapide, 1 N+1
 *    de moins : un seul `find` des checkins du viewer) ;
 *  - l'idempotence du check-in est portee par l'index unique, donc garantie
 *    par Mongo meme en cas de requetes simultanees, pas seulement par un
 *    `if` applicatif ;
 *  - on peut historiser l'ordre des decouvertes d'un utilisateur.
 *
 * Consequence assumee : `POST /api/pois/:slug/checkin` ne modifie PAS le
 * document POI. Le `distanceMeters` du document reste la distance de
 * REFERENCE vers le lieu ; c'est la SERIALISATION qui renvoie
 * `distanceMeters: 0` pour un lieu deja visite par le viewer, exactement ce que
 * l'app fait de son cote en optimiste (index.tsx : `{ ...p, visited: true,
 * distanceMeters: 0 }`).
 */

/** Positionnement CSS sur la carte de l'app (chaines, ex. "480px"). */
const CoordsSchema = new Schema(
  {
    top: { type: String, required: true, trim: true },
    left: { type: String, required: true, trim: true },
  },
  { _id: false, versionKey: false },
);

const PoiSchema = new Schema(
  {
    /** Le slug du lieu (ex. "pont-neuf") : c'est l'`id` du contrat ET le `:slug` du check-in. */
    id: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, default: 'Landmark', trim: true, maxlength: 60 },
    /** Distance de REFERENCE vers le lieu, en metres. */
    distanceMeters: { type: Number, default: 0, min: 0 },
    xpReward: { type: Number, default: 0, min: 0 },
    isTarget: { type: Boolean, default: false },
    corridorHint: { type: String, default: '', trim: true, maxlength: 240 },
    /** Obligatoire dans le contrat : l'app positionne la carte via ces 2 chaines. */
    coords: { type: CoordsSchema, required: true },
    /** Coordonnees GPS reelles, optionnelles (HUD v2). */
    lat: { type: Number, required: false },
    lng: { type: Number, required: false },
    /** Rang d'affichage interne (0, 1, 2...). */
    order: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'pois', versionKey: false },
);

/** Tri du fil : ordre des fixtures, puis slug (tri stable). */
PoiSchema.index({ order: 1, id: 1 });

// ---------------------------------------------------------------------------
// Etat de visite par utilisateur
// ---------------------------------------------------------------------------

const PoiCheckinSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    /** Slug du POI (et non son ObjectId) : la donnee de reference est partagee. */
    poiId: { type: String, required: true, lowercase: true, trim: true },
    visitedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'poi_checkins', versionKey: false },
);

/**
 * Index unique : un seul check-in par (utilisateur, POI). C'est la garantie
 * d'idempotence de POST /pois/:slug/checkin (le code 11000 est rattrape).
 */
PoiCheckinSchema.index({ user: 1, poiId: 1 }, { unique: true });

export type PoiAttrs = InferSchemaType<typeof PoiSchema>;
export type PoiDoc = HydratedDocument<PoiAttrs>;
export type PoiCheckinAttrs = InferSchemaType<typeof PoiCheckinSchema>;
export type PoiCheckinDoc = HydratedDocument<PoiCheckinAttrs>;

/** Modele `Poi` (reutilise si le module est charge deux fois). */
export const Poi: Model<PoiAttrs> =
  (mongoose.models.Poi as Model<PoiAttrs> | undefined) ??
  mongoose.model<PoiAttrs>('Poi', PoiSchema);

/** Modele `PoiCheckin` (reutilise si le module est charge deux fois). */
export const PoiCheckin: Model<PoiCheckinAttrs> =
  (mongoose.models.PoiCheckin as Model<PoiCheckinAttrs> | undefined) ??
  mongoose.model<PoiCheckinAttrs>('PoiCheckin', PoiCheckinSchema);

// ---------------------------------------------------------------------------
// Serialisation : le SEUL point de sortie vers l'app mobile.
// ---------------------------------------------------------------------------

/** Objet -> objet brut (document mongoose, `toObject()`, ou objet deja plat). */
function toPlain(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {};
  const maybe = value as { toObject?: () => unknown };
  if (typeof maybe.toObject === 'function') {
    const plain = maybe.toObject();
    if (plain !== null && typeof plain === 'object') return plain as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

/** Nombre fini, ou `fallback`. */
function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Chaine, ou '' (jamais `null`). */
function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Nombre fini optionnel : `undefined` = champ absent du JSON. */
function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** `coords` : l'app en a besoin, donc un repli stable plutot qu'un trou. */
function toCoords(value: unknown): { top: string; left: string } {
  const raw = toPlain(value);
  return { top: toText(raw.top), left: toText(raw.left) };
}

/**
 * `DiscoveryPoi` du contrat.
 *
 * @param input   document `Poi`
 * @param visited le viewer a-t-il deja capture ce lieu ? (lu dans `poi_checkins`)
 */
export function toDiscoveryPoi(input: unknown, visited: boolean): DiscoveryPoi {
  const src = toPlain(input);
  // Un lieu visite est affiche « DISCOVERED » par l'app et n'affiche plus sa
  // distance : on renvoie donc 0, comme l'app le fait en optimiste.
  const distanceMeters = visited ? 0 : Math.max(0, toNumber(src.distanceMeters, 0));

  const poi: DiscoveryPoi = {
    id: toText(src.id),
    name: toText(src.name),
    category: toText(src.category),
    distanceMeters,
    xpReward: Math.max(0, toNumber(src.xpReward, 0)),
    visited,
    isTarget: src.isTarget === true,
    corridorHint: toText(src.corridorHint),
    coords: toCoords(src.coords),
  };

  const lat = toOptionalNumber(src.lat);
  const lng = toOptionalNumber(src.lng);
  if (lat !== undefined) poi.lat = lat;
  if (lng !== undefined) poi.lng = lng;

  return poi;
}
