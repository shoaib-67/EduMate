const express = require("express");

const { studyCirclesController } = require("../controllers/studyCircles.controller");

const studyCirclesRouter = express.Router();

studyCirclesRouter.get("/", studyCirclesController.list);
studyCirclesRouter.get("/:circleId/members", studyCirclesController.members);
studyCirclesRouter.post("/:circleId/join", studyCirclesController.join);

module.exports = { studyCirclesRouter };

