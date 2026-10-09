import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import { isDbReady } from '../db/mongo.js';
import { currentUser, requireAuth, signToken } from '../middleware/auth.js';
import { User, toUserProfile } from '../models/User.js';
import type { AuthResponse, UserResponse } from '../types/domain.js';

console.log('[auth] Module loaded');

/**
 * Routes d'authentification. A monter sur `/api/auth`.
 *
 * - `/login` et `/register` sont PUBLIQUES (pas de `requireAuth`) ;
 * - `/me` exige un jeton valide.
 *
 * Regle de securite : un e-mail inconnu et un mot de passe faux renvoient
 * exactement la meme reponse 401 `"Identifiants invalides"` (pas de fuite
 * d'enumeration de comptes). Aucun mot de passe ni hash n'est journalise.
 */

const BCRYPT_ROUNDS = 12;

/** Message unique pour toute erreur d'identification. */
const INVALID_CREDENTIALS = 'Identifiants invalides';

/** Email volontairement simple : on refuse le blatantly invalide, pas plus. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 6;

export const authRouter = Router();

authRouter.get('/test', (_req: Request, res: Response) => {
  console.log('[auth] test route called');
  res.json({ ok: true, message: 'test route works' });
});

authRouter.post('/test-post', async (_req: Request, res: Response) => {
  console.log('[auth] test-post route called');
  res.json({ ok: true, message: 'test post route works' });
});

authRouter.get('/test-db', async (_req: Request, res: Response) => {
  console.log('[auth] test-db route called');
  try {
    const user = await User.findOne({ email: 'test@test.com' }).exec();
    console.log('[auth] test-db User.findOne result:', user);
    res.json({ ok: true, user });
  } catch (err) {
    console.error('[auth] test-db error:', err);
    res.status(500).json({ error: String(err) });
  }
});

/** Corps de requete garanti objet (express.json peut laisser `undefined`). */
function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

/** Chaine non vide apres trim, sinon undefined. */
function requiredText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** true si l'erreur vient d'une violation d'unicite Mongo (index unique). */
function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/** Verifie la disponibilite de la base de donnees. */
function checkDbReady(res: Response): boolean {
  console.log('[auth] checkDbReady called, isDbReady:', isDbReady());
  // 1. Si la base de données n'est PAS prête (le point d'exclamation "!" veut dire "Non")
  if (!isDbReady()) {

    // 2. On affiche un message privé dans notre console (pour nous, les développeurs)
    console.log('[auth] Le cuisinier est prêt, mais le frigo MongoDB est coincé (DB not ready), renvoi de 503');

    // 3. On envoie l'erreur 503 (et la blague) directement à l'application mobile ou au site web
    res.status(503).json({ message: "Le cuisinier est là, mais la porte du frigo (MongoDB) est coincée ! Service temporairement indisponible." });

    // 4. On retourne "false" (Faux) pour dire "Arrête tout, on ne peut pas faire la connexion de l'utilisateur"
    return false;
  }

  // 5. Si on arrive jusqu'ici (c'est que isDbReady() était vrai), on retourne "true" 
  // (Vrai : "C'est bon, le frigo est ouvert, continue ton travail !")
  return true;

}

// ---------------------------------------------------------------------------
// POST /api/auth/login  (public)
// ---------------------------------------------------------------------------

authRouter.post('/login3', (_req: Request, res: Response) => {
  console.log('[auth] login3 handler called');
  res.json({ ok: true, message: 'login3 handler reached' });
});

authRouter.post('/login-test', (_req: Request, res: Response) => {
  console.log('[auth] login-test handler called');
  res.json({ ok: true, message: 'login-test handler reached' });
});

authRouter.post('/foo-bar', (_req: Request, res: Response) => {
  console.log('[auth] foo-bar handler called');
  res.json({ ok: true, message: 'foo-bar handler reached' });
});

authRouter.post('/login2', (_req: Request, res: Response) => {
  console.log('[auth] login2 handler called');
  res.json({ ok: true, message: 'login2 handler reached' });
});

authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  if (!checkDbReady(res)) return;
  const body = bodyRecord(req.body);
  const email = requiredText(body.email);
  const password = typeof body.password === 'string' && body.password.length > 0 ? body.password : undefined;

  // Validation AVANT tout acces a la base.
  if (!email) {
    res.status(400).json({ message: "L'adresse e-mail est requise" });
    return;
  }
  if (!password) {
    res.status(400).json({ message: 'Le mot de passe est requis' });
    return;
  }

  // `passwordHash` est `select: false` : il faut le redemander explicitement.
  const user = await User.findOne({ email }).select('+passwordHash').exec();

  // Message identique si l'utilisateur n'existe pas OU si le hash ne matche pas.
  if (!user) {
    res.status(401).json({ message: INVALID_CREDENTIALS });
    return;
  }

  const passwordHash = typeof user.passwordHash === 'string' ? user.passwordHash : '';
  const passwordMatches = passwordHash.length > 0 ? await bcrypt.compare(password, passwordHash) : false;
  if (!passwordMatches) {
    res.status(401).json({ message: INVALID_CREDENTIALS });
    return;
  }

  const payload: AuthResponse = {
    token: signToken(String(user._id)),
    user: toUserProfile(user),
  };
  res.json(payload);
});

// ---------------------------------------------------------------------------
// POST /api/auth/register  (public)
// ---------------------------------------------------------------------------

authRouter.post('/register', async (req: Request, res: Response): Promise<void> => {
  console.log('[auth] register handler called');
  try {
    if (!checkDbReady(res)) return;
    const body = bodyRecord(req.body);
    const username = requiredText(body.username);
    const email = requiredText(body.email);
    const password = typeof body.password === 'string' && body.password.length > 0 ? body.password : undefined;

    // Validation AVANT tout acces a la base.
    if (!username) {
      res.status(400).json({ message: "Le nom d'utilisateur est requis" });
      return;
    }
    if (username.length < 3) {
      res.status(400).json({ message: "Le nom d'utilisateur doit contenir au moins 3 caracteres" });
      return;
    }
    if (!email) {
      res.status(400).json({ message: "L'adresse e-mail est requise" });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ message: "L'adresse e-mail est invalide" });
      return;
    }
    if (!password) {
      res.status(400).json({ message: 'Le mot de passe est requis' });
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({
        message: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caracteres`,
      });
      return;
    }

    // Unicite verifiee en amont pour renvoyer un message clair ; l'index unique
    // reste la vraie securite (race condition interiegee au 11000).
    const existing = await User.findOne({ $or: [{ email }, { username }] }).exec();
    if (existing) {
      const taken =
        (typeof existing.email === 'string' && existing.email === email) ||
        (typeof existing.username === 'string' && existing.username === username);
      res.status(409).json({
        message: taken
          ? 'Un compte existe deja avec cette adresse e-mail ou ce nom d utilisateur'
          : 'Un compte existe deja avec ces informations',
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const created = new User({
      username,
      email,
      passwordHash,
      displayName: username,
    });
    await created.save();

    const payload: AuthResponse = {
      token: signToken(String(created._id)),
      user: toUserProfile(created),
    };
    res.status(201).json(payload);
  } catch (err: unknown) {
    console.error('[auth] register error:', err);
    if (isDuplicateKey(err)) {
      res.status(409).json({ message: 'Un compte existe deja avec cette adresse e-mail ou ce nom d utilisateur' });
      return;
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me  (prive)
// ---------------------------------------------------------------------------

authRouter.get('/me', requireAuth, (req: Request, res: Response): void => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }
  const payload: UserResponse = { user: toUserProfile(user) };
  res.json(payload);
});
