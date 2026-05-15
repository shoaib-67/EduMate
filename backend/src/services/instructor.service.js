const { formatAudienceLabel, normalizeAudienceType } = require("../lib/audience");
const { normalizeInstructorExamRecord, formatSqlDateTime } = require("../lib/examUtils");

function buildInstructorPerformanceExamMatchClause(examAlias = "ies") {
  return `
    ${examAlias}.instructor_id = isa.instructor_id
    AND (
      LOWER(COALESCE(${examAlias}.approval_status, '')) = 'approved'
      OR LOWER(COALESCE(${examAlias}.publish_state, '')) = 'published'
    )
    AND (
      ${examAlias}.published_exam_id = sp.exam_id
      OR (sp.exam_id IS NULL AND LOWER(TRIM(${examAlias}.title)) = LOWER(TRIM(sp.test_name)))
    )
  `;
}

async function findInstructorExamConflict(pool, { instructorId, batchName, audienceType, startTime, durationMinutes }) {
  const endTime = new Date(new Date(startTime).getTime() + Number(durationMinutes || 0) * 60000);
  const cleanAudienceType = normalizeAudienceType(audienceType);
  const [rows] = await pool.query(
    `
    SELECT instructor_exam_id, title, batch_name, exam_date, start_time, duration_minutes, join_window_minutes,
           negative_marking, shuffle_mode, exam_type, publish_state, rules, audience_type
    FROM instructor_exam_schedules
    WHERE instructor_id = ?
      AND (
        (? = 'all' AND audience_type = 'all')
        OR (? = 'batch' AND audience_type = 'batch' AND LOWER(batch_name) = LOWER(?))
      )
      AND ? < DATE_ADD(start_time, INTERVAL duration_minutes MINUTE)
      AND ? > start_time
    ORDER BY start_time ASC
    LIMIT 1
    `,
    [instructorId, cleanAudienceType, cleanAudienceType, batchName, startTime, formatSqlDateTime(endTime)]
  );
  return rows[0] || null;
}

function getRuleValue(rules, label) {
  const pattern = new RegExp(`^${label}\\s*:\\s*(.+)$`, "im");
  const match = String(rules || "").match(pattern);
  return String(match?.[1] || "").trim();
}

function normalizeExamDateLabel(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return normalizeExamDateLabel(parsed);
}

