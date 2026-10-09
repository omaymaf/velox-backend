import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from 'mongoose';
import {
  serializeUser,
  type HardwareDevice,
  type RideStats,
  type SerializedUser,
  type UserSource,
} from '../types/domain.js';

/**
 * Document utilisateur (collection `users`).
 *
 * Regles :
 * - le mot de passe n'est JAMAIS stocke en clair (champ `passwordHash` bcrypt) ;
 * - `passwordHash` est `select: false` : il faut le demander explicitement
 *   (`User.findOne({ email }).select('+passwordHash')`) pour le lire ;
 * - les valeurs de `stats` sont des `Number` simples, jamais des objets
 *   enveloppes : `toUserProfile()` renormalise tout de meme les nombres.
 */

/** Capteur connecte (Favero, Garmin, Wahoo...). */
const HardwareSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, default: 'Capteur' },
    status: { type: String, required: true, trim: true, default: 'DISCONNECTED' },
  },
  { _id: false, versionKey: false },
);

/** Compteurs de carriere mis a jour par POST /rides. */
const StatsSchema = new Schema(
  {
    totalDistanceKm: { type: Number, default: 0, required: true },
    totalElevationM: { type: Number, default: 0, required: true },
    bestPower5s: { type: Number, default: 0, required: true },
    zonesSecured: { type: Number, default: 0, required: true },
  },
  { _id: false, versionKey: false },
);

/** Valeurs par defaut d'un bloc `stats` (evite `stats: undefined`). */
function emptyStats(): RideStats {
  return { totalDistanceKm: 0, totalElevationM: 0, bestPower5s: 0, zonesSecured: 0 };
}

const UserSchema = new Schema(
  {
    // --- Identifiants ---
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    /** Hash bcrypt. Jamais renvoye par l'API. */
    passwordHash: { type: String, required: true, select: false },

    // --- Profil ---
    displayName: { type: String, default: '', trim: true, maxlength: 80 },
    avatarUrl: { type: String, default: '', trim: true, maxlength: 2048 },
    club: { type: String, default: '', trim: true, maxlength: 80 },

    // --- Progression ---
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    gpsGranted: { type: Boolean, default: false },

    stats: { type: StatsSchema, default: () => emptyStats() },
    hardware: { type: [HardwareSchema], default: [] },

    // --- Champs optionnels du formulaire "Infos personnelles" ---
    firstName: { type: String, trim: true, maxlength: 60 },
    lastName: { type: String, trim: true, maxlength: 60 },
    phone: { type: String, trim: true, maxlength: 32 },
    city: { type: String, trim: true, maxlength: 80 },
    postalCode: { type: String, trim: true, maxlength: 16 },
    country: { type: String, trim: true, maxlength: 80 },
    bio: { type: String, trim: true, maxlength: 1000 },
    /** Date de naissance au format `AAAA-MM-JJ` (une simple chaine, cf. l'app). */
    birthDate: { type: String, trim: true, maxlength: 10 },
  },
  {
    timestamps: true,
    collection: 'users',
    versionKey: false,
  },
);

/** Filet de securite : meme si un document brut est renvoye tel quel. */
UserSchema.set('toJSON', {
  virtuals: false,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

export type UserAttrs = InferSchemaType<typeof UserSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;

/** Modele `User` (reutilise si le module est charge deux fois). */
export const User: Model<UserAttrs> =
  (mongoose.models.User as Model<UserAttrs> | undefined) ??
  mongoose.model<UserAttrs>('User', UserSchema);

// ---------------------------------------------------------------------------
// Serialisation : le SEUL point de sortie vers l'app mobile.
// ---------------------------------------------------------------------------

/** Accepte un document mongoose, un `toObject()` ou un objet deja en forme. */
function toPlain(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {};
  const maybe = value as { toObject?: () => unknown };
  if (typeof maybe.toObject === 'function') {
    const plain = maybe.toObject();
    if (plain !== null && typeof plain === 'object') return plain as Record<string, unknown>;
  }
  return value as Record<string, unknown>;
}

/** Nombre fini, ou `fallback`. Denoisille les `new Number(...)` et les chaines. */
function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Chaine, ou '' (jamais `null` : l'app fait `user.displayName.split(...)`). */
function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Chaine facultative : `undefined` = champ absent de la reponse JSON. */
function toOptionalText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = toText(value);
  return text.length > 0 ? text : undefined;
}

function toHardware(value: unknown): HardwareDevice[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const device = toPlain(entry);
    return { name: toText(device.name), status: toText(device.status) };
  });
}

/**
 * Construit le `UserProfile` du contrat (types/domain.ts) a partir d'un
 * document. Liste blanche stricte : `passwordHash` et `__v` ne peuvent pas
 * fuir, et tous les nombres sont de vrais `number` JSON.
 */
export function toUserProfile(input: unknown): SerializedUser {
  const src = toPlain(input);

  const rawId = src._id ?? src.id;
  if (rawId === undefined || rawId === null || rawId === '') {
    throw new Error('Document utilisateur sans _id : serialisation impossible.');
  }

  const rawStats = toPlain(src.stats);
  const stats: RideStats = {
    totalDistanceKm: toNumber(rawStats.totalDistanceKm, 0),
    totalElevationM: toNumber(rawStats.totalElevationM, 0),
    bestPower5s: toNumber(rawStats.bestPower5s, 0),
    zonesSecured: toNumber(rawStats.zonesSecured, 0),
  };

  const profile: UserSource = {
    _id: rawId,
    username: toText(src.username),
    email: toText(src.email),
    displayName: toText(src.displayName) || toText(src.username),
    avatarUrl: toText(src.avatarUrl),
    club: toText(src.club),
    xp: toNumber(src.xp, 0),
    level: Math.max(1, Math.trunc(toNumber(src.level, 1))),
    gpsGranted: src.gpsGranted === true,
    stats,
    hardware: toHardware(src.hardware),
    firstName: toOptionalText(src.firstName),
    lastName: toOptionalText(src.lastName),
    phone: toOptionalText(src.phone),
    city: toOptionalText(src.city),
    postalCode: toOptionalText(src.postalCode),
    country: toOptionalText(src.country),
    bio: toOptionalText(src.bio),
    birthDate: toOptionalText(src.birthDate),
  };

  return serializeUser(profile);
}
