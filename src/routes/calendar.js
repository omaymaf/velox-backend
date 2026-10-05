// backend/src/routes/calendar.js
const router = require("express").Router();
const c = require("../controllers/calendarController");

router.get("/events", c.getEvents);
router.get("/auth-url", c.getAuthUrl);
router.get("/callback", c.callback);

module.exports = router;
