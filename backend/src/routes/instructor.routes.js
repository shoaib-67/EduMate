const express = require("express");

const { instructorController } = require("../controllers/instructor.controller");

const instructorRouter = express.Router();

instructorRouter.get("/:instructorId/profile", instructorController.getProfile);
instructorRouter.patch("/:instructorId/profile", instructorController.updateProfile);
instructorRouter.patch("/:instructorId/password", instructorController.updatePassword);
instructorRouter.get("/:instructorId/workspace", instructorController.workspace);
instructorRouter.post("/:instructorId/course-items", instructorController.createCourseItem);
instructorRouter.post("/:instructorId/question-bank", instructorController.createQuestionBankItem);
instructorRouter.post("/:instructorId/exams", instructorController.createExam);
instructorRouter.post("/:instructorId/student-actions", instructorController.studentAction);
instructorRouter.post("/:instructorId/messages", instructorController.createMessage);
instructorRouter.post("/:instructorId/announcements", instructorController.createAnnouncement);

module.exports = { instructorRouter };

