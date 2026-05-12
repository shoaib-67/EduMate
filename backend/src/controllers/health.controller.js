const { getPool } = require("../db");
const { sendSuccess } = require("../lib/http");

const healthController = {
  health: async (req, res) => {
    return sendSuccess(res, { message: "EduMate API is running" });
  },

  publicHomeStats: async (req, res) => {
    const fallback = {
      hero: {
        practiceSets: 525,
        videoLessons: 1300,
        activeLearners: 1800,
      },
      band: {
        practiceAttempts: 1800000,
        freeVideoClasses: 400,
        freePdfNotes: 1000,
        freeTrialDays: 7,
      },
    };

    try {
      const pool = getPool();

      const [[studentsRow]] = await pool.query(`SELECT COUNT(*) AS total FROM students`);
      const [[questionBankRow]] = await pool.query(`SELECT COUNT(*) AS total FROM instructor_question_bank`);
      const [[videoRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM instructor_course_items WHERE LOWER(content_type) LIKE '%video%'`
      );
      const [[pdfRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM instructor_course_items WHERE LOWER(content_type) LIKE '%pdf%'`
      );
      const [[attemptsRow]] = await pool.query(`SELECT COUNT(*) AS total FROM student_performance WHERE test_type = 'mock'`);

      const students = Number(studentsRow?.total || 0);
      const questionBankCount = Number(questionBankRow?.total || 0);
      const videoCount = Number(videoRow?.total || 0);
      const pdfCount = Number(pdfRow?.total || 0);
      const attempts = Number(attemptsRow?.total || 0);

      return sendSuccess(res, {
        data: {
          hero: {
            practiceSets: questionBankCount || fallback.hero.practiceSets,
            videoLessons: videoCount || fallback.hero.videoLessons,
            activeLearners: students || fallback.hero.activeLearners,
          },
          band: {
            practiceAttempts: attempts || fallback.band.practiceAttempts,
            freeVideoClasses: videoCount || fallback.band.freeVideoClasses,
            freePdfNotes: pdfCount || fallback.band.freePdfNotes,
            freeTrialDays: fallback.band.freeTrialDays,
          },
        },
      });
    } catch (_error) {
      return sendSuccess(res, { data: fallback });
    }
  },
};

module.exports = { healthController };

