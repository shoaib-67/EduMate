const express = require("express");

const { studentController } = require("../controllers/student.controller");

const studentRouter = express.Router();

studentRouter.get("/:studentId/profile", studentController.getProfile);
studentRouter.patch("/:studentId/profile", studentController.updateProfile);
studentRouter.patch("/:studentId/password", studentController.updatePassword);

studentRouter.get("/:studentId/exams", studentController.listExams);
studentRouter.get("/:studentId/mock-questions", studentController.mockQuestions);
studentRouter.get("/:studentId/question-bank", studentController.questionBankLinks);

studentRouter.get("/:studentId/dashboard", studentController.dashboard);
studentRouter.get("/:studentId/performance", studentController.performanceSummary);
studentRouter.get("/:studentId/performance/subjects", studentController.performanceBySubject);
studentRouter.get("/:studentId/performance/recent-tests", studentController.recentTests);
studentRouter.get("/:studentId/courses", studentController.courses);
studentRouter.post("/:studentId/paid-class-purchase", studentController.purchasePaidClass);
studentRouter.post("/:studentId/performance", studentController.recordPerformance);
studentRouter.post("/:studentId/proctoring-events", studentController.recordProctoringEvent);
studentRouter.get("/:studentId/announcements", studentController.announcements);

module.exports = { studentRouter };