function normalizeExamTimeLabel(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hours = String(value.getHours()).padStart(2, "0");
    const minutes = String(value.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  const text = String(value).trim();
  const timeMatch = text.match(/(\d{2}:\d{2})/);
  if (timeMatch) return timeMatch[1];

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return normalizeExamTimeLabel(parsed);
}

function parseQuestionCount(questionIdsJson) {
  if (Array.isArray(questionIdsJson)) return questionIdsJson.filter(Boolean).length;
  if (!questionIdsJson) return 0;

  try {
    const parsed = JSON.parse(questionIdsJson);
    return Array.isArray(parsed) ? parsed.filter(Boolean).length : 0;
  } catch {
    return 0;
  }
}

function getCustomRuleSummary(rules) {
  const customRules = String(rules || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(subject|per mcq mark|end time)\s*:/i.test(line));

  return customRules.length ? customRules.join(" | ") : "-";
}

function buildInstructorExamSubmissionPayload(exam = {}) {
  const sourceRef = `instructor_exam_schedules:${Number(exam.instructorExamId || exam.instructor_exam_id || 0)}`;
  const audienceType = normalizeAudienceType(exam.audienceType || exam.audience_type || "batch");
  const batchName = String(exam.batchName || exam.batch_name || "").trim() || null;
  const subject = String(exam.subject || getRuleValue(exam.rules, "Subject") || "").trim();
  const perMcqMark = String(exam.perMcqMark || getRuleValue(exam.rules, "Per MCQ Mark") || "").trim();
  const endTimeDisplay = String(exam.endTimeDisplay || getRuleValue(exam.rules, "End Time") || "").trim();
  const accessMode = String(exam.accessMode || exam.access_mode || "open_anytime").trim();
  const examDate = normalizeExamDateLabel(exam.date || exam.examDate || exam.exam_date);
  const startTime = normalizeExamTimeLabel(exam.time || exam.startTime || exam.start_time);
  const duration = Number(exam.duration || exam.durationMinutes || exam.duration_minutes || 0);
  const questionCount = parseQuestionCount(exam.questionIdsJson || exam.question_ids_json);
  const accessLabel =
    accessMode === "scheduled"
      ? `${[examDate, startTime].filter(Boolean).join(" ")}${endTimeDisplay ? ` - ${endTimeDisplay}` : ""}`.trim() || "Scheduled"
      : "Open immediately";

  return {
    instructorId: Number(exam.instructorId || exam.instructor_id || 0) || null,
    courseTitle: subject || null,
    batchName,
    title: String(exam.title || "").trim(),
    status: String(exam.status || "pending").trim().toLowerCase() || "pending",
    sourceRef,
    description: [
      subject ? `Subject: ${subject}` : null,
      `Audience: ${formatAudienceLabel(audienceType, batchName)}`,
      exam.examType || exam.exam_type ? `Exam Type: ${String(exam.examType || exam.exam_type).trim()}` : null,
      perMcqMark ? `Per MCQ Mark: ${perMcqMark}` : null,
      `Access: ${accessLabel}`,
      duration > 0 ? `Duration: ${duration} min` : null,
      questionCount > 0 ? `Questions: ${questionCount}` : null,
      `Rules: ${getCustomRuleSummary(exam.rules)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function upsertInstructorExamSubmission(connection, exam = {}) {
  const payload = buildInstructorExamSubmissionPayload(exam);
  if (!payload.instructorId || !payload.title || /:0$/.test(payload.sourceRef)) {
    throw new Error("A valid instructor exam submission payload is required.");
  }

  const [existingRows] = await connection.query(
    `
    SELECT submission_id
    FROM content_submissions
    WHERE source_ref = ?
    ORDER BY submission_id DESC
    LIMIT 1
    `,
    [payload.sourceRef]
  );

  if (existingRows.length > 0) {
    const submissionId = Number(existingRows[0].submission_id || 0);
    await connection.query(
      `
      UPDATE content_submissions
      SET instructor_id = ?,
          course_title = ?,
          batch_name = ?,
          title = ?,
          type = 'Exam',
          description = ?,
          status = ?,
          source_ref = ?
      WHERE submission_id = ?
      `,
      [
        payload.instructorId,
        payload.courseTitle,
        payload.batchName,
        payload.title,
        payload.description,
        payload.status,
        payload.sourceRef,
        submissionId,
      ]
    );
    return submissionId;
  }

  const [insertResult] = await connection.query(
    `
    INSERT INTO content_submissions
      (instructor_id, course_title, batch_name, title, type, description, status, source_ref)
    VALUES (?, ?, ?, ?, 'Exam', ?, ?, ?)
    `,
    [
      payload.instructorId,
      payload.courseTitle,
      payload.batchName,
      payload.title,
      payload.description,
      payload.status,
      payload.sourceRef,
    ]
  );

  return Number(insertResult?.insertId || 0);
}

async function syncPendingInstructorExamSubmissions(pool) {
  const [pendingExams] = await pool.query(
    `
    SELECT
      instructor_exam_id,
      instructor_id,
      title,
      batch_name,
      audience_type,
      exam_date,
      start_time,
      duration_minutes,
      exam_type,
      question_ids_json,
      rules,
      access_mode
    FROM instructor_exam_schedules
    WHERE LOWER(COALESCE(approval_status, 'pending')) = 'pending'
    ORDER BY created_at DESC
    `
  );

  let syncedCount = 0;
  for (const exam of pendingExams) {
    const sourceRef = `instructor_exam_schedules:${Number(exam.instructor_exam_id || 0)}`;
    if (/:0$/.test(sourceRef)) continue;

    const [existingRows] = await pool.query(
      `
      SELECT submission_id, status
      FROM content_submissions
      WHERE source_ref = ?
      ORDER BY submission_id DESC
      LIMIT 1
      `,
      [sourceRef]
    );

    const hasPendingSubmission =
      existingRows.length > 0 && String(existingRows[0].status || "").trim().toLowerCase() === "pending";
    if (hasPendingSubmission) continue;

    await upsertInstructorExamSubmission(pool, { ...exam, status: "pending" });
    syncedCount += 1;
  }

  return syncedCount;
}

async function buildInstructorWorkspace(pool, instructorId) {
  const examPerformanceMatch = buildInstructorPerformanceExamMatchClause();

  const [courseItems] = await pool.query(
    `
    SELECT item_id, course_title, batch_name, audience_type, content_type, title, summary, deadline, source_ref AS link
    FROM instructor_course_items
    WHERE instructor_id = ?
    ORDER BY created_at DESC
    `,
    [instructorId]
  );

  const [questionBank] = await pool.query(
    `
    SELECT
      iqb.question_id,
      iqb.subject,
      iqb.question_type,
      iqb.question_text,
      iqb.options_text,
      iqb.answer_key,
      iqb.approval_status,
      iqb.batch_name,
      iqb.audience_type
    FROM instructor_question_bank iqb
    WHERE iqb.instructor_id = ?
      AND UPPER(COALESCE(iqb.question_type, '')) = 'MCQ'
      AND LOWER(COALESCE(iqb.approval_status, 'pending')) = 'pending'
      AND EXISTS (
        SELECT 1
        FROM content_submissions cs
        WHERE cs.source_ref = CONCAT('instructor_question_bank:', iqb.question_id)
      )
    ORDER BY iqb.created_at DESC
    `,
    [instructorId]
  );

  const [exams] = await pool.query(
    `
    SELECT instructor_exam_id, title, batch_name, exam_date, start_time, duration_minutes,
           negative_marking, shuffle_mode, exam_type, publish_state, rules, question_ids_json, approval_status, access_mode, audience_type
    FROM instructor_exam_schedules
    WHERE instructor_id = ?
    ORDER BY start_time DESC
    `,
    [instructorId]
  );
  const normalizedExams = exams.map((exam) => normalizeInstructorExamRecord(exam));

  const [students] = await pool.query(
    `
    SELECT
      s.student_id AS id,
      s.name,
      isa.assigned_batch AS batch,
      COALESCE(isn.progress_label, 'Pending update') AS progress,
      ROUND(COALESCE(AVG(sp.score), 0), 0) AS score,
      COALESCE(isn.note, 'No note yet') AS note
    FROM instructor_student_assignments isa
    JOIN students s ON s.student_id = isa.student_id
    LEFT JOIN instructor_student_notes isn
      ON isn.instructor_id = isa.instructor_id AND isn.student_id = isa.student_id
    LEFT JOIN student_performance sp
      ON sp.student_id = isa.student_id
      AND LOWER(sp.test_type) = 'mock'
      AND EXISTS (
        SELECT 1
        FROM instructor_exam_schedules ies
        WHERE ${examPerformanceMatch}
      )
    WHERE isa.instructor_id = ? AND isa.is_active = TRUE
    GROUP BY s.student_id, s.name, isa.assigned_batch, isn.progress_label, isn.note
    ORDER BY s.name ASC
    `,
    [instructorId]
  );

  const [communications] = await pool.query(
    `
    SELECT message_id, message_type, audience, title, body
    FROM instructor_messages
    WHERE instructor_id = ?
    ORDER BY created_at DESC
    `,
    [instructorId]
  );

  const [coursePerformance] = await pool.query(
    `
    SELECT
      sp.subject AS course,
      COUNT(*) AS assessments,
      ROUND(AVG(sp.score), 1) AS averageScore,
      ROUND(SUM(CASE WHEN sp.score >= 50 THEN 1 ELSE 0 END) / COUNT(*) * 100, 1) AS passRate,
      ROUND(MAX(sp.score), 1) AS topScore,
      ROUND(MIN(sp.score), 1) AS bottomScore
    FROM instructor_student_assignments isa
    JOIN student_performance sp
      ON sp.student_id = isa.student_id
      AND LOWER(sp.test_type) = 'mock'
      AND EXISTS (
        SELECT 1
        FROM instructor_exam_schedules ies
        WHERE ${examPerformanceMatch}
      )
    WHERE isa.instructor_id = ? AND isa.is_active = TRUE
    GROUP BY sp.subject
    ORDER BY averageScore DESC, passRate DESC
    `,
    [instructorId]
  );

  const [mockTestResultRows] = await pool.query(
    `
    SELECT
      sp.performance_id AS id,
      s.student_id AS studentId,
      s.name AS studentName,
      isa.assigned_batch AS batch,
      sp.subject AS subject,
      sp.score AS score,
      sp.total_questions AS totalQuestions,
      sp.correct_answers AS correctAnswers,
      sp.test_name AS testName,
      sp.created_at AS createdAt
    FROM instructor_student_assignments isa
    JOIN students s ON s.student_id = isa.student_id
    JOIN student_performance sp
      ON sp.student_id = isa.student_id
      AND LOWER(sp.test_type) = 'mock'
      AND EXISTS (
        SELECT 1
        FROM instructor_exam_schedules ies
        WHERE ${examPerformanceMatch}
      )
    WHERE isa.instructor_id = ? AND isa.is_active = TRUE
    ORDER BY sp.created_at DESC
    LIMIT 200
    `,
    [instructorId]
  );

  const mockTestResults = mockTestResultRows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    batch: row.batch,
    subject: row.subject,
    score: row.score != null ? Number(row.score) : null,
    totalQuestions: row.totalQuestions != null ? Number(row.totalQuestions) : null,
    correctAnswers: row.correctAnswers != null ? Number(row.correctAnswers) : null,
    testName: row.testName,
    createdAt: row.createdAt,
  }));

  const scoreDistribution = [
    { band: "85-100", count: students.filter((student) => Number(student.score) >= 85).length },
    { band: "70-84", count: students.filter((student) => Number(student.score) >= 70 && Number(student.score) < 85).length },
    { band: "50-69", count: students.filter((student) => Number(student.score) >= 50 && Number(student.score) < 70).length },
    { band: "Below 50", count: students.filter((student) => Number(student.score) < 50).length },
  ];

  const averageBatchScore = students.length
    ? Math.round(students.reduce((sum, student) => sum + Number(student.score || 0), 0) / students.length)
    : 0;

  return {
    stats: {
      courseCount: new Set(courseItems.map((item) => item.course_title)).size,
      publishedExamCount: normalizedExams.filter((exam) => exam.state === "Published").length,
      managedStudentCount: students.length,
      batchAverageScore: averageBatchScore,
    },
    courseContent: courseItems.map((item) => ({
      id: item.item_id,
      course: item.course_title,
      batch: formatAudienceLabel(item.audience_type, item.batch_name),
      audienceType: normalizeAudienceType(item.audience_type),
      type: item.content_type,
      title: item.title,
      summary: item.summary,
      deadline: item.deadline,
      link: item.link,
    })),
    questionBank: questionBank.map((item) => ({
      id: item.question_id,
      subject: item.subject,
      type: item.question_type,
      text: item.question_text,
      options: item.options_text,
      answerKey: item.answer_key,
      batchName: formatAudienceLabel(item.audience_type, item.batch_name),
      audienceType: normalizeAudienceType(item.audience_type),
      approvalStatus: item.approval_status || "pending",
    })),
    exams: normalizedExams,
    students: students.map((student) => ({
      id: student.id,
      name: student.name,
      batch: student.batch,
      progress: student.progress,
      score: Number(student.score || 0),
      note: student.note,
    })),
    communications: communications.map((item) => ({
      id: item.message_id,
      type: item.message_type,
      audience: item.audience,
      title: item.title,
      body: item.body,
    })),
    coursePerformance,
    scoreDistribution,
    mockTestResults,
  };
}

module.exports = {
  findInstructorExamConflict,
  buildInstructorWorkspace,
  buildInstructorExamSubmissionPayload,
  upsertInstructorExamSubmission,
  syncPendingInstructorExamSubmissions,
};

