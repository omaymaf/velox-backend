const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const { distanceMeters, isTunisiaPosition } = require('../utils/geo');

const MAX_ROADS_POINTS = 100;

async function snapCoordinates(coordinates, closeLoop = false, loopClosureMeters = env.TERRITORY_LOOP_CLOSURE_METERS) {
  if (!env.GOOGLE_MAPS_API_KEY) {
    throw new ApiError(503, 'Google Roads non configure sur le serveur');
  }
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    coordinates.length > 5000 ||
    coordinates.some((point) => !Array.isArray(point) || point.length !== 2 || !isTunisiaPosition(point))
  ) {
    throw new ApiError(400, 'Le trace doit contenir entre 2 et 5000 positions GPS en Tunisie');
  }

  const input = coordinates.map(([latitude, longitude]) => [latitude, longitude]);
  if (closeLoop) {
    if (input.length < 4 || distanceMeters(input[0], input[input.length - 1]) > loopClosureMeters) {
      throw new ApiError(400, `La boucle GPS doit revenir a moins de ${loopClosureMeters} m de son point de depart`);
    }
    input[input.length - 1] = [...input[0]];
  }

  const snappedCoordinates = [];
  let gpsUncertain = false;

  for (let start = 0; start < input.length; start += MAX_ROADS_POINTS - 1) {
    const points = input.slice(start, start + MAX_ROADS_POINTS);
    const path = points.map(([latitude, longitude]) => `${latitude},${longitude}`).join('|');
    const url = new URL('https://roads.googleapis.com/v1/snapToRoads');
    url.searchParams.set('path', path);
    url.searchParams.set('interpolate', 'true');
    url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);

    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new ApiError(502, `Google Roads injoignable: ${error.message}`);
    }
    if (!response.ok) {
      const details = await response.text();
      throw new ApiError(502, `Google Roads a refuse le trace (${response.status}): ${details.slice(0, 300)}`);
    }

    const result = await response.json();
    const snappedPoints = result.snappedPoints || [];
    if (snappedPoints.length < 2) {
      throw new ApiError(502, 'Google Roads n’a pas trouve de route cyclable exploitable pour ce segment');
    }
    const matchedOriginalCount = snappedPoints.filter((point) =>
      Number.isInteger(point.originalIndex)
    ).length;
    if (matchedOriginalCount < Math.ceil(points.length * 0.8)) {
      throw new ApiError(422, 'Google Roads n’a pas pu recaler une partie suffisante du parcours');
    }
    const segment = snappedPoints.map(({ location }) => [
      location.latitude,
      location.longitude,
    ]);
    if (start > 0 && snappedCoordinates.length && segment.length) segment.shift();
    snappedCoordinates.push(...segment);
    if (matchedOriginalCount < points.length) {
      gpsUncertain = true;
    }
  }

  if (closeLoop) {
    if (distanceMeters(snappedCoordinates[0], snappedCoordinates[snappedCoordinates.length - 1]) > loopClosureMeters) {
      throw new ApiError(422, 'Le trace ajuste sur les routes ne ferme pas la boucle');
    }
    snappedCoordinates[snappedCoordinates.length - 1] = [...snappedCoordinates[0]];
  }

  return { coordinates: snappedCoordinates, gpsUncertain };
}

module.exports = { snapCoordinates };
