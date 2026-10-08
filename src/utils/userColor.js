const PALETTE = [
  '#FFD60A',
  '#168BFF',
  '#22C55E',
  '#EF4444',
  '#F97316',
  '#A855F7',
  '#EC4899',
];

const hashId = (value) => {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const getUserColor = (userId, assignedColor) => {
  if (PALETTE.includes(assignedColor)) return assignedColor;
  const hash = hashId(userId);
  return PALETTE[hash % PALETTE.length];
};

module.exports = { getUserColor, PALETTE };
