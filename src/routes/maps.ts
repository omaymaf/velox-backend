import { Router, type Request, type Response } from 'express';
import { getEnv } from '../config/env.js';

/**
 * Proxy de carte statique. A monter sur `/api/maps`.
 *
 * `GET /api/maps/static?center=lat,lng&zoom=&width=&height=&markers=&path=`
 *
 * L'app construit l'URL avec `getVeloxStaticMapUrl` (services/mapsService.ts)
 * et la passe directement a un `<Image source={{ uri }} />` : aucune requete
 * HTTP ne peut donc PAS porter d'en-tete `Authorization`. Cette route est par
 * consequent PUBLIQUE — c'est une contrainte du client, pas un oubli. Le risque
 * associe (usage de notre quota Google) est limite par :
 *   - `width`/`height` bornes a 640 (comme `size` max de l'API Google) ;
 *   - un nombre maximal de points pour `markers` et `path` ;
 *   - `center` obligatoire et valide.
 *
 * La cle Google reste sur le serveur : elle n'est jamais logguee, et l'URL
 * amont (qui la contient) n'est jamais journalisee non plus.
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Taille maximale d'une image renvoyee par l'API Google (garde-fou memoire). */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Delai maximal de l'appel amont. */
const UPSTREAM_TIMEOUT_MS = 8_000;

/** Bornes de la carte. */
const MAX_DIMENSION = 640;
const MIN_DIMENSION = 1;
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 360;
const DEFAULT_ZOOM = 14;
const MIN_ZOOM = 0;
const MAX_ZOOM = 21;

/** Garde-fous sur le nombre de points (borne aussi la longueur de l'URL). */
const MAX_MARKERS = 20;
const MAX_PATH_POINTS = 100;

/** Message de repli quand aucune cle n'est configuree. */
const NO_KEY_MESSAGE =
  'Cle Google Maps absente : renseigne GOOGLE_MAPS_API_KEY dans velox-backend/.env pour activer les cartes.';

export const mapsRouter = Router();

/**
 * Note de securite : PAS de `requireAuth` ici (voir l'en-tete du fichier).
 * L'app mobile appelle cette route sans jeton.
 */

// ---------------------------------------------------------------------------
// GET /api/maps/static
// ---------------------------------------------------------------------------

