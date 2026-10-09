import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';

/** Charge le .env du dossier velox-backend (silently ignore si absent). */
dotenv.config();

export interface AppEnv {
  /** Connection string Atlas — jamais loggee. */
  mongodbUri: string;
  port: number;
  jwtSecret: string;
  /** true si le secret a ete genere a chaud (sessions invalidees au redemarrage). */
  jwtSecretIsEphemeral: boolean;
  geminiApiKey?: string;
  googleMapsApiKey?: string;
  /** '*' ou une liste d'origines separees par des virgules. */
  clientOrigin: string;
  isProduction: boolean;
  isDev: boolean;
}

/** Erreur de configuration : message destine a etre affiche tel quel a l'utilisateur. */
export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

let cache: AppEnv | null = null;

function requireVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new EnvValidationError(
      `Variable d'environnement manquante : ${name}\n` +
        `  -> Cree velox-backend/.env a partir de velox-backend/.env.example\n` +
        `  -> Renseigne une valeur pour ${name}, puis relance le backend.`,
    );
  }
  return value.trim();
}

function optionalVar(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return undefined;
  return value.trim();
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 5000;
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvValidationError(`PORT invalide : "${raw}". Attendu : un entier entre 1 et 65535.`);
  }
  return port;
}

/**
 * Lit et valide la configuration. Lance (throw) si une variable critique manque.
 * Le resultat est memorise : les appels suivants sont instantanes.
 */
export function getEnv(): AppEnv {
  if (cache) return cache;

  const mongodbUri = requireVar('MONGODB_URI');
  const nodeEnv = (process.env.NODE_ENV ?? '').trim();
  const isProduction = nodeEnv === 'production';
  const isDev = !isProduction;

  // JWT_SECRET : obligatoire en production, genere en dev (avec avertissement).
  let jwtSecret = optionalVar('JWT_SECRET');
  let jwtSecretIsEphemeral = false;
  if (!jwtSecret) {
    if (isProduction) {
      throw new EnvValidationError(
        'JWT_SECRET est obligatoire en production.\n' +
          '  -> Genere une valeur (ex. : openssl rand -hex 48) et renseigne-la dans velox-backend/.env',
      );
    }
    jwtSecret = randomBytes(48).toString('hex');
    jwtSecretIsEphemeral = true;
  }

  cache = {
    mongodbUri,
    port: parsePort(process.env.PORT),
    jwtSecret,
    jwtSecretIsEphemeral,
    geminiApiKey: optionalVar('GEMINI_API_KEY'),
    googleMapsApiKey: optionalVar('GOOGLE_MAPS_API_KEY'),
    clientOrigin: optionalVar('CLIENT_ORIGIN') ?? '*',
    isProduction,
    isDev,
  };

  return cache;
}

/** Avertissement sur le secret JWT ephemere (une seule fois). */
export function warnIfEphemeralSecret(env: AppEnv): void {
  if (!env.jwtSecretIsEphemeral || !env.isDev) return;
  console.warn(
    [
      '',
      '[AVERTISSEMENT] JWT_SECRET absent de .env : un secret aleatoire a ete genere au demarrage.',
      '               Les sessions seront invalidees a chaque redemarrage du backend.',
      '               -> Renseigne JWT_SECRET dans velox-backend/.env pour des sessions persistantes.',
      '',
    ].join('\n'),
  );
}