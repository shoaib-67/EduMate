const { formatAudienceLabel, normalizeAudienceType } = require("../lib/audience");
const { normalizeInstructorExamRecord, formatSqlDateTime } = require("../lib/examUtils");

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

async function buildInstructorWorkspace(pool, instructorId) {
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
    SELECT question_id, subject, question_type, question_text, options_text, answer_key, approval_status, batch_name, audience_type
    FROM instructor_question_bank
    WHERE instructor_id = ?
    ORDER BY created_at DESC
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
      ON sp.student_id = isa.student_id AND LOWER(sp.test_type) = 'mock'
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
    JOIN student_performance sp ON sp.student_id = isa.student_id AND LOWER(sp.test_type) = 'mock'
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
    JOIN student_performance sp ON sp.student_id = isa.student_id AND LOWER(sp.test_type) = 'mock'
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

module.exports = { findInstructorExamConflict, buildInstructorWorkspace };

