import mongoose, { Schema, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import type { AccentColor, CommunityRoute as CommunityRouteContract, RouteCategory } from '../types/domain.js';

/**
 * Routes partagees dans le fil communautaire (collection `community_routes`).
 *
 * Les fixtures de l'app (veloxData.ts) portent `liked`, mais c'est de l'etat
 * LOCAL d'une session. Cote serveur il est derive par utilisateur, comme pour
 * les POI : on stocke `likedBy` (liste d'`ObjectId` `User`) et la
 * serialisation renvoie `liked = likedBy.includes(viewer)`.
 *
 * `kudos` est un DENOMBRATEUR GLOBAL, fourni par les fixtures (42, 89, 64).
 * Il est donc VOLONTAIREMENT plus grand que `likedBy.length` tant que personne
 * n'a aimé : les kudos d'origine representent des Yorba-likes hors base. Ce que
 * garantit le toggle de POST /community/:id/kudos, c'est que toute variation de
 * `kudos` vaut exactement +/- 1 par ajout/retrait dans `likedBy` de ce viewer
 * (invariant relatif a la valeur de depart du document, pas absolu).
 *
 * Meme raisonnement que pour `Poi`, un tableau `likedBy` est tolere ici parce
 * qu'il reste borne (un like par utilisateur et par route) et qu'il evite un
 * aller-retour supplementaire sur une liste de lecture ; l'invariant reste
 * verifiable par `$addToSet` / `$pull` atomiques.
 */

/** Accents possibles (meme union que `AccentColor`). */
export const ACCENT_COLORS: AccentColor[] = ['lime', 'cyan', 'magenta'];

/** Categories du fil (meme union que `RouteCategory`). */
export const ROUTE_CATEGORIES: RouteCategory[] = ['Trending', 'Sprint', 'Climb', 'Friends', 'Hardcore'];

const CommunityRouteSchema = new Schema(
  {
    /** Identifiant stable de la carte : slug pour une fixture, slug+suffixe pour une sortie publiee. */
    id: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 96 },
    handle: { type: String, default: '@anonymous', trim: true, maxlength: 80 },
    badge: { type: String, default: '', trim: true, maxlength: 24 },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    avatarUrl: { type: String, default: '', trim: true, maxlength: 2048 },
    avatarAlt: { type: String, default: '', trim: true, maxlength: 400 },

    /** Compteur global de kudos (les fixtures en fournissent une valeur). */
    kudos: { type: Number, default: 0, min: 0 },
    /** Utilisateurs ayant aime la route : source de verite de `liked`. */
    likedBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },

    distanceKm: { type: Number, default: 0, min: 0 },
    elevationM: { type: Number, default: 0, min: 0 },

    // Troisieme metrique, entierement libre (l'app affiche label/value/unit).
    thirdMetricLabel: { type: String, default: '', trim: true, maxlength: 40 },
    thirdMetricValue: { type: String, default: '', trim: true, maxlength: 24 },
    thirdMetricUnit: { type: String, default: '', trim: true, maxlength: 12 },

    footerIcon: { type: String, default: '', trim: true, maxlength: 40 },
    footerText: { type: String, default: '', trim: true, maxlength: 140 },

    accentColor: { type: String, enum: ACCENT_COLORS, required: true },
    category: { type: String, enum: ROUTE_CATEGORIES, required: true },

    // --- Origine facultative : sortie publiee depuis l'ecran "ride complete" ---
    user: { type: Schema.Types.ObjectId, ref: 'User', required: false },
    rideId: { type: Schema.Types.ObjectId, ref: 'Ride', required: false },

    /**
     * Rang d'affichage INTERNE (absent du contrat). Les fixtures utilisent
     * 0, 1, 2 ; une sortie publiee par un utilisateur recoit -1 afin
     * d'apparaitre en tete de fil (l'app fait de meme en optimiste).
     */
    order: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'community_routes', versionKey: false },
);

/**
 * Tri du fil : fixtures d'abord (0, 1, 2) puis publications (-1), et au sein
 * d'un meme rang les plus recentes d'abord. `id` en dernier tri rend le
 * resultat deterministe si deux documents partagent le meme `order`.
 */
CommunityRouteSchema.index({ order: 1, createdAt: -1, id: 1 });

/** Une sortie publiee ne peut l'etre qu'une fois (contrainte applicative + 409). */
CommunityRouteSchema.index({ rideId: 1 }, { unique: true, sparse: true });

export type CommunityRouteAttrs = InferSchemaType<typeof CommunityRouteSchema>;
export type CommunityRouteDoc = HydratedDocument<CommunityRouteAttrs>;

/** Modele `CommunityRoute` (reutilise si le module est charge deux fois). */
export const CommunityRoute: Model<CommunityRouteAttrs> =
  (mongoose.models.CommunityRoute as Model<CommunityRouteAttrs> | undefined) ??
  mongoose.model<CommunityRouteAttrs>('CommunityRoute', CommunityRouteSchema);

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

/** Accent : retombe sur `lime` si la valeur stockee est inconnue. */
function toAccent(value: unknown): AccentColor {
  return ACCENT_COLORS.includes(value as AccentColor) ? (value as AccentColor) : 'lime';
}

/** Categorie : retombe sur `Trending` si la valeur stockee est inconnue. */
function toCategory(value: unknown): RouteCategory {
  return ROUTE_CATEGORIES.includes(value as RouteCategory) ? (value as RouteCategory) : 'Trending';
}

/** true si `viewerId` figure dans `likedBy` (comparaison en chaine). */
function isLikedBy(likedBy: unknown, viewerId: string | null): boolean {
  if (!viewerId || !Array.isArray(likedBy)) return false;
  return likedBy.some((entry) => String(entry) === viewerId);
}

/**
 * `CommunityRoute` du contrat.
 *
 * @param input    document `CommunityRoute`
 * @param viewerId identifiant de l'utilisateur courant, ou null (aucun like)
 */
export function toCommunityRoute(input: unknown, viewerId: string | null): CommunityRouteContract {
  const src = toPlain(input);
  return {
    id: toText(src.id),
    handle: toText(src.handle) || '@anonymous',
    badge: toText(src.badge),
    title: toText(src.title),
    avatarUrl: toText(src.avatarUrl),
    avatarAlt: toText(src.avatarAlt),
    kudos: Math.max(0, Math.trunc(toNumber(src.kudos, 0))),
    liked: isLikedBy(src.likedBy, viewerId),
    distanceKm: Math.max(0, toNumber(src.distanceKm, 0)),
    elevationM: Math.max(0, toNumber(src.elevationM, 0)),
    thirdMetricLabel: toText(src.thirdMetricLabel),
    thirdMetricValue: toText(src.thirdMetricValue),
    thirdMetricUnit: toText(src.thirdMetricUnit),
    footerIcon: toText(src.footerIcon),
    footerText: toText(src.footerText),
    accentColor: toAccent(src.accentColor),
    category: toCategory(src.category),
  };
}
