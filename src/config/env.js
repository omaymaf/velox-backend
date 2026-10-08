require('dotenv').config();

const required = ['MONGO_URI', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[VELOX] Variables d'environnement manquantes : ${missing.join(', ')}`);
  console.error('        Copie .env.example vers .env et remplis-le.');
  process.exit(1);
}

const territoryLoopClosureMeters = Number(process.env.TERRITORY_LOOP_CLOSURE_METERS || 35);
if (!Number.isFinite(territoryLoopClosureMeters) || territoryLoopClosureMeters < 5 || territoryLoopClosureMeters > 200) {
  throw new Error('TERRITORY_LOOP_CLOSURE_METERS doit etre compris entre 5 et 200 metres');
}

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 5000,
  MONGO_URI: process.env.MONGO_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY || '',
  TERRITORY_LOOP_CLOSURE_METERS: territoryLoopClosureMeters,
};
