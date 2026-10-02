const router = require('express').Router();
const c = require('../controllers/mapsController');

// Public (une balise <Image> ne peut pas envoyer de token facilement) mais limite par rate-limit dans app.js
router.get('/static', c.staticMap);

module.exports = router;
