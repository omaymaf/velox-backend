import mongoose, { Schema, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import type { RideMode } from '../types/domain.js';

/**
 * Sortie enregistree (collection `rides`).
 *
 * Vague 2c : POST /rides cree le document puis met `User.stats`, `User.xp` et
 * `User.level` a jour ; GET /users/me/weekly agrege ce modele.
 * `createdAt` est en commentaire du schema : les scripts de seed peuvent
 * inserer des sorties historicisees.
 */

/** Modes acceptes (meme union que `RideMode` dans types/domain.ts). */
export const RIDE_MODES: RideMode[] = ['PERFORMANCE', 'CONQUEST', 'DISCOVERY', 'FREE RIDE'];

const RideSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, default: 'Sortie' },
    subtitle: { type: String, trim: true, default: '' },
    mode: { type: String, enum: RIDE_MODES, required: true, default: 'FREE RIDE' },

    // --- Objectifs affiches pendant la sortie ---
    targetTime: { type: String, trim: true, default: '' },
    pbTime: { type: String, trim: true, default: '' },
    targetDistanceKm: { type: Number, default: 0 },
    xpReward: { type: Number, default: 0 },

    // --- Mesures du resume renvoye par le HUD ---
    distanceKm: { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 },
    avgSpeedKmh: { type: Number, default: 0 },
    avgPowerW: { type: Number, default: 0 },
    maxPowerW: { type: Number, default: 0 },
    elevationM: { type: Number, default: 0 },

    // --- Recompenses ---
    xpEarned: { type: Number, default: 0 },
    isPersonalBest: { type: Boolean, default: false },

    /** Territoire conquis (conquest), absent pour une sortie libre. */
    territoryId: { type: String, trim: true },

    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: 'rides', versionKey: false },
);

/** Requete de base : sorties d'un utilisateur, de la plus recente a la plus ancienne. */
RideSchema.index({ user: 1, createdAt: -1 });

export type RideAttrs = InferSchemaType<typeof RideSchema>;
export type RideDoc = HydratedDocument<RideAttrs>;

/** Modele `Ride` (reutilise si le module est charge deux fois). */
export const Ride: Model<RideAttrs> =
  (mongoose.models.Ride as Model<RideAttrs> | undefined) ??
  mongoose.model<RideAttrs>('Ride', RideSchema);
