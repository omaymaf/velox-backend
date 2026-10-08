const TUNISIA_BOUNDS = {
  minLatitude: 30,
  maxLatitude: 37.6,
  minLongitude: 7.4,
  maxLongitude: 11.7,
};

const isTunisiaPosition = ([latitude, longitude]) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= TUNISIA_BOUNDS.minLatitude &&
  latitude <= TUNISIA_BOUNDS.maxLatitude &&
  longitude >= TUNISIA_BOUNDS.minLongitude &&
  longitude <= TUNISIA_BOUNDS.maxLongitude;

const distanceMeters = ([lat1, lon1], [lat2, lon2]) => {
  const radius = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const routeLengthKm = (coordinates) =>
  coordinates.slice(1).reduce(
    (total, point, index) => total + distanceMeters(coordinates[index], point) / 1000,
    0,
  );

const simplifyCoordinates = (coordinates, minDistanceMeters = 10) => {
  if (coordinates.length < 3) return coordinates;
  const result = [coordinates[0]];
  for (let index = 1; index < coordinates.length - 1; index += 1) {
    if (distanceMeters(result[result.length - 1], coordinates[index]) >= minDistanceMeters) {
      result.push(coordinates[index]);
    }
  }
  const last = coordinates[coordinates.length - 1];
  if (distanceMeters(result[result.length - 1], last) > 0) result.push(last);
  return result;
};

const routeMetrics = (coordinates) => {
  return {
    perimeterKm: Number(routeLengthKm(coordinates).toFixed(2)),
    center: {
      lat: Number(
        (
          coordinates.slice(0, -1).reduce((total, point) => total + point[0], 0) /
          (coordinates.length - 1)
        ).toFixed(6),
      ),
      lng: Number(
        (
          coordinates.slice(0, -1).reduce((total, point) => total + point[1], 0) /
          (coordinates.length - 1)
        ).toFixed(6),
      ),
    },
  };
};

const distanceToSegmentMeters = (point, start, end) => {
  const latitudeOrigin = ((point[0] + start[0] + end[0]) / 3) * Math.PI / 180;
  const toXY = ([latitude, longitude]) => ({
    x: longitude * Math.PI / 180 * 6371000 * Math.cos(latitudeOrigin),
    y: latitude * Math.PI / 180 * 6371000,
  });
  const p = toXY(point);
  const a = toXY(start);
  const b = toXY(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const ratio = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / denominator));
  return Math.hypot(p.x - a.x - ratio * dx, p.y - a.y - ratio * dy);
};

const coversRoute = (trackedRoute, targetRoute, toleranceMeters = 35) => {
  if (trackedRoute.length < 4 || targetRoute.length < 4) return false;

  for (let index = 1; index < targetRoute.length; index += 1) {
    const start = targetRoute[index - 1];
    const end = targetRoute[index];
    const length = distanceMeters(start, end);
    const sampleCount = Math.max(1, Math.ceil(length / 10));

    for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
      const ratio = sampleIndex / sampleCount;
      const sample = [
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ];
      const covered = trackedRoute.some((point, routeIndex) =>
        routeIndex > 0 &&
        distanceToSegmentMeters(sample, trackedRoute[routeIndex - 1], point) <= toleranceMeters
      );
      if (!covered) return false;
    }
  }

  return (
    distanceMeters(targetRoute[0], targetRoute[targetRoute.length - 1]) <= toleranceMeters &&
    distanceMeters(trackedRoute[0], trackedRoute[trackedRoute.length - 1]) <= toleranceMeters
  );
};

module.exports = {
  TUNISIA_BOUNDS,
  isTunisiaPosition,
  distanceMeters,
  routeLengthKm,
  simplifyCoordinates,
  routeMetrics,
  coversRoute,
};
