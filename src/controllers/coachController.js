const env = require('../config/env');
const asyncHandler = require('../utils/asyncHandler');

const FALLBACK = {
  coachAdvice:
    'Maintiens une regularite de cadence sur le secteur Bastille. Augmente le seuil anaerobie lors des relances de 30 secondes.',
  recommendedWatts: 320,
  cadenceFocus: '94-98 RPM',
  nextChallenge: 'Sprint Bastille Overdrive',
};

// La cle Gemini reste sur le serveur : le mobile appelle uniquement /api/coach
exports.advice = asyncHandler(async (req, res) => {
  const { avgWatts, distanceKm, lastRideMode } = req.body;
  const user = req.user;

  if (!env.GEMINI_API_KEY) return res.json({ success: true, source: 'fallback', coach: FALLBACK });

  const prompt = `Tu es VELOX AI Coach, l'intelligence cybernetique haute performance d'une application de cyclisme gamifiee.
Donnees de l'athlete :
- Niveau : ${user.level}
- Puissance moyenne : ${avgWatts || 285} W
- Distance recente : ${distanceKm || 10.4} km
- Mode recent : ${lastRideMode || 'PERFORMANCE'}

Reponds UNIQUEMENT avec un objet JSON valide, sans markdown, sous ce format :
{"coachAdvice":"Conseil concis (2-3 phrases), percutant et strategique.","recommendedWatts":325,"cadenceFocus":"94-98 RPM","nextChallenge":"Nom d'un defi personnalise"}`;

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
      }),
    });
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const data = await r.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return res.json({ success: true, source: 'gemini', coach: JSON.parse(raw) });
  } catch (err) {
    console.warn('[VELOX] Coach IA indisponible, fallback :', err.message);
    return res.json({ success: true, source: 'fallback', coach: FALLBACK });
  }
});
