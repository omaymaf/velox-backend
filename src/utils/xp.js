// Regle alignee sur le front : niveau 24 -> niveau 25 a 2200 XP  (24*90 + 40 = 2200)
const nextLevelXp = (level) => level * 90 + 40;

/** Ajoute de l'XP a un utilisateur (document Mongoose) et gere les passages de niveau. */
function applyXp(user, amount) {
  user.xp += amount;
  while (user.xp >= nextLevelXp(user.level)) {
    user.level += 1;
  }
  return { xp: user.xp, level: user.level, nextLevelXp: nextLevelXp(user.level) };
}

module.exports = { nextLevelXp, applyXp };
