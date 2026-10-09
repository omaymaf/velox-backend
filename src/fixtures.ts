import type { CommunityRoute, DiscoveryPoi, TerritoryZone } from './types/domain.js';

/**
 * Donnees de REFERENCE partagees, copiees a l'identique depuis l'app mobile :
 *   C:\Users\LENOVO\VeloxMobile\src\data\veloxData.ts
 *
 * Pourquoi une copie et non un import : le backend ne doit pas dependre du
 * code React Native. Ces fixtures alimentent `npm run seed`, et l'app en mode
 * demo affiche les memes valeurs : la synchro doit donc etre fidele.
 *
 * Ecart assume avec la demo : en mode demo, `visited` (POI) et `liked`
 * (routes) sont de l'etat LOCAL d'une session. Cote serveur ils sont deduits
 * par utilisateur (collections `poi_checkins` / `likedBy`), donc un freshly
 * seede les renvoie a `false` pour tout le monde. Voir models/Poi.ts.
 * Corollaire : les `kudos` de seed (42, 89, 64) represents des likes anterieurs
 * a la base, ils n'ont donc pas d'entree correspondante dans `likedBy`.
 * Voir models/CommunityRoute.ts.
 */

/**
 * Liens d'images repris de `VELOX_IMAGES` (app mobile). Seules les trois
 * URLs utilisees par les fixtures communautaires sont recopiees, plus une
 * image de repli pour une route publiee par un utilisateur sans avatar.
 */
export const FIXTURE_IMAGES = {
  avatarClara:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCng7narO9FExWoYsbyF5zbxdSxbmRAAVJt9dLaJ0jz_R98Lp4FOpRwpfh6NSq4HqPVnvDGQkRskP6axP0JswKtWCZPHc98cPv3AvnXlWwrrK7xScuSm2Q1N4c3hmt2SOaBIO-pfH0gdusq6EHfylZmUIfIDXhdiwPZWdCFk4BAeQx3_iPBvSORN3FPzghGGTnAOGIRo-koyhbJ49HaYbRlFUO98zNG6t_VDKzeGsDeHaczSA1xVoG8fA',
  avatarThomas:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuAyRNaC6cBwq-YBtrXXN9-pSlnfOopbFy7XLA8_vUBZhnjfRiLsvCp9CAGOP-xWDxh7-JBnGY0BZoklsAoAzE_u9I17Baf18BURI9Gmh6OQ8hYWeVMtQS6LdTrkj6YbpwCwj0E2v72Cve5fni33nQ5Kf_tba-XlydTrIGSKbVs4Y0CzP4C_C8DQkscgJWehjYuptPk55itiv6Gk-NlrsN7IuOAc5SxauKjGBvrKz4mp-gRSr7iSfnJ9SQ',
  avatarAlexHome:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuCNnW2lOOHaEAuL9Hg0jDsQjc7Elx9xM-0NJFLHlQ7HLO9hEh_TKptRliNCicpdMwWV-A2vToVylY2KXh9fsQ216t9smSpCCpXcZGnTBY7t3qHTG8MfVfQUx7XvBQizX4e0RlC7Tj68cXg7H0xp0Uxyy8_rYI0NYGZZWjQKgvR3jj1Ff7m8j22JfteF8XYScYUf4xhIEifbaM-D_IEIzqIFeMD2L2NG6ZofqvftUQMjrbViKzhZe1uR-g',
  /** Repli : avatar de l'en-tete du fil communautaire. */
  avatarCommunityHeader:
    'https://lh3.googleusercontent.com/aida-public/AB6AXuBEQqTBbz1YDYsWd8z6ttAOsvXWYCjm5GMxzBjHn0EVNx5wxM_HOW3DUKCXm67JpQjHjnsWSOhtj_WppF-eu5M2pWLlgtsSedTw0KC0_9ARi_9w6FiMEL8-FOjO6nackDyZJb_gtRmIHIHgu8LV9MPIjLmIpjVUbTvgJqGUcGQQFM_YA1OEslUwxtIZjYdrl_25cDv9-0UUc_p5pPsjaQaK7DywQLE13ewht7L-IpjayBHm7KCfqngiww',
} as const;

