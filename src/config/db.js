const mongoose = require('mongoose');
const env = require('./env');

async function connectDB() {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(env.MONGO_URI);
    console.log(`[VELOX] MongoDB connecte : ${mongoose.connection.name}`);
  } catch (err) {
    console.error('[VELOX] Echec connexion MongoDB :', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
