const router = require('express').Router();
const c = require('../controllers/mapsController');
const validate = require('../middlewares/validate');
const { protect } = require('../middlewares/auth');
const s = require('../validators/schemas');

// Public (une balise <Image> ne peut pas envoyer de token facilement) mais limite par rate-limit dans app.js
router.get('/static', c.staticMap);
router.post('/snap-to-roads', protect, validate(s.snapToRoads), c.snapToRoads);

module.exports = router;
