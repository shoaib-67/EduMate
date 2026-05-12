const express = require("express");

const { adminController } = require("../controllers/admin.controller");

const reportsRouter = express.Router();

reportsRouter.post("/", adminController.submitReport);

module.exports = { reportsRouter };

