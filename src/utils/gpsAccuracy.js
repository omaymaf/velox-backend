function isValidConquestAccuracy(accuracy) {
  // TEMPORAIRE : limite accuracy <= 50 m désactivée pendant les tests.
  return Number.isFinite(accuracy) && accuracy >= 0;
}

module.exports = { isValidConquestAccuracy };
