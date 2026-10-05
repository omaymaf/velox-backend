require("./src/config/env"); // charge et valide .env en premier
const app = require("./src/app");
const connectDB = require("./src/config/db");
const env = require("./src/config/env");

async function start() {
  await connectDB();
  const server = app.listen(env.PORT, "0.0.0.0", () => {
    console.log(
      `[VELOX] API demarree sur http://localhost:${env.PORT} (${env.NODE_ENV})`,
    );
  });

  const shutdown = (signal) => {
    console.log(`\n[VELOX] ${signal} recu, arret propre...`);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();
