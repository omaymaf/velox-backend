const assert = require('node:assert/strict');
const test = require('node:test');
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/velox-test';
process.env.JWT_SECRET = 'territory-tests-only';
process.env.GOOGLE_MAPS_API_KEY = 'mock-google-roads-key';

const samples = require('./seed/sfaxTerritories.json');
const { coversRoute, distanceMeters, isTunisiaPosition, routeLengthKm } = require('./utils/geo');
const { decodePolyline6 } = require('./utils/polyline');
const { getUserColor, PALETTE } = require('./utils/userColor');
const { applyTerritoryConquest } = require('./utils/territoryConquest');
const { serializeTerritory } = require('./utils/serializeTerritory');
const { buildRoadSegments } = require('./utils/roadSegments');
const { isValidConquestAccuracy } = require('./utils/gpsAccuracy');
const { buildAreaPolygon, isClosedLoop } = require('./utils/loopGeometry');
const { snapCoordinates } = require('./services/googleRoadsService');
const TerritoryTrackingSession = require('./models/TerritoryTrackingSession');
const TerritoryConquest = require('./models/TerritoryConquest');
const Territory = require('./models/Territory');

function sampleRoute(sample) {
  const chunks = sample.polylines.map(decodePolyline6);
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(
      distanceMeters(chunks[index - 1].at(-1), chunks[index][0]) <= 25,
      `${sample.slug} has a gap between encoded route chunks`,
    );
  }
  const route = chunks.flatMap((chunk, index) => chunk.slice(index === 0 ? 0 : 1));
  route[route.length - 1] = [...route[0]];
  return route;
}

test('Sfax demo routes are closed, Tunisian cycling routes with expected distances', () => {
  assert.equal(samples.length, 4);
  for (const sample of samples) {
    const route = sampleRoute(sample);
    assert.ok(route.length >= 4);
    assert.equal(sample.routeSource, 'VALHALLA_OSM_BICYCLE');
    assert.match(sample.sourceAttribution, /OpenStreetMap contributors.*Valhalla/);
    assert.ok(sample.waypoints.length >= 3);
    assert.ok(sample.waypoints.every((waypoint) => waypoint.osmId && waypoint.displayName));
    assert.ok(route.every(isTunisiaPosition), `${sample.slug} leaves Tunisia bounds`);
    assert.ok(distanceMeters(route[0], route.at(-1)) <= 1);
    assert.ok(Math.abs(routeLengthKm(route) - sample.distanceKm) < 0.1);
    assert.ok(buildAreaPolygon(route), `${sample.slug} has no valid enclosed area`);
    assert.equal(coversRoute(route, route), true);
    assert.equal(coversRoute(route.slice(0, Math.floor(route.length / 2)), route), false);
  }
});

test('territory storage only accepts GPS-matched or OSM bicycle-routed sources', () => {
  const routedTerritory = new Territory({
    slug: 'sfax-routed',
    tacticalId: 'SFX-001',
    name: 'Sfax routed sample',
    shortName: 'Sfax',
    routeSource: 'VALHALLA_OSM_BICYCLE',
    routeCoordinates: [[34.74, 10.76], [34.741, 10.761]],
  });
  assert.equal(routedTerritory.validateSync(), undefined);

  const unverifiedTerritory = new Territory({
    slug: 'sfax-unverified',
    tacticalId: 'SFX-002',
    name: 'Unverified legacy trace',
    shortName: 'Legacy',
    routeSource: 'RECTANGLE',
  });
  assert.ok(unverifiedTerritory.validateSync());
});

test('territory GPS accuracy is recorded but no longer blocks test captures above 50 m', () => {
  assert.equal(isValidConquestAccuracy(10), true);
  assert.equal(isValidConquestAccuracy(18), true);
  assert.equal(isValidConquestAccuracy(32), true);
  assert.equal(isValidConquestAccuracy(47), true);
  assert.equal(isValidConquestAccuracy(50), true);
  assert.equal(isValidConquestAccuracy(100), true);
  assert.equal(isValidConquestAccuracy(200), true);
  assert.equal(isValidConquestAccuracy(999), true);
  assert.equal(isValidConquestAccuracy(-1), false);
  assert.equal(isValidConquestAccuracy(Number.NaN), false);
});

