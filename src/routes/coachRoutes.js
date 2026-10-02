const router = require('express').Router();
const c = require('../controllers/coachController');
const validate = require('../middlewares/validate');
const { protect } = require('../middlewares/auth');
const s = require('../validators/schemas');

router.post('/', protect, validate(s.coach), c.advice);

module.exports = router;
