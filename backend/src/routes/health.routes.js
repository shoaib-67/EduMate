const express = require("express");

const { healthController } = require("../controllers/health.controller");

const healthRouter = express.Router();

healthRouter.get("/health", healthController.health);
healthRouter.get("/public/home-stats", healthController.publicHomeStats);

module.exports = { healthRouter };

