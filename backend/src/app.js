const express = require("express");
const cors = require("cors");
const path = require("path");

const { healthRouter } = require("./routes/health.routes");
const { authRouter } = require("./routes/auth.routes");
const { adminRouter } = require("./routes/admin.routes");
const { reportsRouter } = require("./routes/reports.routes");
const { instructorRouter } = require("./routes/instructor.routes");
const { studentRouter } = require("./routes/student.routes");
const { discussionsRouter } = require("./routes/discussions.routes");
const { studyCirclesRouter } = require("./routes/studyCircles.routes");

function createApp() {
  const app = express();
  const frontendPath = path.resolve(__dirname, "../../frontend");
  app.set("etag", false);
  app.use(cors());
  app.use(express.json());
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    next();
  });

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/instructor", instructorRouter);
  app.use("/api/student", studentRouter);
  app.use("/api/discussions", discussionsRouter);
  app.use("/api/study-circles", studyCirclesRouter);
  app.use(express.static(frontendPath));
  app.get("/", (req, res) => {
    res.sendFile(path.join(frontendPath, "index.html"));
  });

  return app;
}

module.exports = { createApp };