/** 4 territoires de reference (ordre d'origine preserve via l'index). */
export const INITIAL_TERRITORIES: TerritoryZone[] = [
  {
    id: 'bastille-4',
    tacticalId: 'SEC-04B',
    name: 'Zone: Bastille Sector 4',
    shortName: 'BASTILLE SECTOR 4',
    status: 'CONTESTED',
    owner: 'Marc_Sprint',
    areaKm2: 2.8,
    defenseLevel: 'Lvl 4 Shield',
    rewardXp: 250,
    controlPercent: 64,
    color: 'magenta',
  },
  {
    id: 'republique-02',
    tacticalId: 'SEC-02D',
    name: 'Zone: République D-02',
    shortName: 'REPUBLIQUE D-02',
    status: 'SECURED',
    owner: 'Alex_Velox (You)',
    areaKm2: 5.4,
    defenseLevel: 'Lvl 5 Bastion',
    rewardXp: 180,
    controlPercent: 98,
    color: 'lime',
  },
  {
    id: 'marais-01',
    tacticalId: 'SEC-01S',
    name: 'Zone: Marais S-01',
    shortName: 'MARAIS S-01',
    status: 'SECURED',
    owner: 'Alex_Velox (You)',
    areaKm2: 4.2,
    defenseLevel: 'Lvl 6 Fortress',
    rewardXp: 150,
    controlPercent: 100,
    color: 'cyan',
  },
  {
    id: 'neutral-12',
    tacticalId: 'SEC-12N',
    name: 'Zone: Neutral Sector 12',
    shortName: 'NEUTRAL SECTOR 12',
    status: 'NEUTRAL',
    owner: 'Unclaimed',
    areaKm2: 3.1,
    defenseLevel: 'No Shield',
    rewardXp: 300,
    controlPercent: 0,
    color: 'neutral',
  },
];

/** 4 points d'interet de reference. `visited` est ignore au seed (par utilisateur). */
export const INITIAL_DISCOVERY_POIS: DiscoveryPoi[] = [
  {
    id: 'pont-neuf',
    name: 'Pont Neuf Arch',
    category: 'Target Landmark',
    distanceMeters: 350,
    xpReward: 50,
    visited: false,
    isTarget: true,
    corridorHint: 'Follow glowing cyan corridor via Quai des Orfèvres',
    coords: { top: '480px', left: '225px' },
  },
  {
    id: 'clock-tower',
    name: 'Clock Tower',
    category: 'Historic Monument',
    distanceMeters: 620,
    xpReward: 75,
    visited: false,
    isTarget: false,
    corridorHint: 'Continue north along Boulevard du Palais sprint lane',
    coords: { top: '340px', left: '285px' },
  },
  {
    id: 'st-paul-vaults',
    name: 'St. Paul Vaults',
    category: 'Verified Landmark',
    distanceMeters: 0,
    xpReward: 50,
    visited: true,
    isTarget: false,
    corridorHint: 'Landmark already captured in current session',
    coords: { top: '540px', left: '140px' },
  },
  {
    id: 'place-des-vosges',
    name: 'Place des Vosges',
    category: 'Verified Landmark',
    distanceMeters: 0,
    xpReward: 50,
    visited: true,
    isTarget: false,
    corridorHint: 'Landmark already captured in current session',
    coords: { top: '750px', left: '50px' },
  },
];

/** 3 routes communautaires de reference. `liked` est ignore au seed (par utilisateur). */
export const INITIAL_COMMUNITY_ROUTES: CommunityRoute[] = [
  {
    id: 'canal-st-martin',
    handle: '@Clara_Wheels',
    badge: 'LVL 18',
    title: 'Canal Saint-Martin Sprint Loop',
    avatarUrl: FIXTURE_IMAGES.avatarClara,
    avatarAlt:
      'Close up athletic avatar profile of female cyclist Clara with fluorescent yellow mirrored cycling eyewear and aerodynamic road bike helmet.',
    kudos: 42,
    liked: false,
    distanceKm: 12.4,
    elevationM: 85,
    thirdMetricLabel: 'Avg Pace',
    thirdMetricValue: '34.2',
    thirdMetricUnit: 'KM/H',
    footerIcon: 'group',
    footerText: '6 riders pacing now',
    accentColor: 'lime',
    category: 'Sprint',
  },
  {
    id: 'montmartre-climber',
    handle: '@Thomas_V',
    badge: 'PRO KOM',
    title: 'Montmartre Climber Challenge',
    avatarUrl: FIXTURE_IMAGES.avatarThomas,
    avatarAlt:
      'Athletic portrait of male cyclist Thomas wearing a matte black cycling cap and aerodynamic glasses with cold cyan neon reflection.',
    kudos: 89,
    liked: false,
    distanceKm: 8.2,
    elevationM: 210,
    thirdMetricLabel: 'Max Grade',
    thirdMetricValue: '14.8',
    thirdMetricUnit: '%',
    footerIcon: 'local_fire_department',
    footerText: 'Gradient King segment',
    accentColor: 'cyan',
    category: 'Climb',
  },
  {
    id: 'bastille-night-sprint',
    handle: '@Alex_Velox',
    badge: 'LVL 24',
    title: 'Evening Urban Sprint • Paris Bastille Loop',
    avatarUrl: FIXTURE_IMAGES.avatarAlexHome,
    avatarAlt: 'Alex cyclist profile avatar',
    kudos: 64,
    liked: true,
    distanceKm: 10.4,
    elevationM: 145,
    thirdMetricLabel: 'Max Peak',
    thirdMetricValue: '41.5',
    thirdMetricUnit: 'KM/H',
    footerIcon: 'military_tech',
    footerText: 'New 10km PB Record (-1:15)',
    accentColor: 'magenta',
    category: 'Trending',
  },
];