test('persisted user colors take precedence and are visually distinct', () => {
  assert.deepEqual(PALETTE.slice(0, 4), ['#FFD60A', '#168BFF', '#22C55E', '#EF4444']);
  assert.equal(new Set(PALETTE).size, 7);
  assert.equal(getUserColor('same-user', PALETTE[1]), PALETTE[1]);
});

test('a completed route immediately transfers an owned territory and updates its color', () => {
  const route = sampleRoute(samples[0]);
  const segments = buildRoadSegments(route, '111111111111111111111111', 'User A');
  const territory = {
    owner: '111111111111111111111111',
    ownerName: 'User A',
    color: getUserColor('111111111111111111111111'),
    segments,
    status: 'SECURED',
    controlPercent: 100,
    challenger: null,
    challengerControlPercent: 0,
    conquestCount: 3,
  };
  const outcome = applyTerritoryConquest(territory, {
    _id: '222222222222222222222222',
    username: 'User B',
    territoryColor: PALETTE[1],
  });
  assert.equal(outcome.captured, true);
  assert.equal(outcome.previousOwner, '111111111111111111111111');
  assert.equal(territory.owner, '222222222222222222222222');
  assert.equal(territory.ownerName, 'User B');
  assert.equal(territory.status, 'SECURED');
  assert.equal(territory.controlPercent, 100);
  assert.equal(territory.color, PALETTE[1]);
  assert.ok(territory.segments.every((segment) =>
    segment.owner === '222222222222222222222222' &&
    segment.ownerName === 'User B' &&
    segment.color === PALETTE[1]
  ));
});

test('road segments preserve route shape and owner color without enclosing a surface', () => {
  const route = sampleRoute(samples[0]);
  const segments = buildRoadSegments(route, {
    _id: '222222222222222222222222',
    territoryColor: PALETTE[1],
  }, 'User B');
  assert.equal(segments.length, route.length - 1);
  assert.deepEqual(segments[0].start, route[0]);
  assert.deepEqual(segments[0].end, route[1]);
  assert.deepEqual(segments.at(-1).end, route[0]);
  assert.ok(segments.every((segment) =>
    segment.owner === '222222222222222222222222' &&
    segment.ownerName === 'User B' &&
    segment.color === PALETTE[1]
  ));
  assert.notEqual(segments[0].start, segments[0].end);
});

test('closed road loops produce a surface from the route contour and open routes do not', () => {
  const route = [
    [34.7400, 10.7600],
    [34.7410, 10.7600],
    [34.7410, 10.7610],
    [34.74001, 10.76001],
  ];
  assert.equal(isClosedLoop(route, 1), false);
  assert.equal(isClosedLoop(route, 35), true);

  const area = buildAreaPolygon(route, 35);
  assert.ok(area);
  assert.deepEqual(area.areaPolygon[0], area.areaPolygon.at(-1));
  assert.equal(area.areaPolygon.length, route.length);
  assert.ok(area.areaKm2 > 0);
  assert.deepEqual(buildAreaPolygon([
    [34.74, 10.76],
    [34.741, 10.76],
    [34.74, 10.761],
    [34.742, 10.762],
  ], 35), null);
  const crossingLoop = buildAreaPolygon([
    [34.74, 10.76],
    [34.741, 10.761],
    [34.74, 10.761],
    [34.741, 10.76],
    [34.74, 10.76],
  ], 35);
  assert.ok(crossingLoop);
  assert.equal(crossingLoop.areaKm2, 0);
});

