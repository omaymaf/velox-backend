const router = require('express').Router();
const c = require('../controllers/communityController');
const validate = require('../middlewares/validate');
const { protect } = require('../middlewares/auth');
const s = require('../validators/schemas');

router.use(protect);
router.get('/', c.feed);
router.post('/', validate(s.createPost), c.create);
router.post('/:id/kudos', c.toggleKudos);

module.exports = router;
