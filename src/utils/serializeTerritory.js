const { getUserColor } = require('./userColor');

const NEUTRAL_COLOR = '#87909b';

function serializeTerritory(territory, userId) {
  const data = territory.toObject();
  const viewer = userId && typeof userId === 'object' ? userId : null;
  const viewerId = viewer?._id || userId;
  const id = String(viewerId || '');
  const ownerId = data.owner?._id || data.owner;
  const creatorId = data.creator?._id || data.creator;
  const challengerId = data.challenger?._id || data.challenger;
  const isMine = Boolean(ownerId && String(ownerId) === id);
  const isCreator = Boolean(creatorId && String(creatorId) === id);
  const isChallenging = Boolean(challengerId && String(challengerId) === id);
  const ownerColor = ownerId
    ? getUserColor(ownerId, isMine ? viewer?.territoryColor : data.owner?.territoryColor)
    : NEUTRAL_COLOR;
  const creatorColor = creatorId
    ? getUserColor(creatorId, isCreator ? viewer?.territoryColor : data.creator?.territoryColor)
    : NEUTRAL_COLOR;
  const segments = (data.segments || []).map((segment) => ({
    ...segment,
    owner: ownerId ? String(ownerId) : null,
    ownerName: data.ownerName || 'Unclaimed',
    color: ownerColor,
  }));

  return {
    id: data.slug,
    tacticalId: data.tacticalId,
    name: data.name,
    shortName: data.shortName,
    status: data.status,
    owner: ownerId ? `${data.ownerName}${isMine ? ' (You)' : ''}` : 'Unclaimed',
    ownerName: data.ownerName || 'Unclaimed',
    creator: creatorId ? String(creatorId) : '',
    creatorName: data.creatorName || '',
    ownerColor,
    creatorColor,
    isMine,
    isCreator,
    areaKm2: data.areaKm2,
    perimeterKm: data.perimeterKm,
    defenseLevel: data.defenseLevel,
    rewardXp: data.rewardXp,
    controlPercent: isChallenging ? data.challengerControlPercent : data.controlPercent,
    challengerControlPercent: data.challengerControlPercent || 0,
    color: ownerColor,
    center: data.center,
    routeCoordinates: data.routeCoordinates || [],
    isClosedLoop: Boolean(data.isClosedLoop),
    areaPolygon: data.areaPolygon || [],
    routeSource: data.routeSource || null,
    segments,
    startPoint: data.startPoint || null,
    distanceKm: data.distanceKm || 0,
    durationSec: data.durationSec || 0,
    gpsUncertain: data.gpsUncertain || false,
    conquestCount: data.conquestCount || 0,
    createdAt: data.createdAt,
  };
}

module.exports = { serializeTerritory, NEUTRAL_COLOR };