mapsRouter.get('/static', async (req: Request, res: Response): Promise<void> => {
  // 1. Cle : absente => 503 explicite, plutot qu'une image cassee affichee
  //    par l'app (le `<Image>` ne distingue pas les deux cas).
  const key = readMapsKey();
  if (!key) {
    res.status(503).json({ message: NO_KEY_MESSAGE });
    return;
  }

  // 2. Parametres.
  const query = req.query;
  const center = parsePoint(firstValue(query.center));
  if (!center) {
    res.status(400).json({ message: 'Le parametre "center" est requis au format "lat,lng"' });
    return;
  }

  const zoom = clampInteger(readNumber(query.zoom, DEFAULT_ZOOM), MIN_ZOOM, MAX_ZOOM);
  // L'app borne deja a 640 : le serveur re-borne (un appel direct pourrait
  // demander 4000x4000).
  const width = clampInteger(readNumber(query.width, DEFAULT_WIDTH), MIN_DIMENSION, MAX_DIMENSION);
  const height = clampInteger(readNumber(query.height, DEFAULT_HEIGHT), MIN_DIMENSION, MAX_DIMENSION);

  const markers = parsePointList(firstValue(query.markers), MAX_MARKERS);
  if (markers === 'invalid') {
    res.status(400).json({ message: 'Le parametre "markers" est invalide (attendu : "lat,lng")' });
    return;
  }

  const path = parsePointList(firstValue(query.path), MAX_PATH_POINTS);
  if (path === 'invalid') {
    res.status(400).json({ message: 'Le parametre "path" est invalide (attendu : "lat,lng;lat,lng")' });
    return;
  }

  // 3. URL amont. La cle est le DERNIER parametre et n'est jamais logguee.
  const upstreamUrl = new URL('https://maps.googleapis.com/maps/api/staticmap');
  upstreamUrl.searchParams.set('center', formatPoint(center));
  upstreamUrl.searchParams.set('zoom', String(zoom));
  upstreamUrl.searchParams.set('size', `${width}x${height}`);
  upstreamUrl.searchParams.set('scale', '1');
  upstreamUrl.searchParams.set('maptype', 'roadmap');
  if (markers.length > 0) upstreamUrl.searchParams.set('markers', markers.map(formatPoint).join('|'));
  if (path.length > 0) upstreamUrl.searchParams.set('path', path.map(formatPoint).join('|'));
  upstreamUrl.searchParams.set('key', key);

  // 4. Appel amont.
  // `Awaited<ReturnType<typeof fetch>>` plutot que `Response` : ce nom est
  // occupe ici par la reponse Express.
  let upstreamImage: Awaited<ReturnType<typeof fetch>>;
  try {
    upstreamImage = await fetch(upstreamUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.name || err.message : 'erreur inconnue';
    console.warn(`[maps] Appel Google Maps impossible (${reason}).`);
    res.status(502).json({ message: 'Service de cartographie indisponible' });
    return;
  }

  if (!upstreamImage.ok) {
    // On ne logue QUE le statut : le corps d'erreur Google peut rappeler le
    // nom du projet associe a la cle.
    console.warn(`[maps] Google Maps a repondu ${upstreamImage.status}.`);
    res.status(502).json({ message: 'Carte indisponible' });
    return;
  }

  const contentType = upstreamImage.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    // Google renvoie du texte (erreur) avec un statut 200 dans certains cas :
    // on ne renvoie jamais cela comme une "image".
    console.warn('[maps] Reponse Google Maps non-image.');
    res.status(502).json({ message: 'Carte indisponible' });
    return;
  }

  const bytes = Buffer.from(await upstreamImage.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    console.warn('[maps] Image Google Maps hors bornes de taille.');
    res.status(502).json({ message: 'Carte indisponible' });
    return;
  }

  // 5. Renvoi : la cle reste cote serveur.
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(bytes.byteLength));
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(bytes);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cle Google Maps. `getEnv()` expose `googleMapsApiKey`
 * (`GOOGLE_MAPS_API_KEY`) ; on accepte aussi `GOOGLE_MAPS_KEY`, documentée
 * dans certaines installations, sans quoi le serveur répondrait 503 alors que
 * la cle est bien presente dans l'environnement.
 */
function readMapsKey(): string | null {
  const fromEnv = getEnv().googleMapsApiKey;
  const fromLegacy = (process.env.GOOGLE_MAPS_KEY ?? '').trim();
  const key = (fromEnv ?? '').trim().length > 0 ? fromEnv!.trim() : fromLegacy;
  return key.length > 0 ? key : null;
}

/** Premiere valeur d'un parametre de query (Express 5 : string | string[]). */
function firstValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** Point latitude/longitude. */
interface Point {
  lat: number;
  lng: number;
}

/**
 * Parse `lat,lng`. Renvoie null si la chaine est absente ou invalide
 * (lat hors [-90, 90], lng hors [-180, 180], ou paires de tokens incorrectes).
 */
function parsePoint(raw: string | undefined): Point | null {
  if (raw === undefined) return null;
  const [latText, lngText] = raw.split(',');
  if (latText === undefined || lngText === undefined) return null;

  const lat = Number(latText.trim());
  const lng = Number(lngText.trim());
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

/** `"lat,lng"` -> `"lat,lng"` avec 6 decimales (URL compacte et stable). */
function formatPoint(point: Point): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

/**
 * Parse une liste de points : `lat,lng` (`markers`, un ou plusieurs separes
 * par `|`) ou `lat,lng;lat,lng` (`path`, le `;` de l'app remplace par `|`).
 *
 * Renvoie la liste, `'invalid'` si un point est mal forme, ou une liste vide si
 * le parametre est absent.
 */
function parsePointList(raw: string | undefined, max: number): Point[] | 'invalid' {
  if (raw === undefined) return [];
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];

  const tokens = trimmed
    .split(/[;|]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length > max) return 'invalid';

  const points: Point[] = [];
  for (const token of tokens) {
    const point = parsePoint(token);
    // Un seul point mal forme invalide tout le parametre : on ne renvoie
    // jamais une carte silencieusement decalee.
    if (!point) return 'invalid';
    points.push(point);
  }
  return points;
}

/** Nombre fini, ou `fallback`. */
function readNumber(value: unknown, fallback: number): number {
  const raw = firstValue(value);
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Entier borne dans [min, max] (l'API Google n'accepte pas de decimales). */
function clampInteger(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}