const router = require('express').Router();
const c = require('../controllers/territoryController');
const { protect } = require('../middlewares/auth');
const validate = require('../middlewares/validate');
const s = require('../validators/schemas');

router.use(protect);
router.post('/', validate(s.createTerritory), c.create);
router.post('/tracking-sessions', validate(s.startTerritoryTracking), c.startTracking);
router.post('/tracking-sessions/:id/locations', validate(s.appendTerritoryLocations), c.appendLocations);
router.post('/tracking-sessions/:id/finish', c.finishTracking);
router.post('/tracking-sessions/:id/abandon', c.abandonTracking);
router.get('/', c.list);
router.get('/:slug', c.getOne);

module.exports = router;
