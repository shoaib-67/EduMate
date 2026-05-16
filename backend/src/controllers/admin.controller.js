const bcrypt = require("bcryptjs");

const { getPool } = require("../db");
const { sendSuccess, sendError } = require("../lib/http");
const { parseRequiredId, parsePositiveInteger, parseQuestionIds } = require("../lib/parsers");
const { normalizeAudienceType, resolveStudentProgramGroup, isAudienceVisibleToStudent } = require("../lib/audience");
const { toDateTimeValue, formatSqlDateTime, parseSqlDateTime, normalizeExamRecord } = require("../lib/examUtils");
const {
  USER_ROLE_CONFIG,
  getManageableUserConfig,
  formatAccountStatus,
  sanitizeAdminUserPayload,
  validateAccountPayload,
  logAdminActivity,
} = require("../services/admin.service");
const {
  updateExamStatuses,
  runExamAutomation,
  findExamConflict,
} = require("../services/examAutomation.service");
const { syncPendingInstructorExamSubmissions } = require("../services/instructor.service");

const adminController = {
  overview: async (_req, res) => {
    try {
      const pool = getPool();
      await syncPendingInstructorExamSubmissions(pool);

      const [studentRows] = await pool.query("SELECT COUNT(*) as count FROM students");
      const [instructorRows] = await pool.query("SELECT COUNT(*) as count FROM instructors");
      const [adminRows] = await pool.query("SELECT COUNT(*) as count FROM admins");
      const [activeStudentRows] = await pool.query("SELECT COUNT(*) as count FROM students WHERE account_status = 'active'");
      const [activeInstructorRows] = await pool.query(
        "SELECT COUNT(*) as count FROM instructors WHERE account_status = 'active'"
      );

      const [pendingContentRows] = await pool.query(
        "SELECT COUNT(*) as count FROM content_submissions WHERE status = 'pending'"
      );
      const [approvedContentRows] = await pool.query(
        "SELECT COUNT(*) as count FROM content_submissions WHERE status = 'approved'"
      );
      const [totalContentRows] = await pool.query("SELECT COUNT(*) as count FROM content_submissions");

      const [openReportsRows] = await pool.query("SELECT COUNT(*) as count FROM reports WHERE status = 'open'");
      const [totalReportsRows] = await pool.query("SELECT COUNT(*) as count FROM reports");
      const [completedReportsRows] = await pool.query("SELECT COUNT(*) as count FROM reports WHERE status = 'completed'");

      const [newSignups] = await pool.query(
        `
        SELECT COUNT(*) as count
        FROM (
          SELECT created_at FROM students WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          UNION ALL
          SELECT created_at FROM instructors WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ) recent_accounts
        `
      );

      const totalActiveUsers = (activeStudentRows[0]?.count || 0) + (activeInstructorRows[0]?.count || 0);

      return res.status(200).json({
        success: true,
        data: {
          activeUsers: totalActiveUsers,
          totalStudents: studentRows[0]?.count || 0,
          totalInstructors: instructorRows[0]?.count || 0,
          totalAdmins: adminRows[0]?.count || 0,
          newSignups: newSignups[0]?.count || 0,
          pendingReports: openReportsRows[0]?.count || 0,
          totalReports: totalReportsRows[0]?.count || 0,
          completedReports: completedReportsRows[0]?.count || 0,
          contentUpdates: pendingContentRows[0]?.count || 0,
          approvedContent: approvedContentRows[0]?.count || 0,
          totalContent: totalContentRows[0]?.count || 0,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Could not fetch overview data.",
        error: error.message,
      });
    }
  },

  listUsers: async (_req, res) => {
    try {
      const pool = getPool();

      const userQueries = Object.values(USER_ROLE_CONFIG).map((config) =>
        pool.query(
          `SELECT ${config.idColumn} as id, name, email, phone_number as phoneNumber,
                  ? as role, account_status as accountStatus, created_at as createdAt
           FROM ${config.table}
           ORDER BY created_at DESC`,
          [config.displayRole]
        )
      );

      const userResults = await Promise.all(userQueries);
      const allUsers = userResults
        .flatMap(([rows]) => rows)
        .map((user) => sanitizeAdminUserPayload(user))
        .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));

      return res.status(200).json({
        success: true,
        data: allUsers,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Could not fetch users.",
        error: error.message,
      });
    }
  },

  listStudentPaidContentAccess: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      if (!studentId) {
        return res.status(422).json({ success: false, message: "Valid student ID is required." });
      }

      const pool = getPool();
      const [studentRows] = await pool.query(
        `SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`,
        [studentId]
      );
      if (!studentRows.length) {
        return res.status(404).json({ success: false, message: "Student not found." });
      }
      const student = studentRows[0];
      const studentProgramGroup = resolveStudentProgramGroup(student);

      const [rows] = await pool.query(
        `
        SELECT
          cs.submission_id AS submissionId,
          cs.title,
          cs.course_title AS courseTitle,
          cs.batch_name AS batchName,
          cs.type,
          cs.created_at AS createdAt,
          COALESCE(spp.is_active, FALSE) AS granted
        FROM content_submissions cs
        LEFT JOIN student_paid_content_permissions spp
          ON spp.submission_id = cs.submission_id
          AND spp.student_id = ?
        WHERE cs.status = 'approved'
          AND LOWER(TRIM(COALESCE(cs.type, ''))) = 'paid class'
        ORDER BY cs.created_at DESC
        `,
        [studentId]
      );

      const visibleRows = rows.filter((item) =>
        isAudienceVisibleToStudent({
          audienceType: "batch",
          batchName: item.batchName || item.courseTitle || "",
          studentBatchName: student.batch_name,
          studentProgramGroup,
        })
      );

      return res.status(200).json({
        success: true,
        data: visibleRows,
        meta: {
          studentBatch: student.batch_name || "",
          studentProgram: student.course_track || "",
          studentProgramGroup: studentProgramGroup || "",
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch paid class access.", error: error.message });
    }
  },

  updateStudentPaidContentAccess: async (req, res) => {
    try {
      const studentId = parseRequiredId(req.params.studentId);
      const submissionId = parseRequiredId(req.params.submissionId);
      const granted = Boolean(req.body?.granted);
      const adminId = parseRequiredId(req.body?.adminId) || null;

      if (!studentId || !submissionId) {
        return res.status(422).json({ success: false, message: "Valid student ID and submission ID are required." });
      }

      const pool = getPool();
      const [studentRows] = await pool.query(
        `SELECT student_id, name, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`,
        [studentId]
      );
      if (!studentRows.length) {
        return res.status(404).json({ success: false, message: "Student not found." });
      }
      const student = studentRows[0];
      const studentProgramGroup = resolveStudentProgramGroup(student);

      const [contentRows] = await pool.query(
        `
        SELECT submission_id, title, type, batch_name, course_title
        FROM content_submissions
        WHERE submission_id = ?
          AND status = 'approved'
          AND LOWER(TRIM(COALESCE(type, ''))) = 'paid class'
        LIMIT 1
        `,
        [submissionId]
      );
      if (!contentRows.length) {
        return res.status(404).json({ success: false, message: "Paid class content not found." });
      }
      const content = contentRows[0];

      const visibleToStudent = isAudienceVisibleToStudent({
        audienceType: "batch",
        batchName: content.batch_name || content.course_title || "",
        studentBatchName: student.batch_name,
        studentProgramGroup,
      });
      if (!visibleToStudent) {
        return res.status(403).json({
          success: false,
          message: "This paid class is outside the student's program/batch and cannot be granted.",
        });
      }

      await pool.query(
        `
        INSERT INTO student_paid_content_permissions
          (student_id, submission_id, granted_by_admin_id, is_active)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          granted_by_admin_id = VALUES(granted_by_admin_id),
          is_active = VALUES(is_active)
        `,
        [studentId, submissionId, adminId, granted]
      );

      await logAdminActivity(pool, {
        action: granted ? "granted_paid_content_access" : "revoked_paid_content_access",
        targetType: "student",
        targetId: Number(studentId),
        targetLabel: student?.name || `Student #${studentId}`,
        details: {
          submissionId: Number(submissionId),
          contentTitle: content?.title || null,
          studentProgram: student?.course_track || null,
          studentBatch: student?.batch_name || null,
        },
      });

      return res.status(200).json({
        success: true,
        message: granted ? "Paid class access granted." : "Paid class access revoked.",
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not update paid class access.", error: error.message });
    }
  },

  createUser: async (req, res) => {
    try {
      const validation = validateAccountPayload(req.body || {});

      if (validation.error) {
        return res.status(422).json({
          success: false,
          message: validation.error,
        });
      }

      const { fullName, email, phone, password, role } = validation.value;
      const config = getManageableUserConfig(role);
      const pool = getPool();

      const [existingRows] = await pool.query(
        `SELECT ${config.idColumn} FROM ${config.table} WHERE email = ? OR phone_number = ? LIMIT 1`,
        [email, phone]
      );

      if (existingRows.length > 0) {
        return res.status(409).json({
          success: false,
          message: `A ${config.displayRole.toLowerCase()} account with this email or phone already exists.`,
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const [result] = await pool.query(
        `INSERT INTO ${config.table} (name, email, phone_number, password_hash, account_status)
         VALUES (?, ?, ?, ?, 'active')`,
        [fullName, email, phone, passwordHash]
      );

      await logAdminActivity(pool, {
        action: "created_account",
        targetType: role,
        targetId: result.insertId,
        targetLabel: fullName,
        details: { role: config.displayRole, email },
      });

      return res.status(201).json({
        success: true,
        message: `${config.displayRole} account created successfully.`,
        data: {
          id: result.insertId,
          name: fullName,
          email,
          phoneNumber: phone,
          role: config.displayRole,
          status: "Active",
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Could not create user account.",
        error: error.message,
      });
    }
  },

  updateUserStatus: async (req, res) => {
    try {
      const { role, id } = req.params;
      const requestedStatus = String(req.body?.status || "").trim().toLowerCase();
      const nextStatus = requestedStatus === "frozen" ? "frozen" : "active";
      const config = getManageableUserConfig(role);

      if (!config) {
        return res.status(422).json({
          success: false,
          message: "Only student and instructor accounts can be frozen or unfrozen.",
        });
      }

      const pool = getPool();
      const [accountRows] = await pool.query(`SELECT name, email FROM ${config.table} WHERE ${config.idColumn} = ? LIMIT 1`, [
        id,
      ]);

      if (accountRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User account not found.",
        });
      }

      const [result] = await pool.query(`UPDATE ${config.table} SET account_status = ? WHERE ${config.idColumn} = ?`, [
        nextStatus,
        id,
      ]);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "User account not found.",
        });
      }

      await logAdminActivity(pool, {
        action: nextStatus === "frozen" ? "froze_account" : "unfroze_account",
        targetType: role,
        targetId: Number(id),
        targetLabel: accountRows[0].name,
        details: { email: accountRows[0].email, role: config.displayRole },
      });

      return res.status(200).json({
        success: true,
        message: `${config.displayRole} account ${nextStatus === "frozen" ? "frozen" : "unfrozen"} successfully.`,
        data: {
          id: Number(id),
          role: config.displayRole,
          status: formatAccountStatus(nextStatus),
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Could not update account status.",
        error: error.message,
      });
    }
  },

  deleteUser: async (req, res) => {
    try {
      const { role, id } = req.params;
      const config = getManageableUserConfig(role);

      if (!config) {
        return res.status(422).json({
          success: false,
          message: "Only student and instructor accounts can be deleted here.",
        });
      }

      const pool = getPool();
      const [accountRows] = await pool.query(`SELECT name, email FROM ${config.table} WHERE ${config.idColumn} = ? LIMIT 1`, [
        id,
      ]);

      if (accountRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User account not found.",
        });
      }

      const [result] = await pool.query(`DELETE FROM ${config.table} WHERE ${config.idColumn} = ?`, [id]);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "User account not found.",
        });
      }

      await logAdminActivity(pool, {
        action: "deleted_account",
        targetType: role,
        targetId: Number(id),
        targetLabel: accountRows[0].name,
        details: { email: accountRows[0].email, role: config.displayRole },
      });

      return res.status(200).json({
        success: true,
        message: `${config.displayRole} account deleted successfully.`,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Could not delete user account.",
        error: error.message,
      });
    }
  },

  listContent: async (_req, res) => {
    try {
      const pool = getPool();
      await syncPendingInstructorExamSubmissions(pool);
      const [content] = await pool.query(
        `
        SELECT
          cs.submission_id as id,
          cs.title,
          cs.type,
          cs.description,
          cs.source_ref as sourceRef,
          cs.course_title as courseTitle,
          cs.batch_name as batchName,
          cs.deadline,
          cs.status,
          cs.created_at,
          i.name as instructorName
        FROM content_submissions cs
        LEFT JOIN instructors i ON i.instructor_id = cs.instructor_id
        ORDER BY cs.created_at DESC
        `
      );

      return res.status(200).json({ success: true, data: content });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch content submissions.", error: error.message });
    }
  },

  listReports: async (_req, res) => {
    try {
      const pool = getPool();
      const [reports] = await pool.query(
        `SELECT report_id as id, title, description, category, reporter_name as reporterName,
                reporter_email as reporterEmail, reporter_role as reporterRole, status, priority, value, admin_note as adminNote,
                created_at as createdAt, updated_at as updatedAt
         FROM reports ORDER BY created_at DESC`
      );
      return res.status(200).json({ success: true, data: reports });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch reports.", error: error.message });
    }
  },

  submitReport: async (req, res) => {
    try {
      const cleanTitle = String(req.body?.title || "").trim();
      const cleanDescription = String(req.body?.description || "").trim();
      const cleanCategory = String(req.body?.category || "bug").trim().toLowerCase();
      const cleanPriority = String(req.body?.priority || "medium").trim().toLowerCase();
      const cleanReporterName = String(req.body?.reporterName || "").trim();
      const cleanReporterEmail = String(req.body?.reporterEmail || "").trim().toLowerCase();
      const cleanReporterRole = String(req.body?.reporterRole || "").trim().toLowerCase();

      if (!cleanTitle || !cleanDescription) {
        return res.status(422).json({ success: false, message: "Report title and description are required." });
      }

      if (!["complaint", "bug", "content"].includes(cleanCategory)) {
        return res.status(422).json({ success: false, message: "Report category must be complaint, bug, or content." });
      }

      if (cleanReporterRole && !["student", "instructor"].includes(cleanReporterRole)) {
        return res.status(422).json({ success: false, message: "Reporter role must be student or instructor." });
      }

      const pool = getPool();
      const [result] = await pool.query(
        `
        INSERT INTO reports (title, description, category, reporter_name, reporter_email, reporter_role, status, priority, value)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
        `,
        [
          cleanTitle,
          cleanDescription,
          cleanCategory,
          cleanReporterName || null,
          cleanReporterEmail || null,
          cleanReporterRole || null,
          cleanPriority,
          cleanCategory,
        ]
      );

      return res.status(201).json({ success: true, message: "Report submitted successfully.", data: { id: result.insertId } });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not submit report.", error: error.message });
    }
  },

  listOwnReports: async (req, res) => {
    try {
      const cleanReporterEmail = String(req.query?.reporterEmail || "").trim().toLowerCase();
      const cleanReporterRole = String(req.query?.reporterRole || "").trim().toLowerCase();

      if (!cleanReporterEmail || !["student", "instructor"].includes(cleanReporterRole)) {
        return res.status(422).json({ success: false, message: "Reporter email and role are required." });
      }

      const pool = getPool();
      const [reports] = await pool.query(
        `
        SELECT report_id as id, title, description, status, admin_note as adminNote, created_at as createdAt, updated_at as updatedAt
        FROM reports
        WHERE LOWER(COALESCE(reporter_email, '')) = ?
          AND LOWER(COALESCE(reporter_role, '')) = ?
          AND LOWER(COALESCE(category, '')) = 'bug'
        ORDER BY created_at DESC
        `,
        [cleanReporterEmail, cleanReporterRole]
      );

      return res.status(200).json({ success: true, data: reports });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch your reports.", error: error.message });
    }
  },

  activityLogs: async (_req, res) => {
    try {
      const pool = getPool();
      const [logs] = await pool.query(
        `SELECT log_id as id, action, target_type as targetType, target_id as targetId,
                target_label as targetLabel, details, created_at as createdAt
         FROM admin_activity_logs ORDER BY created_at DESC LIMIT 30`
      );

      return res.status(200).json({
        success: true,
        data: logs.map((log) => ({
          ...log,
          details: (() => {
            try {
              return log.details ? JSON.parse(log.details) : null;
            } catch {
              return null;
            }
          })(),
        })),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch activity logs.", error: error.message });
    }
  },

  approveContent: async (req, res) => {
    let connection;
    try {
      const { id } = req.params;
      const pool = getPool();
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const [contentRows] = await connection.query(
        "SELECT title, type, source_ref FROM content_submissions WHERE submission_id = ? LIMIT 1",
        [id]
      );
      if (!contentRows.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: "Content submission not found." });
      }

      const sourceRef = String(contentRows[0]?.source_ref || "");
      const questionRefMatch = sourceRef.match(/^instructor_question_bank:(\d+)$/);
      const instructorExamRefMatch = sourceRef.match(/^instructor_exam_schedules:(\d+)$/);
      const adminId = parseRequiredId(req.body?.adminId) || null;

      if (questionRefMatch) {
        await connection.query(
          `
          UPDATE instructor_question_bank
          SET approval_status = 'approved',
              approved_at = NOW(),
              approved_by_admin_id = ?
          WHERE question_id = ?
          `,
          [adminId, Number(questionRefMatch[1])]
        );
      } else if (instructorExamRefMatch) {
        const instructorExamId = Number(instructorExamRefMatch[1]);
        const [[instructorExam]] = await connection.query(
          `
          SELECT instructor_exam_id, title, batch_name, exam_date, start_time, duration_minutes,
                 join_window_minutes, rules, question_ids_json, published_exam_id, audience_type
          FROM instructor_exam_schedules
          WHERE instructor_exam_id = ?
          LIMIT 1
          `,
          [instructorExamId]
        );

        if (instructorExam) {
          const examAudienceType = normalizeAudienceType(instructorExam.audience_type);
          const examBatchName = examAudienceType === "all" ? null : instructorExam.batch_name;
          let publishedExamId = parseRequiredId(instructorExam.published_exam_id);
          if (!publishedExamId) {
            const startTimeValue = parseSqlDateTime(instructorExam.start_time);
            if (!startTimeValue) {
              return sendError(res, { status: 422, message: "Instructor exam start time is invalid." });
            }
            const endTime = formatSqlDateTime(
              new Date(startTimeValue.getTime() + Number(instructorExam.duration_minutes || 0) * 60000)
            );
            const [examInsertResult] = await connection.query(
              `
              INSERT INTO exam_schedules
                (subject, exam_date, start_time, end_time, duration_minutes, batch_name, instructions, audience_type, join_window_minutes, created_by_admin_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              [
                instructorExam.title,
                instructorExam.exam_date,
                formatSqlDateTime(startTimeValue),
                endTime,
                Number(instructorExam.duration_minutes || 0),
                examBatchName,
                instructorExam.rules || null,
                examAudienceType,
                Number(instructorExam.join_window_minutes || 15),
                adminId,
              ]
            );
            publishedExamId = Number(examInsertResult.insertId || 0);
          }

          await connection.query(
            `
            UPDATE instructor_exam_schedules
            SET approval_status = 'approved',
                approved_at = NOW(),
                published_exam_id = ?,
                publish_state = 'Published'
            WHERE instructor_exam_id = ?
            `,
            [publishedExamId || null, instructorExamId]
          );

          let questionIds = [];
          try {
            const parsed = JSON.parse(instructorExam.question_ids_json || "[]");
            questionIds = parseQuestionIds(parsed);
          } catch {
            questionIds = parseQuestionIds(instructorExam.question_ids_json || "");
          }

          if (publishedExamId && questionIds.length) {
            for (let index = 0; index < questionIds.length; index += 1) {
              await connection.query(
                `
                INSERT IGNORE INTO exam_question_mappings (exam_id, question_id, order_index)
                VALUES (?, ?, ?)
                `,
                [publishedExamId, questionIds[index], index + 1]
              );
            }

            const placeholders = questionIds.map(() => "?").join(", ");
            await connection.query(
              `
              UPDATE instructor_question_bank
              SET approval_status = 'approved',
                  approved_at = NOW(),
                  approved_by_admin_id = ?
              WHERE question_id IN (${placeholders})
              `,
              [adminId, ...questionIds]
            );
          }
        }
      }

      const [result] = await connection.query("UPDATE content_submissions SET status = 'approved' WHERE submission_id = ?", [id]);
      if (result.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: "Content submission not found." });
      }

      await logAdminActivity(connection, {
        action: "approved_content",
        targetType: "content",
        targetId: Number(id),
        targetLabel: contentRows[0]?.title || `Submission #${id}`,
        details: { type: contentRows[0]?.type || null },
      });

      await connection.commit();
      return res.status(200).json({ success: true, message: "Content approved successfully." });
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch {
          // Ignore rollback failures and return the original error below.
        }
      }
      return res.status(500).json({ success: false, message: "Could not approve content.", error: error.message });
    } finally {
      if (connection) connection.release();
    }
  },

  denyContent: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = getPool();
      const [contentRows] = await pool.query(
        "SELECT title, type, source_ref FROM content_submissions WHERE submission_id = ? LIMIT 1",
        [id]
      );

      const [result] = await pool.query("UPDATE content_submissions SET status = 'denied' WHERE submission_id = ?", [id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Content submission not found." });
      }

      const sourceRef = String(contentRows[0]?.source_ref || "");
      const questionRefMatch = sourceRef.match(/^instructor_question_bank:(\d+)$/);
      const instructorExamRefMatch = sourceRef.match(/^instructor_exam_schedules:(\d+)$/);
      if (questionRefMatch) {
        await pool.query(
          `
          UPDATE instructor_question_bank
          SET approval_status = 'denied',
              approved_at = NULL,
              approved_by_admin_id = NULL
          WHERE question_id = ?
          `,
          [Number(questionRefMatch[1])]
        );
      } else if (instructorExamRefMatch) {
        await pool.query(
          `
          UPDATE instructor_exam_schedules
          SET approval_status = 'denied',
              approved_at = NULL,
              publish_state = 'Draft'
          WHERE instructor_exam_id = ?
          `,
          [Number(instructorExamRefMatch[1])]
        );
      }

      await logAdminActivity(pool, {
        action: "denied_content",
        targetType: "content",
        targetId: Number(id),
        targetLabel: contentRows[0]?.title || `Submission #${id}`,
        details: { type: contentRows[0]?.type || null },
      });

      return res.status(200).json({ success: true, message: "Content denied successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not deny content.", error: error.message });
    }
  },

  resolveReport: async (req, res) => {
    try {
      const { id } = req.params;
      const adminNote = String(req.body?.note || "").trim();
      const pool = getPool();
      const [reportRows] = await pool.query("SELECT title, category FROM reports WHERE report_id = ? LIMIT 1", [id]);

      const [result] = await pool.query(
        "UPDATE reports SET status = 'completed', admin_note = NULLIF(?, '') WHERE report_id = ?",
        [adminNote, id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Report not found." });
      }

      await logAdminActivity(pool, {
        action: "resolved_report",
        targetType: "report",
        targetId: Number(id),
        targetLabel: reportRows[0]?.title || `Report #${id}`,
        details: { category: reportRows[0]?.category || null, note: adminNote || null },
      });

      return res.status(200).json({ success: true, message: "Report resolved successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not resolve report.", error: error.message });
    }
  },

  denyReport: async (req, res) => {
    try {
      const { id } = req.params;
      const adminNote = String(req.body?.note || "").trim();
      const pool = getPool();
      const [reportRows] = await pool.query("SELECT title, category FROM reports WHERE report_id = ? LIMIT 1", [id]);

      const [result] = await pool.query(
        "UPDATE reports SET status = 'denied', admin_note = NULLIF(?, '') WHERE report_id = ?",
        [adminNote, id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: "Report not found." });
      }

      await logAdminActivity(pool, {
        action: "dismissed_report",
        targetType: "report",
        targetId: Number(id),
        targetLabel: reportRows[0]?.title || `Report #${id}`,
        details: { category: reportRows[0]?.category || null, note: adminNote || null },
      });

      return res.status(200).json({ success: true, message: "Report denied successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not deny report.", error: error.message });
    }
  },

  studentTargets: async (_req, res) => {
    try {
      const pool = getPool();
      const [students] = await pool.query(
        `
        SELECT student_id, name, email, batch_name, course_track
        FROM students
        ORDER BY batch_name ASC, name ASC
        `
      );
      return res.status(200).json({ success: true, data: students });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch student targets.", error: error.message });
    }
  },

  listExams: async (_req, res) => {
    try {
      const pool = getPool();
      await updateExamStatuses(pool);
      const [rows] = await pool.query(
        `
        SELECT
          e.*,
          COUNT(DISTINCT ea.student_id) AS assigned_student_count
        FROM exam_schedules e
        LEFT JOIN exam_assignments ea ON ea.exam_id = e.exam_id
        GROUP BY e.exam_id
        ORDER BY e.start_time ASC
        `
      );

      return res.status(200).json({ success: true, data: rows.map((row) => normalizeExamRecord(row)) });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch exams.", error: error.message });
    }
  },

  createExam: async (req, res) => {
    try {
      const { subject, date, time, duration, batchName, instructions, assignmentType, specificStudentIds, joinWindowMinutes, adminId } =
        req.body || {};

      const cleanSubject = String(subject || "").trim();
      const cleanBatchName = String(batchName || "").trim();
      const cleanInstructions = String(instructions || "").trim();
      const cleanAssignmentType = String(assignmentType || "batch").trim().toLowerCase();
      const durationMinutes = parsePositiveInteger(duration);
      const joinMinutes = parsePositiveInteger(joinWindowMinutes) || 15;
      const startDate = toDateTimeValue(date, time);
      const selectedStudentIds = Array.isArray(specificStudentIds)
        ? [...new Set(specificStudentIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
        : [];

      if (!cleanSubject || !cleanBatchName || !durationMinutes || !startDate) {
        return res.status(422).json({
          success: false,
          message: "Subject, date, time, duration, and batch/group are required.",
        });
      }

      if (!["batch", "specific"].includes(cleanAssignmentType)) {
        return res.status(422).json({ success: false, message: "Assignment type must be batch or specific." });
      }

      if (cleanAssignmentType === "specific" && selectedStudentIds.length === 0) {
        return res.status(422).json({ success: false, message: "Select at least one student for a specific assignment." });
      }

      const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
      const pool = getPool();
      await updateExamStatuses(pool);

      const startTimeSql = formatSqlDateTime(startDate);
      const endTimeSql = formatSqlDateTime(endDate);
      const conflict = await findExamConflict(pool, { batchName: cleanBatchName, startTime: startTimeSql, endTime: endTimeSql });

      if (conflict) {
        return res.status(409).json({
          success: false,
          message: "Batch conflict detected. This exam overlaps with an existing exam.",
          conflict: normalizeExamRecord(conflict),
        });
      }

      const [result] = await pool.query(
        `
        INSERT INTO exam_schedules
          (subject, exam_date, start_time, end_time, duration_minutes, batch_name, instructions, audience_type, join_window_minutes, created_by_admin_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          cleanSubject,
          String(date).trim(),
          startTimeSql,
          endTimeSql,
          durationMinutes,
          cleanBatchName,
          cleanInstructions || null,
          cleanAssignmentType,
          joinMinutes,
          Number.isInteger(Number(adminId)) ? Number(adminId) : null,
        ]
      );

      if (cleanAssignmentType === "specific") {
        for (const studentId of selectedStudentIds) {
          await pool.query(`INSERT IGNORE INTO exam_assignments (exam_id, student_id) VALUES (?, ?)`, [result.insertId, studentId]);
        }
      }

      await logAdminActivity(pool, {
        action: "created_exam",
        targetType: "exam",
        targetId: result.insertId,
        targetLabel: cleanSubject,
        details: {
          batchName: cleanBatchName,
          assignmentType: cleanAssignmentType,
          durationMinutes,
          assignedStudents: selectedStudentIds.length,
        },
      });

      await runExamAutomation();

      const [createdRows] = await pool.query(
        `
        SELECT e.*, COUNT(DISTINCT ea.student_id) AS assigned_student_count
        FROM exam_schedules e
        LEFT JOIN exam_assignments ea ON ea.exam_id = e.exam_id
        WHERE e.exam_id = ?
        GROUP BY e.exam_id
        `,
        [result.insertId]
      );

      return res.status(201).json({
        success: true,
        message: "Exam created successfully.",
        data: normalizeExamRecord(createdRows[0]),
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not create exam.", error: error.message });
    }
  },
};

module.exports = { adminController };

