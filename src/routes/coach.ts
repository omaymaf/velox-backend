import { Router, type Request, type Response } from 'express';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { getEnv } from '../config/env.js';
import type { AIAnalysisResult, CoachRequest, CoachResponse } from '../types/domain.js';

/**
 * Coach IA. A monter sur `/api/coach`.
 *
 * L'app mobile appelle cette route via `api.post('/coach', ...)`
 * (services/geminiService.ts) : la cle Gemini reste donc JAMAIS cote client,
 * uniquement dans `process.env.GEMINI_API_KEY`.
 *
 * Contrat : `{ coach: AIAnalysisResult }`. En cas d'absence de cle, de timeout
 * ou de reponse inexploitable, on renvoie 200 avec le REPLI local — identique
 * a celui du `FALLBACK` de `geminiService.ts` — plutot qu'une erreur : l'ecran
 * d'accueil doit toujours avoir quelque chose a afficher.
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/**
 * Delai maximal de l'appel Gemini. L'app mobile attend la reponse avant
 * d'afficher le coach : au-dela, on renvoie le repli plutot que de bloquer
 * l'ecran.
 */
const GEMINI_TIMEOUT_MS = 8_000;

/** Modele par defaut (GA et stable). Surchargeable via `GEMINI_MODEL`. */
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';

/** Plages de securite appliquees aux valeurs numeriques renvoyees par l'IA. */
const MIN_RECOMMENDED_WATTS = 50;
const MAX_RECOMMENDED_WATTS = 2_000;

/**
 * REPLI EXACT (champs et accents compris) de `FALLBACK` dans
 * `src/services/geminiService.ts`. Toute divergence ferait diverger l'ecran
 * d'accueil selon que l'IA repond ou non.
 */
const FALLBACK_COACH: AIAnalysisResult = {
  coachAdvice:
    'Maintiens une regularite de cadence sur le secteur Bastille. Augmente le seuil anaerobien lors des relances de 30 secondes.',
  recommendedWatts: 320,
  cadenceFocus: '94-98 RPM',
  nextChallenge: 'Sprint Bastille Overdrive',
};

/** Bornes du champs texte acceptes en reponse du modele. */
const MAX_ADVICE_LENGTH = 600;

export const coachRouter = Router();

/** Le coach est derriere l'authentification (proxy vers une API payante). */
coachRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/coach
// ---------------------------------------------------------------------------

coachRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  // Double garde-fou : `requireAuth` a deja pose `req.user`.
  if (!currentUser(req)) {
    res.status(401).json({ message: 'Non authentifie' });
    return;
  }

  const request = parseCoachRequest(req.body);
  const coach = await askCoach(request);

  const payload: CoachResponse = { coach };
  res.json(payload);
});

// ---------------------------------------------------------------------------
// Appel Gemini (REST, `fetch` natif — aucun SDK)
// ---------------------------------------------------------------------------

/** Interroge Gemini, ou renvoie le repli. Ne leve jamais. */
async function askCoach(request: CoachRequest): Promise<AIAnalysisResult> {
  const { geminiApiKey } = getEnv();
  if (!geminiApiKey || geminiApiKey.trim().length === 0) {
    // Cas attendu en local : on ne logue rien de sensible, on ne fait pas
    // d'appel reseau inutile.
    return FALLBACK_COACH;
  }

  // Le nom du modele est lisible depuis l'URL de la requete : il ne doit donc
  // contenir ni espace ni slash (injection d'URL par un operateur).
  const model = readModel();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  // La cle part dans l'ENTETE, jamais dans l'URL : elle ne peut donc pas
  // finir dans un log d'acces ni dans un `Referer`.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-goog-api-key': geminiApiKey,
  };

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildGeminiBody(request)),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      // On ne logue QUE le statut : le corps peut contenir des details de
      // facturation lies a la cle.
      console.warn(`[coach] Gemini a repondu ${upstream.status} : repli local renvoye.`);
      return FALLBACK_COACH;
    }

    const parsed = extractCoach(await upstream.json());
    if (parsed) return parsed;

    console.warn('[coach] Reponse Gemini inexploitable : repli local renvoye.');
    return FALLBACK_COACH;
  } catch (err: unknown) {
    // Timeout (AbortError), reseau coupe, DNS... : jamais de 500 pour l'app.
    const reason = err instanceof Error ? err.name || err.message : 'erreur inconnue';
    console.warn(`[coach] Appel Gemini impossible (${reason}) : repli local renvoye.`);
    return FALLBACK_COACH;
  }
}

/** Modele configure, ou le modele GA par defaut. */
function readModel(): string {
  const raw = (process.env.GEMINI_MODEL ?? '').trim();
  if (raw.length === 0) return DEFAULT_GEMINI_MODEL;
  return /^[a-zA-Z0-9._-]+$/.test(raw) ? raw : DEFAULT_GEMINI_MODEL;
}

