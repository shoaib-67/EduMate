const { getPool } = require("../db");
const { sendSuccess } = require("../lib/http");

const EMPTY_HOME_STATS = {
  hero: {
    activeStudents: 0,
    freePdfNotes: 0,
    freeExams: 0,
  },
  band: {
    practiceAttempts: 0,
    freeVideoClasses: 0,
    freePdfNotes: 0,
    freeTrialDays: 7,
  },
};

async function safeCount(pool, query, params = []) {
  try {
    const [rows] = await pool.query(query, params);
    return Number(rows?.[0]?.total || 0);
  } catch (_error) {
    return 0;
  }
}

const healthController = {
  health: async (req, res) => {
    return sendSuccess(res, { message: "EduMate API is running" });
  },

  publicHomeStats: async (req, res) => {
    try {
      const pool = getPool();

      const students = await safeCount(
        pool,
        `SELECT COUNT(*) AS total FROM students WHERE LOWER(COALESCE(account_status, 'active')) = 'active'`
      );
      const videoFromCourseItems = await safeCount(
        pool,
        `SELECT COUNT(*) AS total FROM instructor_course_items WHERE LOWER(COALESCE(content_type, '')) LIKE '%video%'`
      );
      const pdfFromCourseItems = await safeCount(
        pool,
        `SELECT COUNT(*) AS total FROM instructor_course_items WHERE LOWER(COALESCE(content_type, '')) LIKE '%pdf%'`
      );
      const videoFromSubmissions = await safeCount(
        pool,
        `SELECT COUNT(*) AS total FROM content_submissions WHERE LOWER(COALESCE(type, '')) LIKE '%video%'`
      );
      const pdfFromSubmissions = await safeCount(
        pool,
        `SELECT COUNT(*) AS total FROM content_submissions WHERE LOWER(COALESCE(type, '')) LIKE '%pdf%'`
      );
      const attempts = await safeCount(
        pool,
        `SELECT COUNT(*) AS total FROM student_performance WHERE LOWER(COALESCE(test_type, '')) = 'mock'`
      );
      const examsFromSchedules = await safeCount(pool, `SELECT COUNT(*) AS total FROM exam_schedules`);
      const examsFromInstructorPublished = await safeCount(
        pool,
        `SELECT COUNT(*) AS total FROM instructor_exam_schedules WHERE LOWER(COALESCE(publish_state, '')) = 'published'`
      );

      const videoCount = Math.max(videoFromCourseItems, videoFromSubmissions);
      const pdfCount = Math.max(pdfFromCourseItems, pdfFromSubmissions);
      const freeExamCount = Math.max(examsFromSchedules, examsFromInstructorPublished);
      const trialDays = Number(process.env.FREE_TRIAL_DAYS || 7);

      return sendSuccess(res, {
        data: {
          hero: {
            activeStudents: students,
            freePdfNotes: pdfCount,
            freeExams: freeExamCount,
          },
          band: {
            practiceAttempts: attempts,
            freeVideoClasses: videoCount,
            freePdfNotes: pdfCount,
            freeTrialDays: Number.isFinite(trialDays) ? trialDays : 7,
          },
        },
      });
    } catch (_error) {
      return sendSuccess(res, { data: EMPTY_HOME_STATS });
    }
  },
};

module.exports = { healthController };

