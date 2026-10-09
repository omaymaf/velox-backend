import cors from 'cors';
import express, { type Express } from 'express';
import { EnvValidationError, getEnv, warnIfEphemeralSecret, type AppEnv } from './config/env.js';
import { connectToMongoDB, disconnectFromMongoDB, isDbReady } from './db/mongo.js';
import { authRouter } from './routes/auth.js';
import type { HealthResponse } from './types/domain.js';

/**
 * Squelette du backend Ride Quest.
 * Vague 1 : express + CORS + JSON + health + connexion Mongo.
 * Vague 2/3 : models mongoose, routes metier, seed.
 */

function buildApp(env: AppEnv): Express {
  const app = express();

  // --- CORS ---
  // CLIENT_ORIGIN="*" (defaut) : l'app mobile n'envoie pas de cookie, elle
  // utilise l'en-tete Authorization, donc pas de credentials: true ici.
  const allowedOrigins =
    env.clientOrigin === '*'
      ? '*'
      : env.clientOrigin
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
  app.use(cors({ origin: allowedOrigins }));

  // --- Corps JSON ---
  app.use(express.json({ limit: '1mb' }));

  // Debug: log all requests
  app.use((req, _res, next) => {
    console.log('[http] Request:', req.method, req.path);
    next();
  });

  // --- Health check (l'app et le script de verification l'interrogent) ---
  app.get('/api/health', (_req, res) => {
    const payload: HealthResponse = { ok: true, db: isDbReady() };
    res.json(payload);
  });

  // --- VAGUE 3 : routes metier a monter ici ---
  app.use('/api/auth', authRouter);
  // app.use('/api/users', usersRouter);
  // app.use('/api/territories', territoriesRouter);
  // app.use('/api/pois', poisRouter);
  // app.use('/api/community', communityRouter);
  // app.use('/api/rides', ridesRouter);
  // app.use('/api/coach', coachRouter);

  // 404 JSON uniforme (l'app affiche `data.message`)
  app.use((_req, res) => {
    res.status(404).json({ message: 'Route inconnue' });
  });

  // Express 5 route les rejets vers ce middleware.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Erreur interne';
    console.error('[http] Erreur non geree :', err);
    res.status(500).json({ message: 'Erreur interne du serveur', details: message });
  });

  return app;
}

async function start(): Promise<void> {
  // 1. Configuration : si une variable critique manque, on sort proprement
  //    avec un message actionnable (pas de stack trace illisible).
  let env: AppEnv;
  try {
    env = getEnv();
  } catch (err: unknown) {
    if (err instanceof EnvValidationError) {
      console.error(`\n[config] Configuration invalide.\n${err.message}\n`);
    } else {
      console.error('[config] Erreur inattendue :', err);
    }
    process.exit(1);
  }

  warnIfEphemeralSecret(env);

  const app = buildApp(env);

  // 2. Base de donnees.
  //    On demarre meme si Mongo est injoignable : /api/health expose db:false,
  //    ce qui permet de diagnostiquer sans tomber sur un crash obscur.
  try {
    await connectToMongoDB();
  } catch {
    console.error('[mongo] Demarrage en mode degrade : la base de donnees est injoignable.');
  }

  // 3. Ecoute sur 0.0.0.0 : obligatoire pour que le telephone du meme reseau
  //    atteigne le backend (EXPO_PUBLIC_API_URL=http://192.168.1.10:5000/api).
  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`[http] Ride Quest backend sur http://0.0.0.0:${env.port}`);
    console.log(`[http] Prefixe API : /api  |  health : http://0.0.0.0:${env.port}/api/health`);
    if (env.isDev) {
      console.log('[http] Rappel : depuis un telephone, utiliser l IP du PC, pas "localhost".');
    }
  });

  const shutdown = (signal: string): void => {
    console.log(`\n[http] ${signal} recu, arret...`);
    server.close(() => {
      void disconnectFromMongoDB().then(() => process.exit(0));
    });
    // Filet de securite si le.close() traine.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void start();