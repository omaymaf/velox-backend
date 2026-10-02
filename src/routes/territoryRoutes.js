const router = require('express').Router();
const c = require('../controllers/territoryController');
const { protect } = require('../middlewares/auth');

router.use(protect);
router.get('/', c.list);
router.get('/:slug', c.getOne);

module.exports = router;
