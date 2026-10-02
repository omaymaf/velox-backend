const router = require('express').Router();
const c = require('../controllers/userController');
const validate = require('../middlewares/validate');
const { protect } = require('../middlewares/auth');
const s = require('../validators/schemas');

router.use(protect);
router.get('/me', c.getMe);
router.patch('/me', validate(s.updateProfile), c.updateMe);
router.patch('/me/gps', validate(s.setGps), c.setGps);
router.get('/me/weekly', c.weekly);

module.exports = router;
