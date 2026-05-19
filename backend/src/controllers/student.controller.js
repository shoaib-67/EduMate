const bcrypt = require("bcryptjs");

const { getPool } = require("../db");
const { sendSuccess, sendError } = require("../lib/http");
const { parseRequiredId, parsePositiveInteger, parseMcqOptions, resolveAnswerIndex } = require("../lib/parsers");
const {
  deriveBatchFromProgram,
  resolveStudentProgramGroup,
  isAudienceVisibleToStudent,
  normalizeAudienceType,
} = require("../lib/audience");
const { normalizeExamRecord } = require("../lib/examUtils");
const { updateExamStatuses } = require("../services/examAutomation.service");
const { formatAccountStatus } = require("../services/admin.service");

const studentController = {
  getProfile: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) return sendError(res, { status: 422, message: "Valid student ID is required." });

      const pool = getPool();
      const [rows] = await pool.query(
        `
        SELECT student_id, name, email, phone_number, batch_name, course_track, account_status, created_at
        FROM students
        WHERE student_id = ?
        LIMIT 1
        `,
        [studentId]
      );
      if (!rows.length) return sendError(res, { status: 404, message: "Student profile not found." });

      const student = rows[0];
      return sendSuccess(res, {
        data: {
          id: student.student_id,
          fullName: student.name || "",
          email: student.email || "",
          phoneNumber: student.phone_number || "",
          batch: student.batch_name || "",
          program: student.course_track || "",
          accountStatus: formatAccountStatus(student.account_status),
          password: "********",
          createdAt: student.created_at || null,
        },
      });
    } catch (error) {
      return sendError(res, { message: "Could not fetch student profile.", error: error.message });
    }
  },

  updateProfile: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) return sendError(res, { status: 422, message: "Valid student ID is required." });

      const fullName = String(req.body?.fullName || "").trim();
      const phone = String(req.body?.phone || req.body?.phoneNumber || "").trim();
      const program = String(req.body?.program || "").trim();

      if (!fullName) return sendError(res, { status: 422, message: "Full name is required." });

      const allowedPrograms = ["Engineering", "Varsity", "Medical"];
      if (!allowedPrograms.includes(program)) return sendError(res, { status: 422, message: "Please choose a valid program." });

      if (phone && phone.length < 6) return sendError(res, { status: 422, message: "Please provide a valid phone number." });

      const pool = getPool();
      const [rows] = await pool.query(`SELECT student_id FROM students WHERE student_id = ? LIMIT 1`, [studentId]);
      if (!rows.length) return sendError(res, { status: 404, message: "Student profile not found." });

      const mappedBatch = deriveBatchFromProgram(program) || program;
      await pool.query(
        `UPDATE students SET name = ?, phone_number = ?, course_track = ?, batch_name = ? WHERE student_id = ?`,
        [fullName, phone || null, program, mappedBatch, studentId]
      );

      return sendSuccess(res, {
        message: "Profile updated successfully.",
        data: { id: studentId, fullName, phoneNumber: phone || "", program, batch: mappedBatch },
      });
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") {
        return sendError(res, { status: 409, message: "This phone number is already used by another account." });
      }
      return sendError(res, { message: "Could not update profile.", error: error.message });
    }
  },

  updatePassword: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) return sendError(res, { status: 422, message: "Valid student ID is required." });

      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || "");
      const confirmPassword = String(req.body?.confirmPassword || "");

      if (!currentPassword || !newPassword || !confirmPassword) {
        return sendError(res, { status: 422, message: "Current password, new password, and confirm password are required." });
      }
      if (newPassword.length < 8) {
        return sendError(res, { status: 422, message: "New password must be at least 8 characters long." });
      }
      if (newPassword !== confirmPassword) {
        return sendError(res, { status: 422, message: "New password and confirm password do not match." });
      }
      if (currentPassword === newPassword) {
        return sendError(res, { status: 422, message: "New password must be different from your current password." });
      }

      const pool = getPool();
      const [rows] = await pool.query(`SELECT password_hash FROM students WHERE student_id = ? LIMIT 1`, [studentId]);
      if (!rows.length) return sendError(res, { status: 404, message: "Student profile not found." });

      const currentPasswordOk = await bcrypt.compare(currentPassword, rows[0].password_hash || "");
      if (!currentPasswordOk) return sendError(res, { status: 401, message: "Current password is incorrect." });

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await pool.query(`UPDATE students SET password_hash = ? WHERE student_id = ?`, [passwordHash, studentId]);
      return sendSuccess(res, { message: "Password reset successful." });
    } catch (error) {
      return sendError(res, { message: "Could not reset password.", error: error.message });
    }
  },

  listExams: async (req, res) => {
    try {
      const { studentId } = req.params;
      const pool = getPool();
      await updateExamStatuses(pool);

      const [studentRows] = await pool.query(`SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`, [
        studentId,
      ]);
      if (!studentRows.length) return res.status(404).json({ success: false, message: "Student not found." });
      const student = studentRows[0];
      const studentProgramGroup = resolveStudentProgramGroup(student);

      const [rows] = await pool.query(
        `
        SELECT DISTINCT
          e.*,
          e.subject AS title,
          COUNT(DISTINCT ea2.student_id) AS assigned_student_count,
          COUNT(DISTINCT eqm.question_id) AS question_count,
          COUNT(DISTINCT sp.performance_id) AS attempt_count,
          MAX(CASE WHEN ea.student_id = ? THEN 1 ELSE 0 END) AS is_assigned_to_student
        FROM exam_schedules e
        LEFT JOIN exam_assignments ea ON ea.exam_id = e.exam_id
        LEFT JOIN exam_assignments ea2 ON ea2.exam_id = e.exam_id
        LEFT JOIN exam_question_mappings eqm ON eqm.exam_id = e.exam_id
        LEFT JOIN student_performance sp
          ON sp.exam_id = e.exam_id
          AND sp.student_id = ?
          AND LOWER(COALESCE(sp.test_type, '')) LIKE 'mock%'
        GROUP BY e.exam_id
        ORDER BY e.start_time ASC
        `,
        [studentId, studentId]
      );

      const now = new Date();
      const visibleRows = rows.filter((row) => {
        const explicitlyAssigned = Number(row.is_assigned_to_student || 0) === 1;
        const audienceType = normalizeAudienceType(row.audience_type, "batch");
        if (explicitlyAssigned && audienceType === "specific") return true;
        return isAudienceVisibleToStudent({
          audienceType,
          batchName: row.batch_name,
          studentBatchName: student.batch_name,
          studentProgramGroup,
        });
      });
      const exams = visibleRows.map((row) => normalizeExamRecord(row, now));
      const nextExam = exams.find((exam) => ["upcoming", "ongoing"].includes(exam.status)) || null;

      return res.status(200).json({
        success: true,
        data: {
          student: { id: student.student_id, batchName: student.batch_name, courseTrack: student.course_track },
          nextExam,
          exams,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch exam routine.", error: error.message });
    }
  },

  mockQuestions: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) return sendError(res, { status: 422, message: "Valid student ID is required." });

      const rawSubjects = []
        .concat(req.query.subjects || [])
        .concat(req.query.subject || [])
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      const subjects = Array.from(new Set(rawSubjects.map((item) => item.toLowerCase())));
      const examId = parseRequiredId(req.query.examId);
      const requestedCount = Number(req.query.count);
      const count = Number.isFinite(requestedCount) ? Math.max(1, Math.min(100, Math.floor(requestedCount))) : 20;

      const pool = getPool();
      const [studentRows] = await pool.query(`SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`, [
        studentId,
      ]);
      if (!studentRows.length) return sendError(res, { status: 404, message: "Student not found." });
      const student = studentRows[0];
      const studentProgramGroup = resolveStudentProgramGroup(student);

      if (examId) {
        const [attemptRows] = await pool.query(
          `
          SELECT COUNT(*) AS attempt_count
          FROM student_performance
          WHERE student_id = ?
            AND exam_id = ?
            AND LOWER(COALESCE(test_type, '')) LIKE 'mock%'
          `,
          [studentId, examId]
        );
        const usedAttempts = Number(attemptRows[0]?.attempt_count || 0);
        if (usedAttempts >= 3) {
          return sendError(res, {
            status: 403,
            message: "You have already used all 3 attempts for this mock test.",
          });
        }

        const [examRows] = await pool.query(
          `
          SELECT
            e.exam_id,
            e.batch_name,
            e.audience_type,
            MAX(CASE WHEN ea.student_id = ? THEN 1 ELSE 0 END) AS is_assigned_to_student
          FROM exam_schedules e
          LEFT JOIN exam_assignments ea ON ea.exam_id = e.exam_id
          WHERE e.exam_id = ?
          GROUP BY e.exam_id
          LIMIT 1
          `,
          [studentId, examId]
        );

        if (examRows.length) {
          const exam = examRows[0];
          const explicitlyAssigned = Number(exam.is_assigned_to_student || 0) === 1;
          const audienceType = normalizeAudienceType(exam.audience_type, "batch");
          const visibleByAudience = isAudienceVisibleToStudent({
            audienceType,
            batchName: exam.batch_name,
            studentBatchName: student.batch_name,
            studentProgramGroup,
          });

          const canAccessExam = (explicitlyAssigned && audienceType === "specific") || visibleByAudience;
          if (canAccessExam) {
            const [mappedRows] = await pool.query(
              `
              SELECT iq.question_id, iq.subject, iq.question_text, iq.options_text, iq.answer_key, eqm.order_index
              FROM exam_question_mappings eqm
              JOIN instructor_question_bank iq ON iq.question_id = eqm.question_id
              WHERE eqm.exam_id = ?
              ORDER BY eqm.order_index ASC, eqm.mapping_id ASC
              `,
              [examId]
            );

            const mappedQuestions = mappedRows
              .map((row) => {
                const options = parseMcqOptions(row.options_text);
                const answerIndex = resolveAnswerIndex(row.answer_key, options);
                if (options.length < 2 || answerIndex < 0 || answerIndex >= options.length) return null;
                return { id: row.question_id, subject: row.subject, text: row.question_text, opts: options, ans: answerIndex };
              })
              .filter(Boolean)
              .slice(0, count);

            if (mappedQuestions.length) {
              return sendSuccess(res, { data: { questions: mappedQuestions, requestedCount: count, deliveredCount: mappedQuestions.length } });
            }
          }
        }
      }

      const params = [];
      let subjectFilterSql = "";
      if (subjects.length) {
        subjectFilterSql = ` AND LOWER(subject) IN (${subjects.map(() => "?").join(",")})`;
        params.push(...subjects);
      }

      params.push(count * 6);
      const [rows] = await pool.query(
        `
        SELECT question_id, subject, question_text, options_text, answer_key, batch_name, audience_type
        FROM instructor_question_bank
        WHERE question_type = 'MCQ'
          AND approval_status = 'approved'
          ${subjectFilterSql}
        ORDER BY RAND()
        LIMIT ?
        `,
        params
      );

      const questions = rows
        .filter((row) =>
          isAudienceVisibleToStudent({
            audienceType: row.audience_type,
            batchName: row.batch_name,
            studentBatchName: student.batch_name,
            studentProgramGroup,
          })
        )
        .map((row) => {
          const options = parseMcqOptions(row.options_text);
          const answerIndex = resolveAnswerIndex(row.answer_key, options);
          if (options.length < 2 || answerIndex < 0 || answerIndex >= options.length) return null;
          return { id: row.question_id, subject: row.subject, text: row.question_text, opts: options, ans: answerIndex };
        })
        .filter(Boolean)
        .slice(0, count);

      return sendSuccess(res, { data: { questions, requestedCount: count, deliveredCount: questions.length } });
    } catch (error) {
      return sendError(res, { message: "Could not fetch approved mock questions.", error: error.message });
    }
  },

  questionBankLinks: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) return sendError(res, { status: 422, message: "Valid student ID is required." });

      const pool = getPool();
      const [studentRows] = await pool.query(
        `SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`,
        [studentId]
      );
      if (!studentRows.length) return sendError(res, { status: 404, message: "Student not found." });
      const student = studentRows[0];
      const studentProgramGroup = resolveStudentProgramGroup(student);

      const [rows] = await pool.query(
        `
        SELECT
          cs.submission_id AS id,
          cs.title,
          cs.type,
          cs.description,
          cs.course_title AS courseTitle,
          cs.batch_name AS batchName,
          cs.source_ref AS link,
          cs.created_at AS createdAt,
          i.name AS instructorName
        FROM content_submissions cs
        LEFT JOIN instructors i ON i.instructor_id = cs.instructor_id
        WHERE cs.status = 'approved'
          AND LOWER(cs.type) LIKE '%question bank%'
        ORDER BY cs.created_at DESC
        LIMIT 200
        `
      );

      const hasAudienceInfo = Boolean(student.batch_name || student.course_track || studentProgramGroup);
      const visible = hasAudienceInfo
        ? rows.filter((item) =>
            isAudienceVisibleToStudent({
              audienceType: "batch",
              batchName: item.batchName || item.courseTitle || "",
              studentBatchName: student.batch_name,
              studentProgramGroup,
            })
          )
        : rows;

      return sendSuccess(res, { data: visible });
    } catch (error) {
      return sendError(res, { message: "Could not fetch question bank links.", error: error.message });
    }
  },

  dashboard: async (req, res) => {
    try {
      const { studentId } = req.params;
      const pool = getPool();

      const [allPerformance] = await pool.query(
        `SELECT score FROM student_performance WHERE student_id = ? AND include_in_performance = TRUE ORDER BY created_at DESC`,
        [studentId]
      );
      const [avgResult] = await pool.query(`SELECT AVG(score) as average_score FROM student_performance WHERE student_id = ? AND include_in_performance = TRUE`, [
        studentId,
      ]);
      const [bestResult] = await pool.query(`SELECT MAX(score) as best_score FROM student_performance WHERE student_id = ? AND include_in_performance = TRUE`, [
        studentId,
      ]);
      const [mockTests] = await pool.query(
        `SELECT COUNT(*) as count
         FROM student_performance
         WHERE student_id = ?
           AND include_in_performance = TRUE
           AND LOWER(COALESCE(test_type, '')) LIKE 'mock%'`,
        [studentId]
      );
      const [accuracyResult] = await pool.query(
        `SELECT ROUND((SUM(correct_answers) / SUM(total_questions)) * 100, 2) as accuracy 
         FROM student_performance WHERE student_id = ? AND include_in_performance = TRUE AND total_questions > 0`,
        [studentId]
      );
      const [studyDays] = await pool.query(
        `SELECT COUNT(DISTINCT DATE(created_at)) as study_days 
         FROM student_performance WHERE student_id = ? AND include_in_performance = TRUE AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [studentId]
      );
      const [lastTestRows] = await pool.query(
        `
        SELECT subject, test_name, created_at
        FROM student_performance
        WHERE student_id = ?
          AND include_in_performance = TRUE
        ORDER BY created_at DESC, performance_id DESC
        LIMIT 1
        `,
        [studentId]
      );

      const lastTestRow = lastTestRows[0] || null;
      const roundedAverage = avgResult[0]?.average_score ? Math.round(avgResult[0].average_score) : 0;
      const bestScore = bestResult[0]?.best_score || 0;
      const totalAttempts = allPerformance.length;
      const completedMocks = mockTests[0]?.count || 0;
      const accuracy = accuracyResult[0]?.accuracy || 0;
      const studyDaysCount = studyDays[0]?.study_days || 0;

      return res.status(200).json({
        success: true,
        data: {
          totalAttempts,
          totalTests: totalAttempts,
          averageScore: roundedAverage,
          bestScore,
          completedMocks,
          mockTestsCompleted: completedMocks,
          accuracy,
          studyDays: studyDaysCount,
          lastTest: lastTestRow
            ? {
                subject: String(lastTestRow.subject || "General"),
                name: String(lastTestRow.test_name || "Recent test"),
                createdAt: lastTestRow.created_at || null,
              }
            : null,
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch dashboard data.", error: error.message });
    }
  },

  performanceSummary: async (req, res) => {
    try {
      const { studentId } = req.params;
      const pool = getPool();

      const [performanceRows] = await pool.query(
        `
        SELECT performance_id, subject, test_type, score, total_questions, correct_answers, test_name, rank, total_participants, created_at
        FROM student_performance
        WHERE student_id = ?
          AND include_in_performance = TRUE
        ORDER BY created_at DESC
        LIMIT 30
        `,
        [studentId]
      );

      return res.status(200).json({ success: true, data: performanceRows });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch performance data.", error: error.message });
    }
  },

  performanceBySubject: async (req, res) => {
    try {
      const { studentId } = req.params;
      const pool = getPool();
      const [rows] = await pool.query(
        `
        SELECT subject, ROUND(AVG(score), 1) AS averageScore, COUNT(*) AS attempts
        FROM student_performance
        WHERE student_id = ?
          AND include_in_performance = TRUE
        GROUP BY subject
        ORDER BY averageScore DESC
        `,
        [studentId]
      );
      return res.status(200).json({ success: true, data: rows });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch performance by subject.", error: error.message });
    }
  },

  recentTests: async (req, res) => {
    try {
      const { studentId } = req.params;
      const pool = getPool();
      const [rows] = await pool.query(
        `
        SELECT test_name, subject, score, created_at
        FROM student_performance
        WHERE student_id = ?
          AND include_in_performance = TRUE
        ORDER BY created_at DESC
        `,
        [studentId]
      );
      return res.status(200).json({ success: true, data: rows });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch recent tests.", error: error.message });
    }
  },

  courses: async (req, res) => {
    try {
      const { studentId } = req.params;
      const pool = getPool();
      const [studentRows] = await pool.query(`SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`, [
        studentId,
      ]);
      if (!studentRows.length) return res.status(404).json({ success: false, message: "Student not found." });
      const student = studentRows[0];
      const studentProgramGroup = resolveStudentProgramGroup(student);

      const [rows] = await pool.query(
        `
        SELECT
          cs.submission_id AS id,
          cs.course_title AS courseTitle,
          cs.batch_name AS batchName,
          cs.title,
          cs.type,
          cs.description,
          cs.deadline,
          cs.status,
          cs.source_ref AS link,
          cs.created_at AS createdAt,
          LOWER(TRIM(COALESCE(cs.type, ''))) AS normalizedType,
          CASE
            WHEN LOWER(TRIM(COALESCE(cs.type, ''))) = 'paid class'
              AND MAX(CASE WHEN spp.is_active = TRUE THEN 1 ELSE 0 END) = 1
            THEN 1
            WHEN LOWER(TRIM(COALESCE(cs.type, ''))) <> 'paid class'
            THEN 1
            ELSE 0
          END AS hasPaidPermission
        FROM content_submissions cs
        LEFT JOIN student_paid_content_permissions spp
          ON spp.submission_id = cs.submission_id
          AND spp.student_id = ?
        WHERE cs.status = 'approved'
          AND LOWER(COALESCE(cs.type, '')) <> 'exam'
          AND LOWER(COALESCE(cs.type, '')) <> 'announcement'
          AND LOWER(COALESCE(cs.type, '')) <> 'assignment'
        GROUP BY cs.submission_id
        ORDER BY cs.created_at DESC
        LIMIT 200
        `,
        [studentId]
      );

      const hasAudienceInfo = Boolean(student.batch_name || student.course_track || studentProgramGroup);
      const visible = hasAudienceInfo
        ? rows.filter((item) =>
            isAudienceVisibleToStudent({
              audienceType: "batch",
              batchName: item.batchName || item.courseTitle || "",
              studentBatchName: student.batch_name,
              studentProgramGroup,
            })
          )
        : rows;
      return res.status(200).json({ success: true, data: visible });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch courses.", error: error.message });
    }
  },

  purchasePaidClass: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      const submissionId = parseRequiredId(req.body?.submissionId);
      if (!studentId || !submissionId) {
        return sendError(res, { status: 422, message: "Valid student ID and paid class ID are required." });
      }

      const packageRaw = String(req.body?.packageCode || "").trim().toLowerCase();
      const paymentMethod = String(req.body?.paymentMethod || "bkash").trim().toLowerCase();
      const transactionId = String(req.body?.transactionId || "").trim();

      if (!transactionId || transactionId.length < 6) {
        return sendError(res, { status: 422, message: "A valid demo transaction ID is required." });
      }

      const packageCatalog = {
        free: { code: "free", name: "Free Plan", amount: 0 },
        "1month": { code: "1month", name: "1 Month Plan", amount: 499 },
        "3month": { code: "3month", name: "3 Month Plan", amount: 1299 },
      };
      const selectedPackage = packageCatalog[packageRaw];
      if (!selectedPackage) {
        return sendError(res, { status: 422, message: "Please choose a valid package." });
      }

      if (!["bkash", "nagad", "rocket"].includes(paymentMethod)) {
        return sendError(res, { status: 422, message: "Unsupported payment method." });
      }

      const pool = getPool();
      const [studentRows] = await pool.query(
        `SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`,
        [studentId]
      );
      if (!studentRows.length) return sendError(res, { status: 404, message: "Student not found." });
      const student = studentRows[0];
      const studentProgramGroup = resolveStudentProgramGroup(student);

      const [submissionRows] = await pool.query(
        `
        SELECT submission_id, title, batch_name, course_title, status, LOWER(TRIM(COALESCE(type, ''))) AS normalized_type
        FROM content_submissions
        WHERE submission_id = ?
        LIMIT 1
        `,
        [submissionId]
      );
      const submission = submissionRows[0];
      if (!submission) return sendError(res, { status: 404, message: "Paid class content not found." });
      if (String(submission.status || "").toLowerCase() !== "approved" || submission.normalized_type !== "paid class") {
        return sendError(res, { status: 403, message: "This content is not an approved paid class." });
      }

      const visibleToStudent = isAudienceVisibleToStudent({
        audienceType: "batch",
        batchName: submission.batch_name || submission.course_title || "",
        studentBatchName: student.batch_name,
        studentProgramGroup,
      });
      if (!visibleToStudent) {
        return sendError(res, { status: 403, message: "This paid class is not assigned to your batch/program." });
      }

      try {
        await pool.query(
          `
          INSERT INTO paid_class_payments
            (student_id, submission_id, package_code, package_name, amount_bdt, payment_method, transaction_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
          `,
          [
            studentId,
            submissionId,
            selectedPackage.code,
            selectedPackage.name,
            selectedPackage.amount,
            paymentMethod,
            transactionId,
          ]
        );
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") {
          return sendError(res, { status: 409, message: "This transaction ID was already submitted." });
        }
        throw error;
      }

      return sendSuccess(res, {
        status: 201,
        message: "Payment submitted. Awaiting admin approval.",
        data: {
          submissionId,
          packageCode: selectedPackage.code,
          packageName: selectedPackage.name,
          paymentMethod,
          transactionId,
          status: "pending",
        },
      });
    } catch (error) {
      return sendError(res, { message: "Could not complete paid class purchase.", error: error.message });
    }
  },

  recordPerformance: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) return sendError(res, { status: 422, message: "Valid student ID is required." });

      const subject = String(req.body?.subject || "").trim();
      const testType = String(req.body?.testType || "").trim();
      const requestedExamId = parseRequiredId(req.body?.examId);
      const score = Number(req.body?.score || 0);
      const totalQuestions = Number(req.body?.totalQuestions || 0);
      const correctAnswers = Number(req.body?.correctAnswers || 0);
      const testNameInput = String(req.body?.testName || "").trim();
      const testName = testNameInput || `${subject || "General"} Mock`;
      const rank = Number(req.body?.rank || 0);
      const totalParticipants = Number(req.body?.totalParticipants || 0);

      if (!subject || !testType) {
        return sendError(res, { status: 422, message: "Subject and test type are required." });
      }

      const pool = getPool();
      let examId = null;
      if (requestedExamId) {
        const [examRows] = await pool.query(`SELECT exam_id FROM exam_schedules WHERE exam_id = ? LIMIT 1`, [requestedExamId]);
        examId = examRows.length ? requestedExamId : null;
      }

      let includeInPerformance = true;
      if (String(testType || "").toLowerCase().startsWith("mock")) {
        if (examId) {
          const [existingRows] = await pool.query(
            `
            SELECT COUNT(*) AS count
            FROM student_performance
            WHERE student_id = ?
              AND exam_id = ?
              AND LOWER(COALESCE(test_type, '')) LIKE 'mock%'
            `,
            [studentId, examId]
          );
          includeInPerformance = Number(existingRows[0]?.count || 0) === 0;
        } else {
          const [existingRows] = await pool.query(
            `
            SELECT COUNT(*) AS count
            FROM student_performance
            WHERE student_id = ?
              AND LOWER(COALESCE(test_type, '')) LIKE 'mock%'
              AND LOWER(COALESCE(test_name, '')) = LOWER(?)
            `,
            [studentId, testName]
          );
          includeInPerformance = Number(existingRows[0]?.count || 0) === 0;
        }
      }

      await pool.query(
        `
        INSERT INTO student_performance
          (student_id, exam_id, subject, test_type, score, total_questions, correct_answers, test_name, rank, total_participants, include_in_performance)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [studentId, examId, subject, testType, score, totalQuestions, correctAnswers, testName, rank, totalParticipants, includeInPerformance]
      );

      return sendSuccess(res, { status: 201, message: "Performance recorded." });
    } catch (error) {
      return sendError(res, { message: "Could not record performance.", error: error.message });
    }
  },

  recordProctoringEvent: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) return sendError(res, { status: 422, message: "Valid student ID is required." });

      const examId = parseRequiredId(req.body?.examId);
      const eventType = String(req.body?.eventType || "").trim();
      const details = String(req.body?.details || "").trim();

      if (!examId || !eventType) {
        return sendError(res, { status: 422, message: "Exam ID and event type are required." });
      }

      const pool = getPool();
      await pool.query(
        `
        INSERT INTO proctoring_events (student_id, exam_id, event_type, details)
        VALUES (?, ?, ?, ?)
        `,
        [studentId, examId, eventType, details || null]
      );

      return sendSuccess(res, { status: 201, message: "Proctoring event recorded." });
    } catch (error) {
      return sendError(res, { message: "Could not record proctoring event.", error: error.message });
    }
  },

  announcements: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) return sendError(res, { status: 422, message: "Valid student ID is required." });

      const pool = getPool();
      const [studentRows] = await pool.query(`SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`, [
        studentId,
      ]);
      if (!studentRows.length) return sendError(res, { status: 404, message: "Student not found." });

      const student = studentRows[0];
      const studentProgramGroup = resolveStudentProgramGroup(student);

      const [rows] = await pool.query(
        `
        SELECT submission_id AS id, title, description AS content, batch_name AS batchName, created_at AS createdAt
        FROM content_submissions
        WHERE status = 'approved' AND LOWER(type) = 'announcement'
        ORDER BY created_at DESC
        LIMIT 30
        `
      );

      const visible = rows.filter((item) =>
        isAudienceVisibleToStudent({
          audienceType: item.batchName ? "batch" : "all",
          batchName: item.batchName || "All Batches",
          studentBatchName: student.batch_name,
          studentProgramGroup,
        })
      );

      return sendSuccess(res, { data: visible });
    } catch (error) {
      return sendError(res, { message: "Could not fetch announcements.", error: error.message });
    }
  },
};

module.exports = { studentController };

