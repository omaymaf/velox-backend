// backend/src/controllers/calendarController.js
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");
const {
  getUpcomingEvents,
  getAuthUrl,
  getTokensFromCode,
} = require("../services/calendarService");

exports.getEvents = asyncHandler(async (req, res) => {
  try {
    const events = await getUpcomingEvents(5, 7);
    res.json({ success: true, events });
  } catch (e) {
    console.error("Calendar error:", e.message);
    // Si le refresh token n'est pas encore configuré, on renvoie un tableau vide
    // au lieu d'une erreur, pour ne pas casser l'app frontend
    res.json({ success: true, events: [] });
  }
});

exports.getAuthUrl = asyncHandler(async (req, res) => {
  const url = getAuthUrl();
  res.json({ success: true, url });
});

exports.callback = asyncHandler(async (req, res) => {
  const { code } = req.query;
  if (!code) throw new ApiError(400, "Code manquant");

  const tokens = await getTokensFromCode(code);
  console.log("\n=== REFRESH TOKEN À COPIER DANS .env ===");
  console.log(tokens.refresh_token);
  console.log("=========================================\n");

  res.send(
    "Autorisation réussie ! Copiez le refresh_token du terminal dans .env du backend.",
  );
});
