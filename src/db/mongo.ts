import mongoose, { type ConnectOptions } from 'mongoose';
import { getEnv } from '../config/env.js';

/**
 * Expression qui isole les identifiants `user:password@` d'une connection string.
 * Groupe 1 = schema, groupe 2 = identifiants (a remplacer).
 */
const CREDENTIALS_RE = /^(mongodb(?:\+srv)?:\/\/)([^@/]*)@/i;

/** Delai maximal d'attente de la selection d'un serveur (fail-fast). */
const SERVER_SELECTION_TIMEOUT_MS = 10_000;

/**
 * Remplace `user:password@` par `***:***@`.
 * L'URI ne doit JAMAIS etre loggee telle quelle : elle contient le mot de passe.
 */
export function maskUri(uri: string): string {
  return uri.replace(CREDENTIALS_RE, (_match, scheme: string) => `${scheme}***:***@`);
}

/** Description loggable de l'URI : hote + nom de base, identifiants masques. */
export function describeUri(uri: string): string {
  const masked = maskUri(uri);
  const parts = /^(?:mongodb(?:\+srv)?:\/\/)(?:\*\*\*:\*\*\*@)?([^/?#]+)(?:\/([^?#]*))?/i.exec(masked);
  if (!parts) return masked;
  const host = parts[1] ?? 'inconnu';
  const dbName = parts[2] ? decodeURIComponent(parts[2]) : '(aucune)';
  return `${host} / base="${dbName}"`;
}

let connectionPromise: Promise<typeof mongoose> | null = null;

/**
 * Connexion MongoDB (singleton). Idempotent : un deuxieme appel renvoie la
 * connexion deja etablie.
 */
export function connectToMongoDB(): Promise<typeof mongoose> {
  if (connectionPromise) return connectionPromise;

  const { mongodbUri } = getEnv();

  mongoose.set('strictQuery', true);

  const options: ConnectOptions = {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    socketTimeoutMS: 45_000,
    connectTimeoutMS: 10_000,
    // On veut remonter auss vite possible l'erreur de credentials/reseau.
    autoIndex: true,
  };

  console.log(`[mongo] Connexion a ${describeUri(mongodbUri)}...`);

  connectionPromise = mongoose
    .connect(mongodbUri, options)
    .then((m) => {
      console.log(`[mongo] Connecte (${describeUri(mongodbUri)}).`);
      return m;
    })
    .catch((err: unknown) => {
      // Reset pour permettre un nouvel essai (retry) apres un echec.
      connectionPromise = null;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mongo] Echec de connexion sur ${describeUri(mongodbUri)} : ${message}`);
      throw err;
    });

  mongoose.connection.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mongo] Erreur de connexion : ${message}`);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[mongo] Deconnecte du serveur MongoDB.');
  });
  mongoose.connection.on('reconnected', () => {
    console.log('[mongo] Reconnecte au serveur MongoDB.');
  });

  return connectionPromise;
}

/** Ferme proprement la connexion MongoDB. */
export async function disconnectFromMongoDB(): Promise<void> {
  if (!connectionPromise && mongoose.connection.readyState === 0) return;
  try {
    await mongoose.disconnect();
    console.log('[mongo] Deconnexion propre.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mongo] Erreur lors de la deconnexion : ${message}`);
  } finally {
    connectionPromise = null;
  }
}

/** true si la connexion est etablie (readyState 1 = connected). */
export function isDbReady(): boolean {
  return mongoose.connection.readyState === 1;
}