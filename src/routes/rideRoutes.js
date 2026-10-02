const router = require('express').Router();
const c = require('../controllers/rideController');
const validate = require('../middlewares/validate');
const { protect } = require('../middlewares/auth');
const s = require('../validators/schemas');

router.use(protect);
router.post('/', validate(s.createRide), c.createRide);
router.get('/', c.listMyRides);
router.get('/:id', c.getRide);

module.exports = router;
