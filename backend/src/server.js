const dotenv = require("dotenv");
const path = require("path");

const { ensureDatabaseExists, getPool } = require("./db");
const { ensureSchema } = require("./initDb");
const { createApp } = require("./app");
const { runExamAutomation, startExamAutomationLoop } = require("./services/examAutomation.service");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const PORT = Number(process.env.PORT || 5000);

async function startServer() {
  try {
    await ensureDatabaseExists();
    await ensureSchema();
    getPool();

    await runExamAutomation();
    startExamAutomationLoop();

    const app = createApp();
    app.listen(PORT, () => {
      console.log(`EduMate backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();

