const router = require('express').Router();
const c = require('../controllers/authController');
const validate = require('../middlewares/validate');
const { protect } = require('../middlewares/auth');
const s = require('../validators/schemas');

router.post('/register', validate(s.register), c.register);
router.post('/login', validate(s.login), c.login);
router.get('/me', protect, c.me);

module.exports = router;
