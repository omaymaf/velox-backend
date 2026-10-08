const { getUserColor } = require('./userColor');

function buildRoadSegments(coordinates, owner = null, ownerName = 'Unclaimed') {
  const color = owner ? getUserColor(owner._id || owner, owner.territoryColor) : '#87909b';
  return coordinates.slice(1).map((end, index) => ({
    start: [...coordinates[index]],
    end: [...end],
    owner: owner?._id || owner,
    ownerName: owner ? ownerName : 'Unclaimed',
    color,
  }));
}

module.exports = { buildRoadSegments };
