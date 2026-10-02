const router = require('express').Router();
const c = require('../controllers/poiController');
const { protect } = require('../middlewares/auth');

router.use(protect);
router.get('/', c.list);
router.post('/:slug/checkin', c.checkIn);

module.exports = router;
