import { EnvValidationError, getEnv } from './config/env.js';
import { connectToMongoDB, describeUri, disconnectFromMongoDB } from './db/mongo.js';
import { CommunityRoute } from './models/CommunityRoute.js';
import { Poi } from './models/Poi.js';
import { Territory } from './models/Territory.js';
import { INITIAL_COMMUNITY_ROUTES, INITIAL_DISCOVERY_POIS, INITIAL_TERRITORIES } from './fixtures.js';

/**
 * Peuplement des donnees de REFERENCE partagees.
 *
 * Usage : `npm run seed` (tsx src/seed.ts)
 *
 * - Ne cree AUCUN utilisateur : les territoires, POI et routes communautaires
 *   sont des fixtures partagees, pas des comptes. Relancer la vague 2b
 *   (POST /api/auth/register) pour creer un joueur.
 * - Est IDEMPOTENT : upsert par `id`, donc aucun doublon si on le relance.
 * - Les fixtures.Description, valeurs, etabli par ordre d'origine.
 */

/** Ordre d'affichage des fixtures, pris dans le tableau source. */
const TERRITORY_ORDER = [0, 1, 2, 3];
const POI_ORDER = [0, 1, 2, 3];
const ROUTE_ORDER = [0, 1, 2];

/** Champs de `Territory` issus de la fixture. */
function territoryData(index: number): Record<string, unknown> {
  const zone = INITIAL_TERRITORIES[index];
  if (!zone) throw new Error(`Fixture de territoire absente a l'index ${index}`);
  return {
    id: zone.id,
    tacticalId: zone.tacticalId,
    name: zone.name,
    shortName: zone.shortName,
    status: zone.status,
    owner: zone.owner,
    areaKm2: zone.areaKm2,
    defenseLevel: zone.defenseLevel,
    rewardXp: zone.rewardXp,
    controlPercent: zone.controlPercent,
    color: zone.color,
    order: index,
    // `center` reste absent : les fixtures n'en fournissent aucun.
  };
}

/** Champs de `Poi` issus de la fixture (`visited` est par utilisateur : ignore). */
function poiData(index: number): Record<string, unknown> {
  const poi = INITIAL_DISCOVERY_POIS[index];
  if (!poi) throw new Error(`Fixture de POI absente a l'index ${index}`);
  return {
    id: poi.id,
    name: poi.name,
    category: poi.category,
    distanceMeters: poi.distanceMeters,
    xpReward: poi.xpReward,
    isTarget: poi.isTarget === true,
    corridorHint: poi.corridorHint,
    coords: { top: poi.coords.top, left: poi.coords.left },
    order: index,
  };
}

/**
 * Champs de `CommunityRoute` issus de la fixture.
 * `kudos` et `liked` ne sont PAS dans `$set` : les re-lancer ne doit pas
 * ecraser les likes reels des joueurs. Le compteur global n'est pose qu'a la
 * CREATION (voir `$setOnInsert`) ; ensuite il ne bouge que via les kudos.
 */
function routeData(index: number): Record<string, unknown> {
  const route = INITIAL_COMMUNITY_ROUTES[index];
  if (!route) throw new Error(`Fixture de route absente a l'index ${index}`);
  return {
    id: route.id,
    handle: route.handle,
    badge: route.badge,
    title: route.title,
    avatarUrl: route.avatarUrl,
    avatarAlt: route.avatarAlt,
    distanceKm: route.distanceKm,
    elevationM: route.elevationM,
    thirdMetricLabel: route.thirdMetricLabel,
    thirdMetricValue: route.thirdMetricValue,
    thirdMetricUnit: route.thirdMetricUnit,
    footerIcon: route.footerIcon,
    footerText: route.footerText,
    accentColor: route.accentColor,
    category: route.category,
    order: index,
  };
}

/** Upsert des territoires (donnee pure : `$set` complet). */
async function seedTerritories(): Promise<number> {
  const ops = TERRITORY_ORDER.map((index) => {
    const data = territoryData(index);
    return {
      updateOne: {
        filter: { id: data.id },
        update: { $set: data },
        upsert: true,
      },
    };
  });
  const result = await Territory.bulkWrite(ops, { ordered: false });
  console.log(
    `[seed] territories : ${TERRITORY_ORDER.length} upsert(s) (${result.upsertedCount} crees, ${result.modifiedCount} mis a jour)`,
  );
  return TERRITORY_ORDER.length;
}

/** Upsert des POI (donnee pure : `$set` complet). */
async function seedPois(): Promise<number> {
  const ops = POI_ORDER.map((index) => ({
    updateOne: {
      filter: { id: poiData(index).id },
      update: { $set: poiData(index) },
      upsert: true,
    },
  }));
  const result = await Poi.bulkWrite(ops, { ordered: false });
  console.log(`[seed] pois : ${POI_ORDER.length} upsert(s) (${result.upsertedCount} crees, ${result.modifiedCount} mis a jour)`);
  return POI_ORDER.length;
}
/** Upsert des routes communautaires (`$set` sans toucher au compteur de likes). */
async function seedCommunityRoutes(): Promise<number> {
  const ops = ROUTE_ORDER.map((index) => {
    const data = routeData(index);
    const route = INITIAL_COMMUNITY_ROUTES[index];
    return {
      updateOne: {
        filter: { id: data.id },
        update: {
          $set: data,
          // Pose une seule fois : un relancement ne reinitialise ni les kudos
          // ni la liste `likedBy` (que `$set` n'effleure pas).
          $setOnInsert: { kudos: route?.kudos ?? 0, likedBy: [] },
        },
        upsert: true,
      },
    };
  });
  const result = await CommunityRoute.bulkWrite(ops, { ordered: false });
  console.log(`[seed] community_routes : ${ROUTE_ORDER.length} upsert(s) (${result.upsertedCount} crees, ${result.modifiedCount} mis a jour)`);
  return ROUTE_ORDER.length;
}

async function main(): Promise<void> {
  let mongodbUri: string;
  try {
    mongodbUri = getEnv().mongodbUri;
  } catch (err: unknown) {
    if (err instanceof EnvValidationError) {
      console.error(`\n[seed] Configuration invalide.\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  // On n'affiche que la description masquee (hote + nom de base), jamais l'URI.
  console.log(`[seed] Cible : ${describeUri(mongodbUri)}`);
  await connectToMongoDB();

  try {
    // Les index uniques doivent exister AVANT les upserts, sinon deux lancements
    // concurrents pourraient creer des doublons.
    await Promise.all([Territory.syncIndexes(), Poi.syncIndexes(), CommunityRoute.syncIndexes()]);

    await seedTerritories();
    await seedPois();
    await seedCommunityRoutes();

    console.log('\n[seed] Termine. Aucun utilisateur cree : utilisez POST /api/auth/register.');
  } finally {
    await disconnectFromMongoDB();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[seed] Echec : ${message}`);
  process.exit(1);
});
