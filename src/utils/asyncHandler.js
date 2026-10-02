// Evite d'ecrire try/catch dans chaque controller : toute erreur async va au middleware d'erreurs.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
