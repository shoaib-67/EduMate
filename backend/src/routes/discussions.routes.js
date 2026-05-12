const express = require("express");

const { discussionsController } = require("../controllers/discussions.controller");

const discussionsRouter = express.Router();

discussionsRouter.get("/", discussionsController.list);
discussionsRouter.get("/:discussionId", discussionsController.getOne);
discussionsRouter.post("/", discussionsController.create);
discussionsRouter.post("/:discussionId/reply", discussionsController.reply);

module.exports = { discussionsRouter };