test('territory serialization shows the owner color to every authenticated viewer and gray for free zones', () => {
  const ownerId = '111111111111111111111111';
  const owned = {
    toObject: () => ({
      slug: 'sfax-example',
      owner: { _id: ownerId, territoryColor: PALETTE[0] },
      ownerName: 'User A',
      creator: null,
      status: 'SECURED',
      center: { lat: 34.74, lng: 10.76 },
      routeCoordinates: [[34.74, 10.76], [34.741, 10.761]],
      isClosedLoop: true,
      areaPolygon: [[34.74, 10.76], [34.741, 10.76], [34.74, 10.761], [34.74, 10.76]],
      segments: [{
        start: [34.74, 10.76],
        end: [34.741, 10.761],
        owner: ownerId,
        ownerName: 'User A',
        color: '#87909b',
      }],
    }),
  };
  const ownerView = serializeTerritory(owned, { _id: ownerId, territoryColor: PALETTE[0] });
  const otherView = serializeTerritory(owned, '222222222222222222222222');
  assert.equal(ownerView.isMine, true);
  assert.equal(otherView.isMine, false);
  assert.equal(ownerView.ownerColor, PALETTE[0]);
  assert.equal(otherView.ownerColor, PALETTE[0]);
  assert.equal(otherView.segments[0].color, PALETTE[0]);
  assert.equal(otherView.isClosedLoop, true);
  assert.equal(otherView.areaPolygon.length, 4);
  const legacyWithoutRoadSegments = serializeTerritory({
    toObject: () => ({
      slug: 'legacy-rectangular-zone',
      owner: ownerId,
      ownerName: 'User A',
      originalRoute: [[34.7, 10.7], [34.7, 10.8], [34.8, 10.8], [34.8, 10.7], [34.7, 10.7]],
    }),
  }, '222222222222222222222222');
  assert.deepEqual(legacyWithoutRoadSegments.routeCoordinates, []);

  const free = serializeTerritory({
    toObject: () => ({
      slug: 'sfax-free',
      owner: null,
      ownerName: 'Unclaimed',
      creator: null,
      status: 'NEUTRAL',
      center: { lat: 34.74, lng: 10.76 },
      routeCoordinates: [],
    }),
  }, '222222222222222222222222');
  assert.equal(free.ownerColor, '#87909b');
});

test('the same owner fortifies rather than transferring their territory', () => {
  const territory = {
    owner: '111111111111111111111111',
    ownerName: 'User A',
    color: getUserColor('111111111111111111111111'),
    status: 'SECURED',
    controlPercent: 80,
    challenger: null,
    challengerControlPercent: 0,
    conquestCount: 1,
  };
  const outcome = applyTerritoryConquest(territory, {
    _id: '111111111111111111111111',
    username: 'User A',
  });

  assert.equal(outcome.captured, false);
  assert.equal(outcome.status, 'FORTIFIED');
  assert.equal(territory.owner, '111111111111111111111111');
  assert.equal(territory.controlPercent, 100);
});

test('tracking and conquest documents retain loop, timing, route and ownership fields', () => {
  const tracking = new TerritoryTrackingSession({
    user: '111111111111111111111111',
    purpose: 'CONQUEST',
  });
  assert.equal(tracking.loopClosed, false);
  assert.ok(tracking.startTime instanceof Date);
  assert.equal(tracking.endTime, null);

  const record = new TerritoryConquest({
    user: '222222222222222222222222',
    territory: '333333333333333333333333',
    trackingSession: '444444444444444444444444',
    startTime: new Date(1),
    endTime: new Date(2),
    distanceKm: 7.2,
    loopClosed: true,
    areaPolygon: [[34.74, 10.76], [34.741, 10.76], [34.74, 10.761], [34.74, 10.76]],
    segmentsCaptured: 42,
    coordinates: [[34.74, 10.76], [34.741, 10.761]],
    previousOwner: '111111111111111111111111',
    newOwner: '222222222222222222222222',
    color: getUserColor('222222222222222222222222'),
    status: 'CAPTURED',
  });
  assert.equal(record.validateSync(), undefined);
  assert.equal(record.previousOwner.toString(), '111111111111111111111111');
  assert.equal(record.newOwner.toString(), '222222222222222222222222');
  assert.equal(record.segmentsCaptured, 42);
  assert.equal(record.areaPolygon.length, 4);
});

test('server map matching stores the road coordinates returned by Google Roads', async (t) => {
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = new URL(url);
    const points = requestedUrl.searchParams.get('path').split('|').map((pair) =>
      pair.split(',').map(Number),
    );
    return {
      ok: true,
      json: async () => ({
        snappedPoints: points.map(([latitude, longitude], originalIndex) => ({
          location: { latitude: latitude + 0.00001, longitude },
          originalIndex,
        })),
      }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const rawRoute = [
    [34.74, 10.76],
    [34.741, 10.76],
    [34.741, 10.761],
    [34.74001, 10.76001],
  ];
  const matched = await snapCoordinates(rawRoute, true);

  assert.equal(requestedUrl.hostname, 'roads.googleapis.com');
  assert.equal(requestedUrl.pathname, '/v1/snapToRoads');
  assert.equal(requestedUrl.searchParams.get('interpolate'), 'true');
  assert.equal(matched.coordinates[0][0], rawRoute[0][0] + 0.00001);
  assert.deepEqual(matched.coordinates[0], matched.coordinates.at(-1));
  assert.equal(matched.gpsUncertain, false);
});
