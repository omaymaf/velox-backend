const { getUserColor } = require('./userColor');

function applyTerritoryConquest(territory, user) {
  const previousOwner = territory.owner || null;
  const wasMine = String(previousOwner || '') === String(user._id);
  const previousControlPercent = territory.controlPercent;
  territory.conquestCount += 1;

  if (wasMine) {
    territory.controlPercent = Math.min(100, territory.controlPercent + 20);
  } else {
    territory.owner = user._id;
    territory.ownerName = user.username;
    territory.status = 'SECURED';
    territory.controlPercent = 100;
    territory.challenger = null;
    territory.challengerControlPercent = 0;
    territory.color = getUserColor(user._id, user.territoryColor);
    territory.segments = (territory.segments || []).map((segment) => {
      const segmentData = typeof segment.toObject === 'function' ? segment.toObject() : segment;
      return {
        ...segmentData,
        owner: String(user._id),
        ownerName: user.username,
        color: territory.color,
      };
    });
    if (territory.areaPolygon?.length >= 4) territory.isClosedLoop = true;
  }

  return {
    wasMine,
    captured: !wasMine,
    previousOwner,
    previousControlPercent,
    newControlPercent: territory.controlPercent,
    status: wasMine ? 'FORTIFIED' : 'CAPTURED',
    ownerColor: getUserColor(user._id, user.territoryColor),
  };
}

module.exports = { applyTerritoryConquest };
