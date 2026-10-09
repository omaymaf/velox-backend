import mongoose, { Schema, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import type {
  TerritoryCenter,
  TerritoryColor,
  TerritoryStatus,
  TerritoryZone,
} from '../types/domain.js';

/**
 * Zones de conquest (collection `territories`).
 *
 * Donnee de REFERENCE partagee : aucun lien avec un utilisateur. Un territoire
 * n'a donc pas d'etat par viewer, la serialisation est sans parametre.
 *
 * `order` est un champ INTERNE (absent du contrat de sortie) : il preserve
 * l'ordre des fixtures de l'app mobile, que le tri par `tacticalId`
 * ("SEC-01S" < "SEC-02D" < "SEC-04B" < "SEC-12N") ne reproduirait pas.
 */

/** Statuts acceptes (meme union que `TerritoryStatus`). */
export const TERRITORY_STATUSES: TerritoryStatus[] = ['CONTESTED', 'SECURED', 'NEUTRAL'];

/** Couleurs de territoire : les 3 accents + la valeur neutre. */
export const TERRITORY_COLORS: TerritoryColor[] = ['magenta', 'lime', 'cyan', 'neutral'];

/** Point de geolocalisation affiche sur la carte. */
const CenterSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
  },
  { _id: false, versionKey: false },
);

const TerritorySchema = new Schema(
  {
    /** Le slug de la zone (ex. "bastille-4") : c'est l'`id` du contrat ET l'identifiant de la route POST /rides. */
    id: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 64 },
    tacticalId: { type: String, required: true, trim: true, maxlength: 24 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    shortName: { type: String, required: true, trim: true, maxlength: 60 },
    status: { type: String, enum: TERRITORY_STATUSES, required: true },
    owner: { type: String, default: 'Unclaimed', trim: true, maxlength: 80 },
    areaKm2: { type: Number, required: true, min: 0 },
    defenseLevel: { type: String, default: 'No Shield', trim: true, maxlength: 40 },
    rewardXp: { type: Number, default: 0, min: 0 },
    controlPercent: { type: Number, default: 0, min: 0, max: 100 },
    color: { type: String, enum: TERRITORY_COLORS, required: true },
    /** Absent = zone non geolocalisee (l'app gere l'absence). */
    center: { type: CenterSchema, required: false },
    /** Rang d'affichage interne (0, 1, 2...). */
    order: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'territories', versionKey: false },
);

/** Tri du fil : ordre des fixtures, puis identifiant (tri stable). */
TerritorySchema.index({ order: 1, id: 1 });

export type TerritoryAttrs = InferSchemaType<typeof TerritorySchema>;
export type TerritoryDoc = HydratedDocument<TerritoryAttrs>;

/** Modele `Territory` (reutilise si le module est charge deux fois). */
export const Territory: Model<TerritoryAttrs> =
  (mongoose.models.Territory as Model<TerritoryAttrs> | undefined) ??
  mongoose.model<TerritoryAttrs>('Territory', TerritorySchema);

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

/** Chaine non vide apres trim, ou `fallback`. */
function toText(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return fallback;
  const text = String(value);
  return text.length > 0 ? text : fallback;
}

/** Accent d'un statut, si le document en porte un (donnees futures). */
function toStatus(value: unknown): TerritoryStatus {
  return TERRITORY_STATUSES.includes(value as TerritoryStatus) ? (value as TerritoryStatus) : 'NEUTRAL';
}

/** Couleur : retombe sur `neutral`, seule valeur acceptee hors accents. */
function toColor(value: unknown): TerritoryColor {
  return TERRITORY_COLORS.includes(value as TerritoryColor) ? (value as TerritoryColor) : 'neutral';
}

/** `center` : absent, ou un objet complet aux 3 champs. */
function toCenter(value: unknown): TerritoryCenter | undefined {
  if (value === null || value === undefined) return undefined;
  const raw = toPlain(value);
  const lat = toNumber(raw.lat, Number.NaN);
  const lng = toNumber(raw.lng, Number.NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { label: toText(raw.label, 'Zone'), lat, lng };
}

/**
 * `TerritoryZone` du contrat. Liste blanche stricte : `order`, `createdAt`,
 * `updatedAt` et `_id` ne sortent jamais.
 */
export function toTerritoryZone(input: unknown): TerritoryZone {
  const src = toPlain(input);
  const zone: TerritoryZone = {
    id: toText(src.id, ''),
    tacticalId: toText(src.tacticalId, ''),
    name: toText(src.name, ''),
    shortName: toText(src.shortName, ''),
    status: toStatus(src.status),
    owner: toText(src.owner, 'Unclaimed'),
    areaKm2: toNumber(src.areaKm2, 0),
    defenseLevel: toText(src.defenseLevel, 'No Shield'),
    rewardXp: Math.max(0, toNumber(src.rewardXp, 0)),
    controlPercent: Math.min(100, Math.max(0, toNumber(src.controlPercent, 0))),
    color: toColor(src.color),
  };

  // `center` reste facultatif : ne l'emettre que s'il est complet, sinon
  // `undefined` (champ absent du JSON) pour rester fidele au type.
  const center = toCenter(src.center);
  if (center) zone.center = center;

  return zone;
}
