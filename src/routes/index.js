const router = require('express').Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'velox-api', time: new Date().toISOString() }));
router.use('/auth', require('./authRoutes'));
router.use('/users', require('./userRoutes'));
router.use('/rides', require('./rideRoutes'));
router.use('/territories', require('./territoryRoutes'));
router.use('/pois', require('./poiRoutes'));
router.use('/community', require('./communityRoutes'));
router.use('/coach', require('./coachRoutes'));
router.use('/maps', require('./mapsRoutes'));

module.exports = router;