/** Corps de la requete `generateContent` : prompt + schema de reponse JSON. */
function buildGeminiBody(request: CoachRequest): Record<string, unknown> {
  const profile = [
    `Puissance moyenne du dernier Effort : ${request.avgWatts} W`,
    `Distance du dernier Effort : ${request.distanceKm} km`,
    `Mode de la derniere sortie : ${request.lastRideMode}`,
  ].join('\n');

  return {
    systemInstruction: {
      parts: [
        {
          text: [
            "Tu es le coach d'un vélocliste urbain qui s'entraîne sur Paris.",
            'Reponds UNIQUEMENT par un objet JSON, sans texte autour, avec exactement ces 4 cles :',
            'coachAdvice (français, 1 a 2 phrases de conseil actionnable),',
            'recommendedWatts (nombre entier, en watts, pour le prochain effort),',
            'cadenceFocus (plage de cadence, ex. "94-98 RPM"),',
            'nextChallenge (nom court du prochain defi).',
          ].join(' '),
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: profile }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7,
      maxOutputTokens: 500,
      responseSchema: {
        type: 'object',
        properties: {
          coachAdvice: { type: 'string' },
          recommendedWatts: { type: 'integer' },
          cadenceFocus: { type: 'string' },
          nextChallenge: { type: 'string' },
        },
        required: ['coachAdvice', 'recommendedWatts', 'cadenceFocus', 'nextChallenge'],
      },
    },
  };
}

/**
 * Extrait l'`AIAnalysisResult` de la reponse `generateContent`.
 *
 * Le champ `candidates[0].content.parts[*].text` contient du JSON, parfois
 * entoure d'un bloc Markdown : on le nettoie puis on le parse.
 *
 * Retourne null si la reponse n'a pas la forme attendue. Une valeur invalide
 * est remplacee CHAMP PAR CHAMP par le repli : l'app recoit toujours un
 * `AIAnalysisResult` complet et affichable.
 */
function extractCoach(raw: unknown): AIAnalysisResult | null {
  const text = readCandidateText(raw);
  if (!text) return null;

  const object = parseJsonObject(text);
  if (!object) return null;

  return {
    coachAdvice: readText(object.coachAdvice) ?? FALLBACK_COACH.coachAdvice,
    recommendedWatts: readWatts(object.recommendedWatts) ?? FALLBACK_COACH.recommendedWatts,
    cadenceFocus: readText(object.cadenceFocus) ?? FALLBACK_COACH.cadenceFocus,
    nextChallenge: readText(object.nextChallenge) ?? FALLBACK_COACH.nextChallenge,
  };
}

/** Concatene les parties texte du premier candidat, ou null. */
function readCandidateText(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidates = (raw as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const first = candidates[0];
  if (typeof first !== 'object' || first === null) return null;

  const content = (first as { content?: unknown }).content;
  if (typeof content !== 'object' || content === null) return null;

  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return null;

  const text = parts
    .map((part) =>
      typeof part === 'object' && part !== null ? (part as { text?: unknown }).text : undefined,
    )
    .filter((value): value is string => typeof value === 'string')
    .join('')
    .trim();

  return text.length > 0 ? text : null;
}

/** Parse un objet JSON, en retirant un eventuel bloc ```json ... ```. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Chaine exploitable (bornee), ou undefined. */
function readText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text.length === 0) return undefined;
  return text.length > MAX_ADVICE_LENGTH ? `${text.slice(0, MAX_ADVICE_LENGTH - 1)}…` : text;
}

/** Puissance recommandee exploitable et bornee, ou undefined. */
function readWatts(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(clamp(parsed, MIN_RECOMMENDED_WATTS, MAX_RECOMMENDED_WATTS));
}

/** Borne une valeur dans [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Helpers : requete
// ---------------------------------------------------------------------------

/** Corps de requete garanti objet (express.json peut laisser `undefined`). */
function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

/** Nombre fini et positif, ou `fallback`. */
function optionalNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Chaine bornee en longueur, ou `fallback`. */
function optionalText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().slice(0, max);
  return text.length > 0 ? text : fallback;
}

/** Analyse `{ avgWatts?, distanceKm?, lastRideMode? }` (tous facultatifs). */
function parseCoachRequest(body: unknown): CoachRequest {
  const source = bodyRecord(body);
  const avgWatts = optionalNumber(source.avgWatts, 300);
  const distanceKm = optionalNumber(source.distanceKm, 10);
  const lastRideMode = optionalText(source.lastRideMode, 24, 'FREE RIDE');

  return {
    avgWatts: Math.max(0, Math.round(avgWatts)),
    distanceKm: Math.max(0, Math.round(distanceKm * 100) / 100),
    lastRideMode,
  };
}