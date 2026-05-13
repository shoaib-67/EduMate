const bcrypt = require("bcryptjs");

const { getPool } = require("../db");
const { sendSuccess, sendError } = require("../lib/http");
const { parseRequiredId, parsePositiveInteger, parseQuestionIds, parseMcqOptions } = require("../lib/parsers");
const {
  normalizeBatchName,
  normalizeAudienceType,
  formatAudienceLabel,
  ALL_BATCHES_LABEL,
  deriveProgramGroup,
} = require("../lib/audience");
const { formatSqlDateTime } = require("../lib/examUtils");
const {
  buildInstructorWorkspace,
} = require("../services/instructor.service");
const { formatAccountStatus } = require("../services/admin.service");

const instructorController = {
  getProfile: async (req, res) => {
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      if (!instructorId) return sendError(res, { status: 422, message: "Valid instructor ID is required." });

      const pool = getPool();
      const [rows] = await pool.query(
        `
        SELECT instructor_id, name, email, phone_number, account_status, created_at
        FROM instructors
        WHERE instructor_id = ?
        LIMIT 1
        `,
        [instructorId]
      );
      if (!rows.length) return sendError(res, { status: 404, message: "Instructor profile not found." });

      const instructor = rows[0];
      return sendSuccess(res, {
        data: {
          id: instructor.instructor_id,
          fullName: instructor.name || "",
          email: instructor.email || "",
          phoneNumber: instructor.phone_number || "",
          accountStatus: formatAccountStatus(instructor.account_status),
          password: "********",
          createdAt: instructor.created_at || null,
        },
      });
    } catch (error) {
      return sendError(res, { message: "Could not fetch instructor profile.", error: error.message });
    }
  },

  updateProfile: async (req, res) => {
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      if (!instructorId) return sendError(res, { status: 422, message: "Valid instructor ID is required." });

      const fullName = String(req.body?.fullName || "").trim();
      const phone = String(req.body?.phone || req.body?.phoneNumber || "").trim();

      if (!fullName) return sendError(res, { status: 422, message: "Full name is required." });
      if (phone && phone.length < 6) return sendError(res, { status: 422, message: "Please provide a valid phone number." });

      const pool = getPool();
      const [rows] = await pool.query(`SELECT instructor_id FROM instructors WHERE instructor_id = ? LIMIT 1`, [instructorId]);
      if (!rows.length) return sendError(res, { status: 404, message: "Instructor profile not found." });

      await pool.query(`UPDATE instructors SET name = ?, phone_number = ? WHERE instructor_id = ?`, [
        fullName,
        phone || null,
        instructorId,
      ]);

      return sendSuccess(res, {
        message: "Profile updated successfully.",
        data: { id: instructorId, fullName, phoneNumber: phone || "" },
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
      const instructorId = parseRequiredId(req.params.instructorId);
      if (!instructorId) return sendError(res, { status: 422, message: "Valid instructor ID is required." });

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
      const [rows] = await pool.query(`SELECT password_hash FROM instructors WHERE instructor_id = ? LIMIT 1`, [instructorId]);
      if (!rows.length) return sendError(res, { status: 404, message: "Instructor profile not found." });

      const currentPasswordOk = await bcrypt.compare(currentPassword, rows[0].password_hash || "");
      if (!currentPasswordOk) return sendError(res, { status: 401, message: "Current password is incorrect." });

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await pool.query(`UPDATE instructors SET password_hash = ? WHERE instructor_id = ?`, [passwordHash, instructorId]);
      return sendSuccess(res, { message: "Password reset successful." });
    } catch (error) {
      return sendError(res, { message: "Could not reset password.", error: error.message });
    }
  },

  workspace: async (req, res) => {
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      if (!instructorId) return sendError(res, { status: 422, message: "Valid instructor ID is required." });

      const pool = getPool();
      const workspace = await buildInstructorWorkspace(pool, instructorId);
      return sendSuccess(res, { data: workspace });
    } catch (error) {
      return sendError(res, { message: "Could not load instructor workspace.", error: error.message });
    }
  },

  createCourseItem: async (req, res) => {
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      const course = String(req.body?.course || "").trim();
      const type = String(req.body?.type || "").trim();
      const audienceType = normalizeAudienceType(req.body?.audienceType || "batch");
      const rawBatchName = normalizeBatchName(req.body?.batchName);
      const batchName = audienceType === "all" ? ALL_BATCHES_LABEL : rawBatchName;
      const title = String(req.body?.title || "").trim();
      const summary = String(req.body?.summary || "").trim();
      const link = String(req.body?.link || "").trim();

      if (!instructorId || !course || !type || !title || !summary) {
        return sendError(res, { status: 422, message: "Course, type, title, and summary are required." });
      }

      if (String(type).trim().toLowerCase() === "assignment") {
        return sendError(res, { status: 422, message: "Assignments have been removed from the instructor workflow." });
      }

      if (audienceType === "batch" && !batchName) {
        return sendError(res, { status: 422, message: "Please choose a batch for this content." });
      }

      if (!link) {
        return sendError(res, { status: 422, message: "Content link is required for every upload." });
      }

      const pool = getPool();
      const [existingCourseItems] = await pool.query(
        `
        SELECT item_id
        FROM instructor_course_items
        WHERE instructor_id = ?
          AND LOWER(TRIM(source_ref)) = LOWER(TRIM(?))
          AND LOWER(TRIM(title)) = LOWER(TRIM(?))
          AND LOWER(TRIM(COALESCE(batch_name, ''))) = LOWER(TRIM(COALESCE(?, '')))
          AND LOWER(TRIM(course_title)) = LOWER(TRIM(?))
          AND LOWER(TRIM(content_type)) = LOWER(TRIM(?))
        LIMIT 1
        `,
        [instructorId, link, title, batchName, course, type]
      );

      if (existingCourseItems.length > 0) {
        await pool.query(
          `
          UPDATE instructor_course_items
          SET course_title = ?,
              batch_name = ?,
              audience_type = ?,
              content_type = ?,
              title = ?,
              summary = ?,
              source_ref = ?
          WHERE item_id = ?
          `,
          [course, batchName, audienceType, type, title, summary, link, existingCourseItems[0].item_id]
        );
      } else {
        await pool.query(
          `
          INSERT INTO instructor_course_items
            (instructor_id, course_title, batch_name, audience_type, content_type, title, summary, deadline, source_ref)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
          `,
          [instructorId, course, batchName, audienceType, type, title, summary, link]
        );
      }

      const [existingPendingSubmissions] = await pool.query(
        `
        SELECT submission_id
        FROM content_submissions
        WHERE instructor_id = ?
          AND status = 'pending'
          AND source_ref = ?
          AND LOWER(TRIM(title)) = LOWER(TRIM(?))
          AND LOWER(TRIM(COALESCE(batch_name, ''))) = LOWER(TRIM(COALESCE(?, '')))
        LIMIT 1
        `,
        [instructorId, link, title, batchName]
      );

      if (existingPendingSubmissions.length === 0) {
        await pool.query(
          `
          INSERT INTO content_submissions
            (instructor_id, course_title, batch_name, title, type, description, deadline, status, source_ref)
          VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', ?)
          `,
          [instructorId, course, batchName, title, type, summary, link]
        );

        await pool.query(
          `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'New study material uploaded', ?)`,
          [instructorId, `${title} was uploaded for ${formatAudienceLabel(audienceType, batchName)} and sent for admin approval.`]
        );

        return sendSuccess(res, { status: 201, message: "Course content uploaded and sent for admin approval." });
      }

      return sendSuccess(res, { message: "This content is already pending admin approval." });
    } catch (error) {
      return sendError(res, { message: "Could not upload course content.", error: error.message });
    }
  },

  createQuestionBankItem: async (req, res) => {
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      const subject = String(req.body?.subject || "").trim();
      const type = String(req.body?.type || "").trim();
      const text = String(req.body?.text || "").trim();
      const audienceType = normalizeAudienceType(req.body?.audienceType || "batch");
      const rawBatchName = normalizeBatchName(req.body?.batchName);
      const batchName = audienceType === "all" ? ALL_BATCHES_LABEL : rawBatchName;
      const optionsFromArray = Array.isArray(req.body?.mcqOptions)
        ? req.body.mcqOptions.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
      const optionsFromText = typeof req.body?.options === "string" ? String(req.body.options).trim() : "";
      const options = optionsFromArray.length ? JSON.stringify(optionsFromArray) : optionsFromText;
      const answerKey = String(req.body?.answerKey || "").trim();
      const questionType = String(type || "").toLowerCase();
      const skipSubmission = Boolean(req.body?.skipSubmission);

      if (!instructorId || !subject || !type || !text || !answerKey) {
        return sendError(res, { status: 422, message: "Subject, type, question text, and answer key are required." });
      }
      if (questionType !== "mcq") {
        return sendError(res, { status: 422, message: "Only MCQ questions are supported." });
      }
      if (audienceType === "batch" && !batchName) {
        return sendError(res, { status: 422, message: "Please choose a batch for this question." });
      }
      if (questionType === "mcq" && !options) {
        return sendError(res, { status: 422, message: "MCQ questions require options." });
      }
      if (questionType === "mcq" && optionsFromArray.length > 0 && optionsFromArray.length < 2) {
        return sendError(res, { status: 422, message: "Please provide at least two answer options for MCQ." });
      }

      const pool = getPool();
      const [result] = await pool.query(
        `
        INSERT INTO instructor_question_bank
          (instructor_id, batch_name, audience_type, subject, question_type, question_text, options_text, answer_key, approval_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `,
        [instructorId, audienceType === "all" ? null : batchName, audienceType, subject, "MCQ", text, options || null, answerKey]
      );

      const questionId = Number(result.insertId || 0);
      if (questionId && !skipSubmission) {
        await pool.query(
          `
          INSERT INTO content_submissions
            (instructor_id, course_title, batch_name, title, type, description, status, source_ref)
          VALUES (?, NULL, ?, ?, ?, ?, 'pending', ?)
          `,
          [
            instructorId,
            batchName,
            `${subject} question for approval`,
            "MCQ Question",
            `Audience: ${formatAudienceLabel(audienceType, batchName)}\n${text}\n\nOptions: ${options || "N/A"}\nAnswer key: ${answerKey}`,
            `instructor_question_bank:${questionId}`,
          ]
        );
      }

      return sendSuccess(res, {
        status: 201,
        message: skipSubmission ? "Question added to draft exam." : "Question added and sent to admin for approval.",
        data: { questionId },
      });
    } catch (error) {
      return sendError(res, { message: "Could not add question.", error: error.message });
    }
  },

  createExam: async (req, res) => {
    let connection = null;
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      const title = String(req.body?.title || "").trim();
      const subject = String(req.body?.subject || "").trim();
      const audienceType = normalizeAudienceType(req.body?.audienceType || "batch");
      const rawBatchName = normalizeBatchName(req.body?.batchName);
      const batchName = audienceType === "all" ? ALL_BATCHES_LABEL : rawBatchName;
      const accessMode = "open_anytime";
      let duration = parsePositiveInteger(req.body?.duration);
      const negativeMarking = String(req.body?.negativeMarking || "").trim();
      const perMcqMark = Number(req.body?.perMcqMark || 0);
      const shuffleMode = String(req.body?.shuffleMode || "").trim();
      const examType = String(req.body?.examType || "").trim();
      const rules = String(req.body?.rules || "").trim();
      const submittedQuestionIds = parseQuestionIds(req.body?.questionIds || []);
      const draftQuestionsInput = Array.isArray(req.body?.draftQuestions) ? req.body.draftQuestions : [];

      if (!instructorId || !title || !subject || !examType) {
        return sendError(res, { status: 422, message: "Title, subject, duration, and exam type are required." });
      }
      if (!Number.isFinite(perMcqMark) || perMcqMark <= 0) {
        return sendError(res, { status: 422, message: "Per MCQ mark must be greater than 0." });
      }
      if (audienceType === "batch" && !batchName) {
        return sendError(res, { status: 422, message: "Please select a target batch or choose all batches." });
      }
      if (!submittedQuestionIds.length && !draftQuestionsInput.length) {
        return sendError(res, { status: 422, message: "Select at least one question for the exam." });
      }

      if (!duration) return sendError(res, { status: 422, message: "Duration is required." });

      const startTimeValue = new Date();
      const examDateLabel = startTimeValue.toISOString().slice(0, 10);

      const startTime = formatSqlDateTime(startTimeValue || new Date());

      const pool = getPool();

      const compiledRules = [
        `Subject: ${subject}`,
        `Per MCQ Mark: ${perMcqMark}`,
        rules || null,
      ]
        .filter(Boolean)
        .join("\n");

      connection = await pool.getConnection();
      await connection.beginTransaction();

      let questionIds = [...submittedQuestionIds];
      if (!questionIds.length && draftQuestionsInput.length) {
        const draftQuestions = draftQuestionsInput.map((draftQuestion, index) => {
          const questionSubject = String(draftQuestion?.subject || subject).trim();
          const questionType = String(draftQuestion?.type || "MCQ").trim().toUpperCase();
          const questionText = String(draftQuestion?.text || "").trim();
          const questionAudienceType = normalizeAudienceType(draftQuestion?.audienceType || audienceType);
          const draftBatchSource = draftQuestion?.batchName ?? (questionAudienceType === "all" ? ALL_BATCHES_LABEL : batchName);
          const questionBatchRaw = normalizeBatchName(draftBatchSource);
          const questionBatchName = questionAudienceType === "all" ? ALL_BATCHES_LABEL : questionBatchRaw;
          const optionsFromArray = Array.isArray(draftQuestion?.mcqOptions)
            ? draftQuestion.mcqOptions.map((item) => String(item || "").trim()).filter(Boolean)
            : [];
          const optionsFromText = parseMcqOptions(String(draftQuestion?.options || ""));
          const normalizedOptions = optionsFromArray.length ? optionsFromArray : optionsFromText;
          const answerKey = String(draftQuestion?.answerKey || "").trim().toUpperCase();

          if (!questionSubject || !questionText || !answerKey) {
            throw new Error(`Draft question ${index + 1} is missing subject, text, or answer key.`);
          }
          if (questionType !== "MCQ") {
            throw new Error(`Draft question ${index + 1} must be MCQ.`);
          }
          if (questionAudienceType === "batch" && !questionBatchName) {
            throw new Error(`Draft question ${index + 1} is missing batch.`);
          }
          if (normalizedOptions.length < 2) {
            throw new Error(`Draft question ${index + 1} requires at least two options.`);
          }

          return {
            questionSubject,
            questionAudienceType,
            questionBatchName,
            questionText,
            optionsText: JSON.stringify(normalizedOptions),
            answerKey,
          };
        });

        const placeholders = draftQuestions.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, 'pending')").join(", ");
        const insertParams = [];
        draftQuestions.forEach((question) => {
          insertParams.push(
            instructorId,
            question.questionAudienceType === "all" ? null : question.questionBatchName,
            question.questionAudienceType,
            question.questionSubject,
            "MCQ",
            question.questionText,
            question.optionsText,
            question.answerKey
          );
        });

        const [questionInsertResult] = await connection.query(
          `
          INSERT INTO instructor_question_bank
            (instructor_id, batch_name, audience_type, subject, question_type, question_text, options_text, answer_key, approval_status)
          VALUES ${placeholders}
          `,
          insertParams
        );

        const firstQuestionId = Number(questionInsertResult?.insertId || 0);
        const insertedCount = Number(questionInsertResult?.affectedRows || 0);
        if (!Number.isInteger(firstQuestionId) || firstQuestionId <= 0 || insertedCount !== draftQuestions.length) {
          throw new Error("Could not save draft questions for this exam.");
        }
        questionIds = Array.from({ length: insertedCount }, (_, index) => firstQuestionId + index);
      }

      const [insertResult] = await connection.query(
        `
        INSERT INTO instructor_exam_schedules
          (instructor_id, title, batch_name, audience_type, exam_date, start_time, duration_minutes, negative_marking, shuffle_mode, exam_type, publish_state, question_ids_json, approval_status, rules, access_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)
        `,
        [
          instructorId,
          title,
          batchName,
          audienceType,
          examDateLabel,
          startTime,
          duration,
          negativeMarking || null,
          shuffleMode || null,
          examType,
          "Published",
          JSON.stringify(questionIds),
          compiledRules || null,
          accessMode,
        ]
      );
      const instructorExamId = Number(insertResult?.insertId || 0);

      if (instructorExamId) {
        const examBatchName = audienceType === "all" ? null : batchName;
        const endTimeValue = new Date((startTimeValue || new Date()).getTime() + Number(duration || 0) * 60000);
        const endTime = formatSqlDateTime(endTimeValue);

        const [examInsertResult] = await connection.query(
          `
          INSERT INTO exam_schedules
            (subject, exam_date, start_time, end_time, duration_minutes, batch_name, instructions, audience_type, join_window_minutes, created_by_admin_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            title,
            examDateLabel,
            startTime,
            endTime,
            Number(duration || 0),
            examBatchName,
            compiledRules || null,
            audienceType,
            15,
            null,
          ]
        );

        const publishedExamId = Number(examInsertResult.insertId || 0);

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
                approved_by_admin_id = NULL
            WHERE question_id IN (${placeholders})
            `,
            questionIds
          );
        }

        if (publishedExamId && audienceType === "batch") {
          const normalizedBatch = normalizeBatchName(batchName);
          const batchKey = String(normalizedBatch || "").trim().toLowerCase();
          const batchGroup = deriveProgramGroup(normalizedBatch);
          if (batchKey) {
            const [studentRows] = await connection.query(
              `SELECT student_id, batch_name, course_track FROM students`
            );
            const matchingStudents = studentRows.filter((student) => {
              const studentBatch = String(student.batch_name || "");
              const studentTrack = String(student.course_track || "");
              const studentGroup = deriveProgramGroup(studentTrack) || deriveProgramGroup(studentBatch);
              const studentGroups = new Set();
              const combined = `${studentBatch} ${studentTrack}`.toLowerCase();
              if (combined.includes("engineering")) studentGroups.add("engineering");
              if (combined.includes("varsity") || combined.includes("versity")) studentGroups.add("varsity");
              if (combined.includes("medical")) studentGroups.add("medical");
              if (batchKey === ALL_BATCHES_LABEL.toLowerCase()) return true;
              if (batchGroup && studentGroup) return batchGroup === studentGroup;
              if (batchGroup && studentGroups.has(batchGroup)) return true;
              return combined.includes(batchKey);
            });

            for (const student of matchingStudents) {
              await connection.query(
                `
                INSERT IGNORE INTO exam_assignments (exam_id, student_id)
                VALUES (?, ?)
                `,
                [publishedExamId, student.student_id]
              );
            }
          }
        }
      }

      await connection.query(
        `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'New exam published', ?)`,
        [
          instructorId,
          `${title} for ${formatAudienceLabel(audienceType, batchName)} is now open for students.`,
        ]
      );

      await connection.commit();
      return sendSuccess(res, { status: 201, message: "Exam created and published." });
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch {
          // Ignore rollback errors and return the original error below.
        }
      }
      return sendError(res, { message: "Could not create instructor exam.", error: error.message });
    } finally {
      if (connection) connection.release();
    }
  },

  studentAction: async (req, res) => {
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      const studentName = String(req.body?.studentName || "").trim();
      const batch = String(req.body?.batch || "").trim();
      const action = String(req.body?.action || "").trim();
      const progress = String(req.body?.progress || "").trim();
      const note = String(req.body?.note || "").trim();

      if (!instructorId || !studentName || !batch || !action) {
        return sendError(res, { status: 422, message: "Student name, batch, and action are required." });
      }

      const pool = getPool();
      const [studentRows] = await pool.query(
        `SELECT student_id, name FROM students WHERE LOWER(name) = LOWER(?) AND LOWER(batch_name) = LOWER(?) LIMIT 1`,
        [studentName, batch]
      );
      if (!studentRows.length) return sendError(res, { status: 404, message: "Student not found for the selected batch." });
      const studentId = studentRows[0].student_id;

      if (action === "Remove") {
        await pool.query(
          `
          INSERT INTO instructor_student_assignments (instructor_id, student_id, assigned_batch, is_active)
          VALUES (?, ?, ?, FALSE)
          ON DUPLICATE KEY UPDATE
            assigned_batch = VALUES(assigned_batch),
            is_active = FALSE
          `,
          [instructorId, studentId, batch]
        );
      } else {
        await pool.query(
          `
          INSERT INTO instructor_student_assignments (instructor_id, student_id, assigned_batch, is_active)
          VALUES (?, ?, ?, TRUE)
          ON DUPLICATE KEY UPDATE
            assigned_batch = VALUES(assigned_batch),
            is_active = TRUE
          `,
          [instructorId, studentId, batch]
        );
      }

      await pool.query(
        `
        INSERT INTO instructor_student_notes (instructor_id, student_id, progress_label, note)
        VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''))
        ON DUPLICATE KEY UPDATE
          progress_label = VALUES(progress_label),
          note = VALUES(note)
        `,
        [instructorId, studentId, progress, note || `${action} recorded by instructor`]
      );

      await pool.query(
        `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'Student action recorded', ?)`,
        [instructorId, `${action} applied for ${studentRows[0].name} in ${batch}.`]
      );

      return sendSuccess(res, { message: "Student action saved." });
    } catch (error) {
      return sendError(res, { message: "Could not save student action.", error: error.message });
    }
  },

  createMessage: async (req, res) => {
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      const type = String(req.body?.type || "").trim();
      const audience = String(req.body?.audience || "").trim();
      const title = String(req.body?.title || "").trim();
      const body = String(req.body?.body || "").trim();

      if (!instructorId || !type || !audience || !title || !body) {
        return sendError(res, { status: 422, message: "Type, audience, title, and body are required." });
      }

      const pool = getPool();
      await pool.query(
        `
        INSERT INTO instructor_messages (instructor_id, message_type, audience, title, body)
        VALUES (?, ?, ?, ?, ?)
        `,
        [instructorId, type, audience, title, body]
      );

      await pool.query(
        `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'New instructor communication posted', ?)`,
        [instructorId, `${type} sent to ${audience}.`]
      );

      return sendSuccess(res, { status: 201, message: "Message posted successfully." });
    } catch (error) {
      return sendError(res, { message: "Could not post instructor message.", error: error.message });
    }
  },

  createAnnouncement: async (req, res) => {
    try {
      const instructorId = parseRequiredId(req.params.instructorId);
      const title = String(req.body?.title || "").trim();
      const content = String(req.body?.content || "").trim();
      const batchNameRaw = String(req.body?.batchName || "").trim();
      const batchName = batchNameRaw || null;

      if (!instructorId || !title || !content) {
        return sendError(res, { status: 422, message: "Title and content are required." });
      }

      const pool = getPool();
      const [existingPending] = await pool.query(
        `
        SELECT submission_id
        FROM content_submissions
        WHERE instructor_id = ?
          AND status = 'pending'
          AND type = 'Announcement'
          AND LOWER(TRIM(title)) = LOWER(TRIM(?))
          AND LOWER(TRIM(COALESCE(description, ''))) = LOWER(TRIM(?))
          AND LOWER(TRIM(COALESCE(batch_name, ''))) = LOWER(TRIM(COALESCE(?, '')))
          AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
        LIMIT 1
        `,
        [instructorId, title, content, batchName]
      );

      if (existingPending.length > 0) {
        return sendSuccess(res, { message: "This announcement is already pending admin approval." });
      }

      await pool.query(
        `
        INSERT INTO content_submissions
          (instructor_id, course_title, batch_name, title, type, description, status, source_ref)
        VALUES (?, NULL, ?, ?, 'Announcement', ?, 'pending', NULL)
        `,
        [instructorId, batchName, title, content]
      );

      await pool.query(
        `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'Announcement submitted', ?)`,
        [instructorId, `${title} sent for admin approval.`]
      );

      return sendSuccess(res, { status: 201, message: "Announcement posted and sent for admin approval." });
    } catch (error) {
      return sendError(res, { message: "Could not post announcement.", error: error.message });
    }
  },
};

module.exports = { instructorController };

