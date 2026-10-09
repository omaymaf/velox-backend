import { Router, type Request, type Response } from 'express';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { Territory, toTerritoryZone } from '../models/Territory.js';
import type { TerritoriesResponse } from '../types/domain.js';

/**
 * Routes de conquest. A monter sur `/api/territories`.
 *
 * Uniquement `GET /` : les territoires sont de la donnee de REFERENCE
 * partageee, leur modification est hors perimetre (une prise de territoire se
 * fait via POST /rides, qui recoit `territoryId`).
 *
 * L'ordre de retour est celui des fixtures de l'app mobile (champ interne
 * `order`), pas l'ordre alphabetique des slugs.
 */

export const territoriesRouter = Router();

/** Toutes les routes de ce fichier sont privees. */
territoriesRouter.use(requireAuth);

territoriesRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  // Double garde-fou : `requireAuth` a deja pose `req.user`.
  if (!currentUser(req)) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  const docs = await Territory.find().sort({ order: 1, id: 1 }).exec();
  const payload: TerritoriesResponse = { territories: docs.map((doc) => toTerritoryZone(doc)) };
  res.json(payload);
});
