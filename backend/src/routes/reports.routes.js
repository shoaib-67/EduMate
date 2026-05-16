const express = require("express");

const { adminController } = require("../controllers/admin.controller");

const reportsRouter = express.Router();

reportsRouter.get("/", adminController.listOwnReports);
reportsRouter.post("/", adminController.submitReport);

module.exports = { reportsRouter };

