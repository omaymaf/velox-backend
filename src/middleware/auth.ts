import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { getEnv } from '../config/env.js';
import { User, type UserDoc } from '../models/User.js';

/**
 * Authentification par jeton JWT Bearer.
 *
 * Regle de securite : ni le header `Authorization`, ni le jeton, ni le hash
 * du mot de passe ne sont JAMAIS loggues. En cas d'echec on repond toujours
 * `{ message: 'Non authentifie' }` (401), sans detail.
 */

/** Duree de validite d'une session. */
const TOKEN_TTL = '7d';

/** `req.user` est pose par `requireAuth`. */
declare global {
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

/** Signe un jeton pour l'utilisateur donne. */
export function signToken(userId: string): string {
  const { jwtSecret } = getEnv();
  return jwt.sign({}, jwtSecret, { subject: userId, expiresIn: TOKEN_TTL, issuer: 'velox-backend' });
}

/** Verifie un jeton et renvoie le `userId` (ou null si invalide/perime). */
export function verifyToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, getEnv().jwtSecret);
    if (typeof decoded === 'string') return null;
    const subject = decoded.sub;
    return typeof subject === 'string' && subject.length > 0 ? subject : null;
  } catch {
    return null;
  }
}

/** true si la chaine est un ObjectId Mongo valide (24 caracteres hex). */
function isObjectIdLike(value: string): boolean {
  return mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === value;
}

/** Reponse 401 unique, quel que soit le motif du rejet. */
function unauthorized(res: Response): void {
  res.status(401).json({ message: 'Non authentifie' });
}

/**
 * Middleware : exige un jeton valide et charge l'utilisateur en base.
 * Pose `req.user` (le document mongoose complet, sans `passwordHash` car le
 * champ est `select: false`).
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.get('authorization') ?? '';
  const [scheme, ...rest] = header.split(' ');
  const token = rest.join(' ').trim();

  if (scheme?.toLowerCase() !== 'bearer' || token.length === 0) {
    unauthorized(res);
    return;
  }

  const userId = verifyToken(token);
  if (!userId || !isObjectIdLike(userId)) {
    unauthorized(res);
    return;
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      unauthorized(res);
      return;
    }
    req.user = user;
    next();
  } catch (err: unknown) {
    if (err instanceof mongoose.Error.CastError) {
      unauthorized(res);
      return;
    }
    next(err);
  }
};

/**
 * `req.user` apres `requireAuth`. Les routes verification la presence
 * (double garde-fou) et repondent 401 plutot que de lever.
 */
export function currentUser(req: Request): UserDoc | null {
  return req.user ?? null;
}
