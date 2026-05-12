const express = require("express");

const { adminController } = require("../controllers/admin.controller");

const adminRouter = express.Router();

adminRouter.get("/overview", adminController.overview);
adminRouter.get("/users", adminController.listUsers);
adminRouter.post("/users", adminController.createUser);
adminRouter.patch("/users/:role/:id/status", adminController.updateUserStatus);
adminRouter.delete("/users/:role/:id", adminController.deleteUser);

adminRouter.get("/content", adminController.listContent);
adminRouter.post("/content/:id/approve", adminController.approveContent);
adminRouter.post("/content/:id/deny", adminController.denyContent);

adminRouter.get("/reports", adminController.listReports);
adminRouter.post("/reports/:id/resolve", adminController.resolveReport);
adminRouter.post("/reports/:id/deny", adminController.denyReport);

adminRouter.get("/activity-logs", adminController.activityLogs);
adminRouter.get("/students/targets", adminController.studentTargets);
adminRouter.get("/exams", adminController.listExams);
adminRouter.post("/exams", adminController.createExam);

module.exports = { adminRouter };

