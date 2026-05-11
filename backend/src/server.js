const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");

const { ensureDatabaseExists, getPool } = require("./db");
const {
  ensureSchema,
  seedDemoAccounts,
  seedDemoContentAndReports,
  seedDemoStudyCircles,
  seedDemoExamSchedules,
  seedDemoInstructorWorkspace,
} = require("./initDb");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = Number(process.env.PORT || 5000);
const USER_ROLE_CONFIG = {
  student: {
    table: "students",
    idColumn: "student_id",
    displayRole: "Student",
    canManage: true,
  },
  instructor: {
    table: "instructors",
    idColumn: "instructor_id",
    displayRole: "Instructor",
    canManage: true,
  },
  admin: {
    table: "admins",
    idColumn: "admin_id",
    displayRole: "Admin",
    canManage: false,
  },
};
const DEFAULT_BATCH_OPTIONS = ["Engineering", "Varsity", "Medical"];
const ALL_BATCHES_LABEL = "ALL_BATCHES";
const ALL_BATCHES_DISPLAY = "All Batches";

function normalizeBatchName(rawBatch) {
  const value = String(rawBatch || "").trim();
  if (!value) return "";

  const normalized = value.toLowerCase().replace(/\s+/g, " ");
  if (
    normalized === "all" ||
    normalized === "all batch" ||
    normalized === "all batches" ||
    normalized === "all-batches" ||
    normalized === "all_batches"
  ) {
    return ALL_BATCHES_LABEL;
  }

  return value;
}

function deriveBatchFromProgram(program) {
  const group = deriveProgramGroup(program);
  if (group === "engineering") return "Engineering";
  if (group === "varsity") return "Varsity";
  if (group === "medical") return "Medical";
  return "";
}

function deriveProgramGroup(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) return "";
  const groups = [];
  if (normalized.includes("engineering")) groups.push("engineering");
  if (normalized.includes("varsity") || normalized.includes("versity")) groups.push("varsity");
  if (normalized.includes("medical")) groups.push("medical");
  return groups.length === 1 ? groups[0] : "";
}

function resolveStudentProgramGroup(studentRow) {
  const fromTrack = deriveProgramGroup(studentRow?.course_track);
  if (fromTrack) return fromTrack;
  return deriveProgramGroup(studentRow?.batch_name);
}

function isAudienceVisibleToStudent({ audienceType, batchName, studentBatchName, studentProgramGroup }) {
  const cleanAudienceType = normalizeAudienceType(audienceType, "batch");
  if (cleanAudienceType === "all") return true;

  const normalizedBatch = normalizeBatchName(batchName);
  if (normalizedBatch === ALL_BATCHES_LABEL) return true;

  const targetGroup = deriveProgramGroup(batchName);
  if (targetGroup && studentProgramGroup) return targetGroup === studentProgramGroup;

  const normalizedStudentBatch = normalizeBatchName(studentBatchName);
  if (!normalizedBatch || !normalizedStudentBatch) return false;
  return normalizedBatch.toLowerCase() === normalizedStudentBatch.toLowerCase();
}

function normalizeAudienceType(rawAudienceType, fallback = "batch") {
  const clean = String(rawAudienceType || fallback).trim().toLowerCase();
  if (["all", "all_batches", "all-batches"].includes(clean)) return "all";
  if (clean === "specific") return "specific";
  return "batch";
}

function formatAudienceLabel(audienceType, batchName) {
  if (normalizeAudienceType(audienceType) === "all") return ALL_BATCHES_DISPLAY;
  const normalizedBatch = normalizeBatchName(batchName);
  if (normalizedBatch === ALL_BATCHES_LABEL) return ALL_BATCHES_DISPLAY;
  return String(batchName || "").trim() || "General";
}

function sendSuccess(res, { status = 200, message, data, ...rest } = {}) {
  const payload = { success: true };
  if (message) payload.message = message;
  if (data !== undefined) payload.data = data;
  return res.status(status).json({ ...payload, ...rest });
}

function sendError(res, { status = 500, message, error, ...rest } = {}) {
  const payload = { success: false, message };
  if (error) payload.error = error;
  return res.status(status).json({ ...payload, ...rest });
}

function isSchemaError(error) {
  return error && (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_FIELD_ERROR");
}

function parseRequiredId(rawValue) {
  const id = Number(rawValue);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getManageableUserConfig(role) {
  const cleanRole = String(role || "").trim().toLowerCase();
  const config = USER_ROLE_CONFIG[cleanRole];
  return config?.canManage ? config : null;
}

function formatAccountStatus(accountStatus) {
  return String(accountStatus || "active").toLowerCase() === "frozen" ? "Frozen" : "Active";
}

function sanitizeAdminUserPayload(user = {}) {
  return {
    id: Number(user.id) || 0,
    name: user.name || "",
    email: user.email || "",
    phoneNumber: user.phoneNumber || "",
    role: user.role || "",
    accountStatus: user.accountStatus || "active",
    createdAt: user.createdAt || null,
    status: formatAccountStatus(user.accountStatus),
  };
}

function validateAccountPayload(body) {
  const cleanFullName = String(body?.fullName || body?.name || "").trim();
  const cleanEmail = String(body?.email || "").trim().toLowerCase();
  const cleanPhone = String(body?.phone || body?.phoneNumber || "").trim();
  const cleanPassword = String(body?.password || "");
  const cleanRole = String(body?.role || "").trim().toLowerCase();

  if (!cleanFullName || !cleanEmail || !cleanPassword || !cleanRole) {
    return { error: "Name, email, password, and role are required." };
  }

  if (!getManageableUserConfig(cleanRole)) {
    return { error: "Only student and instructor accounts can be managed here." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { error: "Please provide a valid email address." };
  }

  if (cleanPassword.length < 8) {
    return { error: "Password must be at least 8 characters long." };
  }

  return {
    value: {
      fullName: cleanFullName,
      email: cleanEmail,
      phone: cleanPhone || null,
      password: cleanPassword,
      role: cleanRole,
    },
  };
}

async function logAdminActivity(pool, { action, targetType, targetId, targetLabel, details }) {
  await pool.query(
    `
    INSERT INTO admin_activity_logs (action, target_type, target_id, target_label, details)
    VALUES (?, ?, ?, ?, ?)
    `,
    [
      action,
      targetType,
      targetId || null,
      targetLabel || null,
      details ? JSON.stringify(details) : null,
    ]
  );
}

const EXAM_REMINDER_WINDOWS = [
  { minutes: 24 * 60, label: "24-hour reminder" },
  { minutes: 60, label: "1-hour reminder" },
];

function parsePositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function parseQuestionIds(input) {
  const source = Array.isArray(input)
    ? input
    : String(input || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  return Array.from(
    new Set(
      source
        .map((item) => Number(item))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
}

function parseMcqOptions(optionsText = "") {
  const raw = String(optionsText || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // Fall back to delimiter-based parsing.
  }

  return raw
    .split("|")
    .map((part) => part.replace(/^\s*[A-Da-d][).:\-]\s*/, "").trim())
    .filter(Boolean);
}

function resolveAnswerIndex(answerKey, options) {
  const normalizedOptions = Array.isArray(options) ? options : [];
  const raw = String(answerKey || "").trim();
  if (!raw || !normalizedOptions.length) return -1;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (numeric >= 0 && numeric < normalizedOptions.length) return numeric;
    if (numeric >= 1 && numeric <= normalizedOptions.length) return numeric - 1;
  }

  const letter = raw.toUpperCase();
  const letterIndex = ["A", "B", "C", "D"].indexOf(letter);
  if (letterIndex >= 0 && letterIndex < normalizedOptions.length) return letterIndex;

  const matchIndex = normalizedOptions.findIndex(
    (option) => option.toLowerCase() === raw.toLowerCase()
  );
  return matchIndex;
}

function toDateTimeValue(dateInput, timeInput) {
  const date = String(dateInput || "").trim();
  const time = String(timeInput || "").trim();

  if (!date || !time) return null;
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const parsed = new Date(`${date}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function padDateTimePart(value) {
  return String(value).padStart(2, "0");
}

function parseSqlDateTime(rawValue) {
  if (rawValue instanceof Date) {
    const d = rawValue;
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds()
    );
  }

  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  const normalized = raw.replace("T", " ").replace("Z", "");
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0)
  );
}

function formatSqlDateTime(date) {
  return `${date.getFullYear()}-${padDateTimePart(date.getMonth() + 1)}-${padDateTimePart(
    date.getDate()
  )} ${padDateTimePart(date.getHours())}:${padDateTimePart(date.getMinutes())}:${padDateTimePart(
    date.getSeconds()
  )}`;
}

function resolveExamWindow(startTime, endTime, durationMinutes) {
  const start = parseSqlDateTime(startTime);
  let end = parseSqlDateTime(endTime);
  const duration = parsePositiveInteger(durationMinutes) || 0;

  if (start && (!end || end <= start) && duration > 0) {
    end = new Date(start.getTime() + duration * 60000);
  }

  return { start, end };
}

function deriveExamStatus(startTime, endTime, now = new Date(), durationMinutes = 0) {
  const { start, end } = resolveExamWindow(startTime, endTime, durationMinutes);
  if (!start || !end) return "upcoming";

  if (now < start) return "upcoming";
  if (now <= end) return "ongoing";
  return "completed";
}

function buildJoinExamLink(examId) {
  return `mock-test.html?examId=${encodeURIComponent(examId)}`;
}

function canJoinExam(exam, now = new Date()) {
  const joinWindowMinutes = parsePositiveInteger(exam.join_window_minutes) || 15;
  const { start, end } = resolveExamWindow(
    exam.start_time,
    exam.end_time,
    exam.duration_minutes
  );
  if (!start || !end) return false;
  const joinStart = new Date(start.getTime() - joinWindowMinutes * 60000);
  return now >= joinStart && now <= end;
}

function normalizeExamRecord(exam, now = new Date()) {
  const { start, end } = resolveExamWindow(
    exam.start_time,
    exam.end_time,
    exam.duration_minutes
  );
  const status = deriveExamStatus(start, end, now, exam.duration_minutes);
  const audienceType = normalizeAudienceType(exam.audience_type);
  return {
    id: exam.exam_id,
    subject: exam.subject,
    examDate: exam.exam_date,
    startTime: start || exam.start_time,
    endTime: end || exam.end_time,
    durationMinutes: exam.duration_minutes,
    batchName: formatAudienceLabel(audienceType, exam.batch_name),
    instructions: exam.instructions,
    audienceType,
    status,
    joinWindowMinutes: exam.join_window_minutes,
    joinAvailable: canJoinExam(exam, now),
    joinUrl: buildJoinExamLink(exam.exam_id),
    assignedStudentCount: Number(exam.assigned_student_count || 0),
  };
}

async function updateExamStatuses(pool) {
  await pool.query(
    `
    UPDATE exam_schedules
    SET end_time = DATE_ADD(start_time, INTERVAL duration_minutes MINUTE)
    WHERE (end_time IS NULL OR end_time <= start_time)
      AND duration_minutes IS NOT NULL
      AND duration_minutes > 0
    `
  );

  await pool.query(
    `
    UPDATE exam_schedules
    SET status = CASE
      WHEN NOW() < start_time THEN 'upcoming'
      WHEN NOW() <= (
        CASE
          WHEN end_time > start_time THEN end_time
          WHEN duration_minutes IS NOT NULL AND duration_minutes > 0
            THEN DATE_ADD(start_time, INTERVAL duration_minutes MINUTE)
          ELSE end_time
        END
      ) THEN 'ongoing'
      ELSE 'completed'
    END
    `
  );
}

async function createReminderNotification(pool, { studentId, examId, channel, title, message, scheduledFor }) {
  await pool.query(
    `
    INSERT IGNORE INTO notifications
      (student_id, exam_id, channel, type, title, message, status, scheduled_for, sent_at)
    VALUES (?, ?, ?, 'exam_reminder', ?, ?, 'unread', ?, NOW())
    `,
    [studentId, examId, channel, title, message, scheduledFor]
  );
}

async function dispatchExamReminders(pool) {
  for (const reminder of EXAM_REMINDER_WINDOWS) {
    const [dueAssignments] = await pool.query(
      `
      SELECT
        e.exam_id,
        e.subject,
        e.start_time,
        e.end_time,
        e.batch_name,
        e.audience_type,
        s.student_id,
        s.email,
        s.phone_number
      FROM exam_schedules e
      JOIN students s
        ON (
          (e.audience_type = 'all')
          OR (e.audience_type = 'batch' AND e.batch_name IS NOT NULL AND e.batch_name = s.batch_name)
          OR EXISTS (
            SELECT 1
            FROM exam_assignments ea
            WHERE ea.exam_id = e.exam_id AND ea.student_id = s.student_id
          )
        )
      WHERE e.status IN ('upcoming', 'ongoing')
        AND ABS(TIMESTAMPDIFF(MINUTE, NOW(), e.start_time) - ?) <= 1
      `,
      [reminder.minutes]
    );

    for (const assignment of dueAssignments) {
      const startAt = new Date(assignment.start_time).toLocaleString();
      const title = `${reminder.label}: ${assignment.subject}`;
      const message = `${assignment.subject} starts at ${startAt} for ${formatAudienceLabel(assignment.audience_type, assignment.batch_name)}.`;
      const scheduledFor = formatSqlDateTime(new Date());

      await createReminderNotification(pool, {
        studentId: assignment.student_id,
        examId: assignment.exam_id,
        channel: "in_app",
        title,
        message,
        scheduledFor,
      });

      if (assignment.email) {
        await createReminderNotification(pool, {
          studentId: assignment.student_id,
          examId: assignment.exam_id,
          channel: "email",
          title,
          message,
          scheduledFor,
        });
      }

      if (assignment.phone_number) {
        await createReminderNotification(pool, {
          studentId: assignment.student_id,
          examId: assignment.exam_id,
          channel: "sms",
          title,
          message,
          scheduledFor,
        });
      }
    }
  }
}

async function runExamAutomation() {
  const pool = getPool();
  await updateExamStatuses(pool);
  await dispatchExamReminders(pool);
}

function startExamAutomationLoop() {
  setInterval(() => {
    runExamAutomation().catch((error) => {
      console.error("Exam automation failed:", error.message);
    });
  }, 60 * 1000);
}

async function findExamConflict(pool, { batchName, startTime, endTime }) {
  if (!batchName) return null;

  const [rows] = await pool.query(
    `
    SELECT exam_id, subject, start_time, end_time
    FROM exam_schedules
    WHERE batch_name = ?
      AND ? < end_time
      AND ? > start_time
    ORDER BY start_time ASC
    LIMIT 1
    `,
    [batchName, startTime, endTime]
  );

  return rows[0] || null;
}

function deriveInstructorExamStatus(startTime, durationMinutes, now = new Date()) {
  const start = parseSqlDateTime(startTime);
  if (!start) return "Upcoming";
  const end = new Date(start.getTime() + Number(durationMinutes || 0) * 60000);
  if (now < start) return "Upcoming";
  if (now <= end) return "Ongoing";
  return "Completed";
}

function normalizeInstructorExamRecord(exam, now = new Date()) {
  let parsedQuestionIds = [];
  try {
    const raw = JSON.parse(exam.question_ids_json || "[]");
    parsedQuestionIds = Array.isArray(raw) ? raw : [];
  } catch {
    parsedQuestionIds = [];
  }

  const accessMode = exam.access_mode || "scheduled";
  const audienceType = normalizeAudienceType(exam.audience_type);
  const status = accessMode === "open_anytime" ? "always_open" : deriveInstructorExamStatus(exam.start_time, exam.duration_minutes, now);
  const start = parseSqlDateTime(exam.start_time);
  const timeValue = start
    ? `${padDateTimePart(start.getHours())}:${padDateTimePart(start.getMinutes())}`
    : "00:00";

  return {
    id: exam.instructor_exam_id,
    title: exam.title,
    batch: formatAudienceLabel(audienceType, exam.batch_name),
    audienceType,
    date: exam.exam_date,
    time: timeValue,
    duration: Number(exam.duration_minutes || 0),
    accessMode,
    negativeMarking: exam.negative_marking || "",
    shuffleMode: exam.shuffle_mode || "None",
    examType: exam.exam_type,
    state: exam.publish_state,
    approvalStatus: exam.approval_status || "pending",
    questionIds: parsedQuestionIds,
    rules: exam.rules || "",
    status,
  };
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
    LEFT JOIN student_performance sp ON sp.student_id = isa.student_id
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

  const [alerts] = await pool.query(
    `
    SELECT alert_id, level, title, note
    FROM instructor_alerts
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
    JOIN student_performance sp ON sp.student_id = isa.student_id
    WHERE isa.instructor_id = ? AND isa.is_active = TRUE
    GROUP BY sp.subject
    ORDER BY averageScore DESC, passRate DESC
    `,
    [instructorId]
  );

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
    alerts: alerts.map((item) => ({
      id: item.alert_id,
      level: item.level,
      title: item.title,
      note: item.note,
    })),
    coursePerformance: coursePerformance.map((item) => ({
      course: item.course,
      averageScore: Number(item.averageScore || 0),
      passRate: Number(item.passRate || 0),
      assessments: Number(item.assessments || 0),
      topScore: Number(item.topScore || 0),
      bottomScore: Number(item.bottomScore || 0),
    })),
    scoreDistribution,
  };
}

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  return sendSuccess(res, { message: "EduMate API is running" });
});

app.get("/api/public/home-stats", async (_req, res) => {
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

    const [[studentsRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM students`
    );
    const [[questionBankRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM instructor_question_bank`
    );
    const [[videoRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM instructor_course_items WHERE LOWER(content_type) LIKE '%video%'`
    );
    const [[pdfRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM instructor_course_items WHERE LOWER(content_type) LIKE '%pdf%'`
    );
    const [[attemptsRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM student_performance WHERE test_type = 'mock'`
    );

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
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { fullName, email, phone, program, batch, password } = req.body || {};

    const cleanFullName = String(fullName || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").trim();
    const cleanProgram = String(program || "").trim();
    const cleanBatchInput = normalizeBatchName(batch);
    const cleanBatch = cleanBatchInput || deriveBatchFromProgram(cleanProgram);
    const cleanPassword = String(password || "");

    if (!cleanFullName || !cleanEmail || !cleanPhone || !cleanProgram || !cleanPassword) {
      return sendError(res, { status: 422, message: "All fields are required." });
    }

    const allowedPrograms = ["Engineering", "Varsity", "Medical"];
    if (!allowedPrograms.includes(cleanProgram)) {
      return sendError(res, { status: 422, message: "Please choose a valid program." });
    }

    if (!DEFAULT_BATCH_OPTIONS.includes(cleanBatch)) {
      return sendError(res, {
        status: 422,
        message: "Please choose a valid batch (Engineering, Varsity, or Medical).",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return sendError(res, { status: 422, message: "Please provide a valid email address." });
    }

    if (cleanPassword.length < 8) {
      return sendError(res, { status: 422, message: "Password must be at least 8 characters long." });
    }

    const pool = getPool();
    const [existingRows] = await pool.query(
      "SELECT student_id FROM students WHERE email = ? OR phone_number = ? LIMIT 1",
      [cleanEmail, cleanPhone]
    );

    if (existingRows.length > 0) {
      return sendError(res, { status: 409, message: "An account already exists with this email or phone number." });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);

    await pool.query(
      "INSERT INTO students (name, email, phone_number, password_hash, batch_name, course_track) VALUES (?, ?, ?, ?, ?, ?)",
      [cleanFullName, cleanEmail, cleanPhone, passwordHash, cleanBatch, cleanProgram]
    );

    return sendSuccess(res, { status: 201, message: "Account created successfully." });
  } catch (error) {
    if (isSchemaError(error)) {
      return sendError(res, {
        message:
          "Students table/schema is missing required fields. Please create students(name, email, phone_number, password_hash) in XAMPP first.",
      });
    }

    return sendError(res, { message: "Could not create account.", error: error.message });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { identifier, password, role } = req.body || {};

    const cleanIdentifier = String(identifier || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    const cleanRole = String(role || "student").trim().toLowerCase();

    if (!cleanIdentifier || !cleanPassword) {
      return sendError(res, { status: 422, message: "Identifier and password are required." });
    }

    if (!["student", "instructor", "admin"].includes(cleanRole)) {
      return sendError(res, { status: 422, message: "Invalid login role." });
    }

    const pool = getPool();
    const { table, idColumn } = USER_ROLE_CONFIG[cleanRole];

    const [rows] = await pool.query(
      `SELECT ${idColumn} AS id, name, email, account_status, password_hash
       FROM ${table}
       WHERE (email = ? OR phone_number = ?)
       LIMIT 1`,
      [cleanIdentifier, cleanIdentifier]
    );

    if (rows.length === 0) return sendError(res, { status: 401, message: "Invalid credentials." });

    const account = rows[0];
    const passwordOk = await bcrypt.compare(cleanPassword, account.password_hash);

    if (!passwordOk) return sendError(res, { status: 401, message: "Invalid credentials." });

    if (String(account.account_status || "active").toLowerCase() === "frozen") {
      return sendError(res, { status: 403, message: "This account is frozen. Please contact an administrator." });
    }

    return sendSuccess(res, {
      message: "Login successful.",
      user: {
        id: account.id,
        fullName: account.name || account.full_name,
        email: account.email,
        role: cleanRole,
      },
    });
  } catch (error) {
    if (isSchemaError(error)) {
      return sendError(res, {
        message:
          "Required auth tables are missing required fields. Please create students/instructors/admins with (name, email, phone_number, password_hash) in XAMPP first.",
      });
    }

    return sendError(res, { message: "Could not login.", error: error.message });
  }
});

// Admin Dashboard API Endpoints

app.get("/api/admin/overview", async (_req, res) => {
  try {
    const pool = getPool();

    // Get user counts
    const [studentRows] = await pool.query("SELECT COUNT(*) as count FROM students");
    const [instructorRows] = await pool.query("SELECT COUNT(*) as count FROM instructors");
    const [adminRows] = await pool.query("SELECT COUNT(*) as count FROM admins");
    const [activeStudentRows] = await pool.query(
      "SELECT COUNT(*) as count FROM students WHERE account_status = 'active'"
    );
    const [activeInstructorRows] = await pool.query(
      "SELECT COUNT(*) as count FROM instructors WHERE account_status = 'active'"
    );
    
    // Get content statistics
    const [pendingContentRows] = await pool.query("SELECT COUNT(*) as count FROM content_submissions WHERE status = 'pending'");
    const [approvedContentRows] = await pool.query("SELECT COUNT(*) as count FROM content_submissions WHERE status = 'approved'");
    const [totalContentRows] = await pool.query("SELECT COUNT(*) as count FROM content_submissions");
    
    // Get report statistics
    const [openReportsRows] = await pool.query("SELECT COUNT(*) as count FROM reports WHERE status = 'open'");
    const [totalReportsRows] = await pool.query("SELECT COUNT(*) as count FROM reports");
    const [completedReportsRows] = await pool.query("SELECT COUNT(*) as count FROM reports WHERE status = 'completed'");

    // Get recent signups (last 24 hours)
    const [newSignups] = await pool.query(
      "SELECT COUNT(*) as count FROM students WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)"
    );
    
    // Get total active users (students + instructors)
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
});

app.get("/api/admin/users", async (_req, res) => {
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
});

app.post("/api/admin/users", async (req, res) => {
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
});

app.patch("/api/admin/users/:role/:id/status", async (req, res) => {
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
    const [accountRows] = await pool.query(
      `SELECT name, email FROM ${config.table} WHERE ${config.idColumn} = ? LIMIT 1`,
      [id]
    );

    if (accountRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    const [result] = await pool.query(
      `UPDATE ${config.table} SET account_status = ? WHERE ${config.idColumn} = ?`,
      [nextStatus, id]
    );

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
});

app.delete("/api/admin/users/:role/:id", async (req, res) => {
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
    const [accountRows] = await pool.query(
      `SELECT name, email FROM ${config.table} WHERE ${config.idColumn} = ? LIMIT 1`,
      [id]
    );

    if (accountRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    const [result] = await pool.query(
      `DELETE FROM ${config.table} WHERE ${config.idColumn} = ?`,
      [id]
    );

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
});

app.get("/api/admin/content", async (_req, res) => {
  try {
    const pool = getPool();

    const [content] = await pool.query(
      `
      SELECT
        cs.submission_id as id,
        cs.title,
        cs.type,
        cs.description,
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

    return res.status(200).json({
      success: true,
      data: content,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch content submissions.",
      error: error.message,
    });
  }
});

app.get("/api/admin/reports", async (_req, res) => {
  try {
    const pool = getPool();

    const [reports] = await pool.query(
      `SELECT report_id as id, title, description, category, reporter_name as reporterName,
              reporter_email as reporterEmail, status, priority, value, admin_note as adminNote,
              created_at as createdAt, updated_at as updatedAt
       FROM reports ORDER BY created_at DESC`
    );

    return res.status(200).json({
      success: true,
      data: reports,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch reports.",
      error: error.message,
    });
  }
});

app.post("/api/reports", async (req, res) => {
  try {
    const cleanTitle = String(req.body?.title || "").trim();
    const cleanDescription = String(req.body?.description || "").trim();
    const cleanCategory = String(req.body?.category || "bug").trim().toLowerCase();
    const cleanPriority = String(req.body?.priority || "medium").trim().toLowerCase();
    const cleanReporterName = String(req.body?.reporterName || "").trim();
    const cleanReporterEmail = String(req.body?.reporterEmail || "").trim().toLowerCase();

    if (!cleanTitle || !cleanDescription) {
      return res.status(422).json({
        success: false,
        message: "Report title and description are required.",
      });
    }

    if (!["complaint", "bug", "content"].includes(cleanCategory)) {
      return res.status(422).json({
        success: false,
        message: "Report category must be complaint, bug, or content.",
      });
    }

    const pool = getPool();
    const [result] = await pool.query(
      `
      INSERT INTO reports (title, description, category, reporter_name, reporter_email, status, priority, value)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
      `,
      [
        cleanTitle,
        cleanDescription,
        cleanCategory,
        cleanReporterName || null,
        cleanReporterEmail || null,
        cleanPriority,
        cleanCategory,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Report submitted successfully.",
      data: { id: result.insertId },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not submit report.",
      error: error.message,
    });
  }
});

app.get("/api/admin/activity-logs", async (_req, res) => {
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
    return res.status(500).json({
      success: false,
      message: "Could not fetch activity logs.",
      error: error.message,
    });
  }
});

app.post("/api/admin/content/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [contentRows] = await pool.query(
      "SELECT title, type, source_ref FROM content_submissions WHERE submission_id = ? LIMIT 1",
      [id]
    );

    const [result] = await pool.query(
      "UPDATE content_submissions SET status = 'approved' WHERE submission_id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Content submission not found.",
      });
    }

    const sourceRef = String(contentRows[0]?.source_ref || "");
    const questionRefMatch = sourceRef.match(/^instructor_question_bank:(\d+)$/);
    const instructorExamRefMatch = sourceRef.match(/^instructor_exam_schedules:(\d+)$/);
    const adminId = parseRequiredId(req.body?.adminId) || null;
    if (questionRefMatch) {
      await pool.query(
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
      const [[instructorExam]] = await pool.query(
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
          const [examInsertResult] = await pool.query(
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

        await pool.query(
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
            await pool.query(
              `
              INSERT IGNORE INTO exam_question_mappings (exam_id, question_id, order_index)
              VALUES (?, ?, ?)
              `,
              [publishedExamId, questionIds[index], index + 1]
            );
          }

          const placeholders = questionIds.map(() => "?").join(", ");
          await pool.query(
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

    await logAdminActivity(pool, {
      action: "approved_content",
      targetType: "content",
      targetId: Number(id),
      targetLabel: contentRows[0]?.title || `Submission #${id}`,
      details: { type: contentRows[0]?.type || null },
    });

    return res.status(200).json({
      success: true,
      message: "Content approved successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not approve content.",
      error: error.message,
    });
  }
});

app.post("/api/admin/content/:id/deny", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const [contentRows] = await pool.query(
      "SELECT title, type, source_ref FROM content_submissions WHERE submission_id = ? LIMIT 1",
      [id]
    );

    const [result] = await pool.query(
      "UPDATE content_submissions SET status = 'denied' WHERE submission_id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Content submission not found.",
      });
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

    return res.status(200).json({
      success: true,
      message: "Content denied successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not deny content.",
      error: error.message,
    });
  }
});

app.post("/api/admin/reports/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;
    const adminNote = String(req.body?.note || "").trim();
    const pool = getPool();
    const [reportRows] = await pool.query(
      "SELECT title, category FROM reports WHERE report_id = ? LIMIT 1",
      [id]
    );

    const [result] = await pool.query(
      "UPDATE reports SET status = 'completed', admin_note = NULLIF(?, '') WHERE report_id = ?",
      [adminNote, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Report not found.",
      });
    }

    await logAdminActivity(pool, {
      action: "resolved_report",
      targetType: "report",
      targetId: Number(id),
      targetLabel: reportRows[0]?.title || `Report #${id}`,
      details: { category: reportRows[0]?.category || null, note: adminNote || null },
    });

    return res.status(200).json({
      success: true,
      message: "Report resolved successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not resolve report.",
      error: error.message,
    });
  }
});

app.post("/api/admin/reports/:id/deny", async (req, res) => {
  try {
    const { id } = req.params;
    const adminNote = String(req.body?.note || "").trim();
    const pool = getPool();
    const [reportRows] = await pool.query(
      "SELECT title, category FROM reports WHERE report_id = ? LIMIT 1",
      [id]
    );

    const [result] = await pool.query(
      "UPDATE reports SET status = 'denied', admin_note = NULLIF(?, '') WHERE report_id = ?",
      [adminNote, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Report not found.",
      });
    }

    await logAdminActivity(pool, {
      action: "dismissed_report",
      targetType: "report",
      targetId: Number(id),
      targetLabel: reportRows[0]?.title || `Report #${id}`,
      details: { category: reportRows[0]?.category || null, note: adminNote || null },
    });

    return res.status(200).json({
      success: true,
      message: "Report denied successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not deny report.",
      error: error.message,
    });
  }
});

app.get("/api/admin/students/targets", async (_req, res) => {
  try {
    const pool = getPool();
    const [students] = await pool.query(
      `
      SELECT student_id, name, email, batch_name, course_track
      FROM students
      ORDER BY batch_name ASC, name ASC
      `
    );

    return res.status(200).json({
      success: true,
      data: students,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch student targets.",
      error: error.message,
    });
  }
});

app.get("/api/admin/exams", async (_req, res) => {
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

    return res.status(200).json({
      success: true,
      data: rows.map((row) => normalizeExamRecord(row)),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch exams.",
      error: error.message,
    });
  }
});

app.post("/api/admin/exams", async (req, res) => {
  try {
    const {
      subject,
      date,
      time,
      duration,
      batchName,
      instructions,
      assignmentType,
      specificStudentIds,
      joinWindowMinutes,
      adminId,
    } = req.body || {};

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
      return res.status(422).json({
        success: false,
        message: "Assignment type must be batch or specific.",
      });
    }

    if (cleanAssignmentType === "specific" && selectedStudentIds.length === 0) {
      return res.status(422).json({
        success: false,
        message: "Select at least one student for a specific assignment.",
      });
    }

    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
    const pool = getPool();
    await updateExamStatuses(pool);

    const startTimeSql = formatSqlDateTime(startDate);
    const endTimeSql = formatSqlDateTime(endDate);
    const conflict = await findExamConflict(pool, {
      batchName: cleanBatchName,
      startTime: startTimeSql,
      endTime: endTimeSql,
    });

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
        await pool.query(
          `INSERT IGNORE INTO exam_assignments (exam_id, student_id) VALUES (?, ?)`,
          [result.insertId, studentId]
        );
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
    return res.status(500).json({
      success: false,
      message: "Could not create exam.",
      error: error.message,
    });
  }
});

// Student Performance & Dashboard API Endpoints

app.get("/api/instructor/:instructorId/workspace", async (req, res) => {
  try {
    const instructorId = parseRequiredId(req.params.instructorId);
    if (!instructorId) return sendError(res, { status: 422, message: "Valid instructor ID is required." });

    const pool = getPool();
    const workspace = await buildInstructorWorkspace(pool, instructorId);
    return sendSuccess(res, { data: workspace });
  } catch (error) {
    return sendError(res, { message: "Could not load instructor workspace.", error: error.message });
  }
});

app.post("/api/instructor/:instructorId/course-items", async (req, res) => {
  try {
    const instructorId = parseRequiredId(req.params.instructorId);
    const course = String(req.body?.course || "").trim();
    const type = String(req.body?.type || "").trim();
    const audienceType = normalizeAudienceType(req.body?.audienceType || "batch");
    const rawBatchName = normalizeBatchName(req.body?.batchName);
    const batchName = audienceType === "all" ? ALL_BATCHES_LABEL : rawBatchName;
    const title = String(req.body?.title || "").trim();
    const summary = String(req.body?.summary || "").trim();
    const deadline = String(req.body?.deadline || "").trim();
    const link = String(req.body?.link || "").trim();

    if (!instructorId || !course || !type || !title || !summary) {
      return sendError(res, { status: 422, message: "Course, type, title, and summary are required." });
    }

    if (audienceType === "batch" && !batchName) {
      return sendError(res, { status: 422, message: "Please choose a batch for this content." });
    }

    if (!link) {
      return sendError(res, { status: 422, message: "Content link is required for every upload." });
    }

    const pool = getPool();
    await pool.query(
      `
      INSERT INTO instructor_course_items
        (instructor_id, course_title, batch_name, audience_type, content_type, title, summary, deadline, source_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?)
      `,
      [instructorId, course, batchName, audienceType, type, title, summary, deadline, link]
    );

    await pool.query(
      `
      INSERT INTO content_submissions
        (instructor_id, course_title, batch_name, title, type, description, deadline, status, source_ref)
      VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), 'pending', ?)
      `,
      [instructorId, course, batchName, title, type, summary, deadline, link]
    );

    await pool.query(
      `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'New study material uploaded', ?)`,
      [instructorId, `${title} was uploaded for ${formatAudienceLabel(audienceType, batchName)} and sent for admin approval.`]
    );

    return sendSuccess(res, { status: 201, message: "Course content uploaded and sent for admin approval." });
  } catch (error) {
    return sendError(res, { message: "Could not upload course content.", error: error.message });
  }
});

app.post("/api/instructor/:instructorId/question-bank", async (req, res) => {
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
      [instructorId, audienceType === "all" ? null : batchName, audienceType, subject, type, text, options || null, answerKey]
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
          `${type} Question`,
          `Audience: ${formatAudienceLabel(audienceType, batchName)}\n${text}\n\nOptions: ${options || "N/A"}\nAnswer key: ${answerKey}`,
          `instructor_question_bank:${questionId}`,
        ]
      );
    }

    return sendSuccess(res, {
      status: 201,
      message: skipSubmission
        ? "Question added to draft exam."
        : "Question added and sent to admin for approval.",
      data: { questionId },
    });
  } catch (error) {
    return sendError(res, { message: "Could not add question.", error: error.message });
  }
});

app.post("/api/instructor/:instructorId/exams", async (req, res) => {
  try {
    const instructorId = parseRequiredId(req.params.instructorId);
    const title = String(req.body?.title || "").trim();
    const subject = String(req.body?.subject || "").trim();
    const audienceType = normalizeAudienceType(req.body?.audienceType || "batch");
    const rawBatchName = normalizeBatchName(req.body?.batchName);
    const batchName = audienceType === "all" ? ALL_BATCHES_LABEL : rawBatchName;
    const accessMode = String(req.body?.accessMode || "scheduled").trim();
    const date = String(req.body?.date || "").trim();
    const time = String(req.body?.time || "").trim();
    const endTimeInput = String(req.body?.endTime || "").trim();
    let duration = parsePositiveInteger(req.body?.duration);
    const negativeMarking = String(req.body?.negativeMarking || "").trim();
    const perMcqMark = Number(req.body?.perMcqMark || 0);
    const shuffleMode = String(req.body?.shuffleMode || "").trim();
    const examType = String(req.body?.examType || "").trim();
    const state = String(req.body?.state || "Draft").trim();
    const rules = String(req.body?.rules || "").trim();
    const questionIds = parseQuestionIds(req.body?.questionIds || []);

    if (!instructorId || !title || !subject || !examType) {
      return sendError(res, { status: 422, message: "Title, subject, duration, and exam type are required." });
    }
    if (!Number.isFinite(perMcqMark) || perMcqMark <= 0) {
      return sendError(res, { status: 422, message: "Per MCQ mark must be greater than 0." });
    }

    if (accessMode !== "scheduled" && accessMode !== "open_anytime") {
      return sendError(res, { status: 422, message: "Access mode must be scheduled or open_anytime." });
    }

    if (audienceType === "batch" && !batchName) {
      return sendError(res, { status: 422, message: "Please select a target batch or choose all batches." });
    }

    if (accessMode === "scheduled" && (!date || !time)) {
      return sendError(res, { status: 422, message: "Scheduled exams require a date and time." });
    }

    if (!questionIds.length) {
      return sendError(res, { status: 422, message: "Select at least one question for the exam." });
    }

    let startTime = null;
    let startDate = null;
    let endTimeDisplay = "";
    if (accessMode === "scheduled") {
      startDate = toDateTimeValue(date, time);
      if (!startDate) return sendError(res, { status: 422, message: "Invalid exam date or time." });
      if (endTimeInput) {
        const parsedEnd = toDateTimeValue(date, endTimeInput);
        if (!parsedEnd) {
          return sendError(res, { status: 422, message: "Invalid exam end time." });
        }
        if (parsedEnd <= startDate) parsedEnd.setDate(parsedEnd.getDate() + 1);
        const computedDuration = Math.round((parsedEnd.getTime() - startDate.getTime()) / 60000);
        if (!Number.isFinite(computedDuration) || computedDuration <= 0) {
          return sendError(res, { status: 422, message: "Exam end time must be after start time." });
        }
        duration = computedDuration;
      }
      if (!duration) {
        return sendError(res, { status: 422, message: "Duration is required." });
      }
      const computedEndDate = new Date(startDate.getTime() + Number(duration || 0) * 60000);
      endTimeDisplay = `${padDateTimePart(computedEndDate.getHours())}:${padDateTimePart(
        computedEndDate.getMinutes()
      )}`;
      startTime = formatSqlDateTime(startDate);
    } else {
      if (!duration) {
        return sendError(res, { status: 422, message: "Duration is required." });
      }
      startTime = formatSqlDateTime(new Date());
    }

    const pool = getPool();
    if (accessMode === "scheduled") {
      const conflict = await findInstructorExamConflict(pool, {
        instructorId,
        batchName,
        audienceType,
        startTime,
        durationMinutes: duration,
      });
      if (conflict) {
        return sendError(res, {
          status: 409,
          message: "A scheduled exam already overlaps this time window.",
        });
      }
    }

    const compiledRules = [
      `Subject: ${subject}`,
      `Per MCQ Mark: ${perMcqMark}`,
      accessMode === "scheduled" ? `End Time: ${endTimeDisplay || "-"}` : null,
      rules || null,
    ]
      .filter(Boolean)
      .join("\n");

    const [insertResult] = await pool.query(
      `
      INSERT INTO instructor_exam_schedules
        (instructor_id, title, batch_name, audience_type, exam_date, start_time, duration_minutes, negative_marking, shuffle_mode, exam_type, publish_state, question_ids_json, approval_status, rules, access_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `,
      [
        instructorId,
        title,
        batchName,
        audienceType,
        date || new Date().toISOString().slice(0, 10),
        startTime,
        duration,
        negativeMarking || null,
        shuffleMode || null,
        examType,
        state,
        JSON.stringify(questionIds),
        compiledRules || null,
        accessMode,
      ]
    );
    const instructorExamId = Number(insertResult?.insertId || 0);

    if (instructorExamId) {
      await pool.query(
        `
        INSERT INTO content_submissions
          (instructor_id, course_title, batch_name, title, type, description, status, source_ref)
        VALUES (?, ?, ?, ?, 'Exam', ?, 'pending', ?)
        `,
        [
          instructorId,
          subject,
          batchName,
          title,
          `Subject: ${subject}\nAudience: ${formatAudienceLabel(audienceType, batchName)}\nExam Type: ${examType}\nPer MCQ Mark: ${perMcqMark}\nAccess: ${accessMode === "scheduled" ? `${date} ${time}${endTimeDisplay ? ` - ${endTimeDisplay}` : ""}` : "Anytime"}\nDuration: ${duration} min\nQuestions: ${questionIds.length}\nRules: ${rules || "-"}`,
          `instructor_exam_schedules:${instructorExamId}`,
        ]
      );
    }

    await pool.query(
      `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'New exam scheduled', ?)`,
      [instructorId, `${title} for ${formatAudienceLabel(audienceType, batchName)} (${accessMode === "scheduled" ? date + " " + time : "Anytime"}) sent for admin approval.`]
    );

    return sendSuccess(res, { status: 201, message: "Exam created and sent for admin approval." });
  } catch (error) {
    return sendError(res, { message: "Could not create instructor exam.", error: error.message });
  }
});

app.post("/api/instructor/:instructorId/student-actions", async (req, res) => {
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
});

app.post("/api/instructor/:instructorId/messages", async (req, res) => {
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
});

app.get("/api/student/:studentId/profile", async (req, res) => {
  try {
    const studentId = parseRequiredId(req.params.studentId);
    if (!studentId) {
      return sendError(res, { status: 422, message: "Valid student ID is required." });
    }

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

    if (!rows.length) {
      return sendError(res, { status: 404, message: "Student profile not found." });
    }

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
    return sendError(res, {
      message: "Could not fetch student profile.",
      error: error.message,
    });
  }
});

app.patch("/api/student/:studentId/profile", async (req, res) => {
  try {
    const studentId = parseRequiredId(req.params.studentId);
    if (!studentId) {
      return sendError(res, { status: 422, message: "Valid student ID is required." });
    }

    const fullName = String(req.body?.fullName || "").trim();
    const phone = String(req.body?.phone || req.body?.phoneNumber || "").trim();
    const program = String(req.body?.program || "").trim();

    if (!fullName) {
      return sendError(res, { status: 422, message: "Full name is required." });
    }

    const allowedPrograms = ["Engineering", "Varsity", "Medical"];
    if (!allowedPrograms.includes(program)) {
      return sendError(res, { status: 422, message: "Please choose a valid program." });
    }

    if (phone && phone.length < 6) {
      return sendError(res, { status: 422, message: "Please provide a valid phone number." });
    }

    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT student_id FROM students WHERE student_id = ? LIMIT 1`,
      [studentId]
    );

    if (!rows.length) {
      return sendError(res, { status: 404, message: "Student profile not found." });
    }

    const mappedBatch = deriveBatchFromProgram(program) || program;

    await pool.query(
      `UPDATE students SET name = ?, phone_number = ?, course_track = ?, batch_name = ? WHERE student_id = ?`,
      [fullName, phone || null, program, mappedBatch, studentId]
    );

    return sendSuccess(res, {
      message: "Profile updated successfully.",
      data: {
        id: studentId,
        fullName,
        phoneNumber: phone || "",
        program,
        batch: mappedBatch,
      },
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return sendError(res, {
        status: 409,
        message: "This phone number is already used by another account.",
      });
    }

    return sendError(res, {
      message: "Could not update profile.",
      error: error.message,
    });
  }
});

app.patch("/api/student/:studentId/password", async (req, res) => {
  try {
    const studentId = parseRequiredId(req.params.studentId);
    if (!studentId) {
      return sendError(res, { status: 422, message: "Valid student ID is required." });
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    const confirmPassword = String(req.body?.confirmPassword || "");

    if (!currentPassword || !newPassword || !confirmPassword) {
      return sendError(res, {
        status: 422,
        message: "Current password, new password, and confirm password are required.",
      });
    }

    if (newPassword.length < 8) {
      return sendError(res, {
        status: 422,
        message: "New password must be at least 8 characters long.",
      });
    }

    if (newPassword !== confirmPassword) {
      return sendError(res, {
        status: 422,
        message: "New password and confirm password do not match.",
      });
    }

    if (currentPassword === newPassword) {
      return sendError(res, {
        status: 422,
        message: "New password must be different from your current password.",
      });
    }

    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT password_hash FROM students WHERE student_id = ? LIMIT 1`,
      [studentId]
    );

    if (!rows.length) {
      return sendError(res, { status: 404, message: "Student profile not found." });
    }

    const currentPasswordOk = await bcrypt.compare(currentPassword, rows[0].password_hash || "");
    if (!currentPasswordOk) {
      return sendError(res, { status: 401, message: "Current password is incorrect." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE students SET password_hash = ? WHERE student_id = ?`,
      [passwordHash, studentId]
    );

    return sendSuccess(res, { message: "Password reset successful." });
  } catch (error) {
    return sendError(res, {
      message: "Could not reset password.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/exams", async (req, res) => {
  try {
    const { studentId } = req.params;
    const pool = getPool();
    await updateExamStatuses(pool);

    const [studentRows] = await pool.query(
      `SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`,
      [studentId]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const student = studentRows[0];
    const studentProgramGroup = resolveStudentProgramGroup(student);
    const [rows] = await pool.query(
      `
      SELECT DISTINCT
        e.*,
        COUNT(DISTINCT ea2.student_id) AS assigned_student_count,
        MAX(CASE WHEN ea.student_id = ? THEN 1 ELSE 0 END) AS is_assigned_to_student
      FROM exam_schedules e
      LEFT JOIN exam_assignments ea ON ea.exam_id = e.exam_id
      LEFT JOIN exam_assignments ea2 ON ea2.exam_id = e.exam_id
      GROUP BY e.exam_id
      ORDER BY e.start_time ASC
      `,
      [studentId]
    );

    const now = new Date();
    const visibleRows = rows.filter((row) => {
      const explicitlyAssigned = Number(row.is_assigned_to_student || 0) === 1;
      if (explicitlyAssigned) return true;
      return isAudienceVisibleToStudent({
        audienceType: row.audience_type,
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
        student: {
          id: student.student_id,
          batchName: student.batch_name,
          courseTrack: student.course_track,
        },
        nextExam,
        exams,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch exam routine.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/mock-questions", async (req, res) => {
  try {
    const studentId = parseRequiredId(req.params.studentId);
    if (!studentId) {
      return sendError(res, { status: 422, message: "Valid student ID is required." });
    }

    const rawSubjects = []
      .concat(req.query.subjects || [])
      .concat(req.query.subject || [])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const subjects = Array.from(new Set(rawSubjects.map((item) => item.toLowerCase())));
    const examId = parseRequiredId(req.query.examId);
    const requestedCount = Number(req.query.count);
    const count = Number.isFinite(requestedCount)
      ? Math.max(1, Math.min(100, Math.floor(requestedCount)))
      : 20;

    const pool = getPool();
    const [studentRows] = await pool.query(
      `SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`,
      [studentId]
    );
    if (!studentRows.length) {
      return sendError(res, { status: 404, message: "Student not found." });
    }
    const student = studentRows[0];
    const studentProgramGroup = resolveStudentProgramGroup(student);

    if (examId) {
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
        const visibleByAudience = isAudienceVisibleToStudent({
          audienceType: exam.audience_type,
          batchName: exam.batch_name,
          studentBatchName: student.batch_name,
          studentProgramGroup,
        });

        if (explicitlyAssigned || visibleByAudience) {
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
            return {
              id: row.question_id,
              subject: row.subject,
              text: row.question_text,
              opts: options,
              ans: answerIndex,
            };
          })
          .filter(Boolean)
          .slice(0, count);

        if (mappedQuestions.length) {
          return sendSuccess(res, {
            data: {
              questions: mappedQuestions,
              requestedCount: count,
              deliveredCount: mappedQuestions.length,
            },
          });
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
        return {
          id: row.question_id,
          subject: row.subject,
          text: row.question_text,
          opts: options,
          ans: answerIndex,
        };
      })
      .filter(Boolean)
      .slice(0, count);

    return sendSuccess(res, {
      data: {
        questions,
        requestedCount: count,
        deliveredCount: questions.length,
      },
    });
  } catch (error) {
    return sendError(res, {
      message: "Could not fetch approved mock questions.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/assignments", async (req, res) => {
  try {
    const { studentId } = req.params;
    const pool = getPool();

    const [studentRows] = await pool.query(
      `SELECT student_id, batch_name, course_track FROM students WHERE student_id = ? LIMIT 1`,
      [studentId]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const student = studentRows[0];
    const [assignments] = await pool.query(
      `
      SELECT
        cs.submission_id AS id,
        cs.course_title AS courseTitle,
        cs.batch_name AS batchName,
        cs.title,
        cs.description,
        cs.deadline,
        cs.created_at AS createdAt,
        i.name AS instructorName
      FROM content_submissions cs
      LEFT JOIN instructors i ON i.instructor_id = cs.instructor_id
      WHERE cs.status = 'approved'
        AND LOWER(cs.type) = 'assignment'
      ORDER BY
        CASE WHEN cs.deadline IS NULL THEN 1 ELSE 0 END,
        cs.deadline ASC,
        cs.created_at DESC
      LIMIT 100
      `
    );

    const studentProgramGroup = resolveStudentProgramGroup(student);
    const filteredAssignments = assignments
      .filter((item) =>
        isAudienceVisibleToStudent({
          audienceType: "batch",
          batchName: item.batchName || item.courseTitle || "",
          studentBatchName: student.batch_name,
          studentProgramGroup,
        })
      )
      .slice(0, 12);

    return res.status(200).json({
      success: true,
      data: filteredAssignments,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch assignments.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/notifications", async (req, res) => {
  try {
    const { studentId } = req.params;
    const pool = getPool();

    const [notifications] = await pool.query(
      `
      SELECT notification_id, exam_id, channel, type, title, message, status, scheduled_for, sent_at, created_at
      FROM notifications
      WHERE student_id = ? AND channel = 'in_app'
      ORDER BY COALESCE(sent_at, created_at) DESC
      LIMIT 15
      `,
      [studentId]
    );

    const [summaryRows] = await pool.query(
      `
      SELECT COUNT(*) AS unread_count
      FROM notifications
      WHERE student_id = ? AND channel = 'in_app' AND status = 'unread'
      `,
      [studentId]
    );

    return res.status(200).json({
      success: true,
      data: {
        unreadCount: Number(summaryRows[0]?.unread_count || 0),
        items: notifications,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch notifications.",
      error: error.message,
    });
  }
});

app.patch("/api/student/:studentId/notifications/:notificationId/read", async (req, res) => {
  try {
    const { studentId, notificationId } = req.params;
    const pool = getPool();

    await pool.query(
      `
      UPDATE notifications
      SET status = 'read', read_at = NOW()
      WHERE student_id = ? AND notification_id = ? AND channel = 'in_app'
      `,
      [studentId, notificationId]
    );

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not update notification.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/dashboard", async (req, res) => {
  try {
    const { studentId } = req.params;
    const pool = getPool();

    // Get all performance records for this student
    const [allPerformance] = await pool.query(
      `SELECT score FROM student_performance WHERE student_id = ? ORDER BY created_at DESC`,
      [studentId]
    );

    // Get average score
    const [avgResult] = await pool.query(
      `SELECT AVG(score) as average_score FROM student_performance WHERE student_id = ?`,
      [studentId]
    );

    // Get best score
    const [bestResult] = await pool.query(
      `SELECT MAX(score) as best_score FROM student_performance WHERE student_id = ?`,
      [studentId]
    );

    // Get total mock tests completed
    const [mockTests] = await pool.query(
      `SELECT COUNT(*) as count FROM student_performance WHERE student_id = ? AND test_type = 'mock'`,
      [studentId]
    );

    // Get average accuracy (correct answers / total questions)
    const [accuracyResult] = await pool.query(
      `SELECT ROUND((SUM(correct_answers) / SUM(total_questions)) * 100, 2) as accuracy 
       FROM student_performance WHERE student_id = ? AND total_questions > 0`,
      [studentId]
    );

    // Get study streak (days with tests in last 30 days)
    const [studyDays] = await pool.query(
      `SELECT COUNT(DISTINCT DATE(created_at)) as study_days 
       FROM student_performance WHERE student_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [studentId]
    );

    // Get last test info
    const [lastTest] = await pool.query(
      `SELECT test_name, subject, score, created_at FROM student_performance 
       WHERE student_id = ? ORDER BY created_at DESC LIMIT 1`,
      [studentId]
    );

    return res.status(200).json({
      success: true,
      data: {
        totalTests: allPerformance.length,
        averageScore: parseFloat(avgResult[0]?.average_score || 0).toFixed(1),
        bestScore: bestResult[0]?.best_score || 0,
        mockTestsCompleted: mockTests[0]?.count || 0,
        accuracy: parseFloat(accuracyResult[0]?.accuracy || 0).toFixed(1),
        studyDays: studyDays[0]?.study_days || 0,
        lastTest: lastTest[0] ? {
          name: lastTest[0].test_name,
          subject: lastTest[0].subject,
          score: lastTest[0].score,
          date: lastTest[0].created_at
        } : null,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch dashboard data.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/performance", async (req, res) => {
  try {
    const { studentId } = req.params;
    const pool = getPool();

    const [performance] = await pool.query(
      `SELECT performance_id, subject, test_type, score, total_questions, correct_answers, 
              test_name, rank, total_participants, created_at 
       FROM student_performance WHERE student_id = ? ORDER BY created_at DESC`,
      [studentId]
    );

    return res.status(200).json({
      success: true,
      data: performance,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch performance data.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/performance/subjects", async (req, res) => {
  try {
    const { studentId } = req.params;
    const pool = getPool();

    const [subjects] = await pool.query(
      `SELECT subject, 
              ROUND((SUM(correct_answers) / SUM(total_questions)) * 100, 2) as accuracy,
              COUNT(*) as test_count,
              ROUND(AVG(score), 2) as average_score,
              MAX(score) as best_score
       FROM student_performance WHERE student_id = ? AND total_questions > 0
       GROUP BY subject ORDER BY accuracy DESC`,
      [studentId]
    );

    return res.status(200).json({
      success: true,
      data: subjects,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch subject performance data.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/performance/recent-tests", async (req, res) => {
  try {
    const { studentId } = req.params;
    const pool = getPool();

    const [recentTests] = await pool.query(
      `SELECT performance_id, test_name, subject, score, rank, total_participants, 
              test_type, created_at FROM student_performance 
       WHERE student_id = ? ORDER BY created_at DESC LIMIT 10`,
      [studentId]
    );

    return res.status(200).json({
      success: true,
      data: recentTests,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch recent tests.",
      error: error.message,
    });
  }
});

app.get("/api/student/:studentId/courses", async (req, res) => {
  try {
    const { studentId } = req.params;
    const pool = getPool();

    // Get student's program and batch
    const [studentRows] = await pool.query(
      `SELECT student_id, course_track, batch_name FROM students WHERE student_id = ? LIMIT 1`,
      [studentId]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const student = studentRows[0];
    const studentProgramGroup = resolveStudentProgramGroup(student);
    const studentBatch = String(student.batch_name || "").trim();

    const [courses] = await pool.query(
      `SELECT item_id, course_title, batch_name, audience_type, content_type, title, summary, deadline, source_ref AS link
       FROM instructor_course_items
       ORDER BY created_at DESC
       LIMIT 200`
    );
    const filteredCourses = courses.filter((item) =>
      isAudienceVisibleToStudent({
        audienceType: item.audience_type,
        batchName: item.batch_name || item.course_title || "",
        studentBatchName: studentBatch,
        studentProgramGroup,
      })
    );

    const activeCourseSet = new Set(filteredCourses.map((item) => String(item.course_title || "").trim()).filter(Boolean));
    const activeCourses = activeCourseSet.size;
    const totalLessons = filteredCourses.length;
    const progressSamples = filteredCourses.map((item) => {
      const deadline = item.deadline ? new Date(item.deadline) : null;
      return deadline && !Number.isNaN(deadline.getTime()) && deadline >= new Date() ? 100 : 50;
    });
    const avgProgress = progressSamples.length
      ? Math.round(progressSamples.reduce((sum, value) => sum + value, 0) / progressSamples.length)
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        courses: filteredCourses,
        stats: {
          activeCourses,
          lessonsCompleted: totalLessons,
          avgProgress,
        }
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch courses.",
      error: error.message,
    });
  }
});

app.post("/api/student/:studentId/performance", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { subject, testType, score, totalQuestions, correctAnswers, testName, rank, totalParticipants } = req.body || {};

    if (!subject || !testType || score === undefined) {
      return res.status(422).json({
        success: false,
        message: "Subject, test type, and score are required.",
      });
    }

    const pool = getPool();

    await pool.query(
      `INSERT INTO student_performance 
       (student_id, subject, test_type, score, total_questions, correct_answers, test_name, rank, total_participants)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [studentId, subject, testType, score, totalQuestions, correctAnswers, testName, rank, totalParticipants]
    );

    return res.status(201).json({
      success: true,
      message: "Performance record created successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not create performance record.",
      error: error.message,
    });
  }
});

app.post("/api/student/:studentId/proctoring-events", async (req, res) => {
  try {
    const studentId = parseRequiredId(req.params.studentId);
    if (!studentId) {
      return sendError(res, { status: 422, message: "Valid student ID is required." });
    }

    const eventType = String(req.body?.eventType || "").trim().toLowerCase();
    const allowedEventTypes = ["photo_capture", "disqualified"];
    if (!allowedEventTypes.includes(eventType)) {
      return sendError(res, { status: 422, message: "Invalid proctoring event type." });
    }

    const examId = parseRequiredId(req.body?.examId) || null;
    const reason = String(req.body?.reason || "").trim() || null;
    const photoDataUrl = String(req.body?.photoDataUrl || "").trim() || null;

    const pool = getPool();
    await pool.query(
      `
      INSERT INTO proctoring_events (student_id, exam_id, event_type, reason, photo_data_url)
      VALUES (?, ?, ?, ?, ?)
      `,
      [studentId, examId, eventType, reason, photoDataUrl]
    );

    return sendSuccess(res, {
      status: 201,
      message: "Proctoring event recorded.",
    });
  } catch (error) {
    return sendError(res, {
      message: "Could not record proctoring event.",
      error: error.message,
    });
  }
});

// Discussion & Study Circle API Endpoints

app.get("/api/discussions", async (req, res) => {
  try {
    const pool = getPool();

    const [discussions] = await pool.query(
      `SELECT d.discussion_id, d.student_id, d.title, d.content, d.subject, d.tag, 
              d.reply_count, d.is_pinned, d.created_at, s.name as author_name
       FROM discussions d
       JOIN students s ON d.student_id = s.student_id
       ORDER BY d.is_pinned DESC, d.created_at DESC LIMIT 20`
    );

    return res.status(200).json({
      success: true,
      data: discussions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch discussions.",
      error: error.message,
    });
  }
});

app.get("/api/discussions/:discussionId", async (req, res) => {
  try {
    const { discussionId } = req.params;
    const pool = getPool();

    const [discussion] = await pool.query(
      `SELECT d.*, s.name as author_name FROM discussions d
       JOIN students s ON d.student_id = s.student_id
       WHERE d.discussion_id = ?`,
      [discussionId]
    );

    if (discussion.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Discussion not found.",
      });
    }

    const [replies] = await pool.query(
      `SELECT dr.reply_id, dr.student_id, dr.content, dr.created_at, s.name as author_name
       FROM discussion_replies dr
       JOIN students s ON dr.student_id = s.student_id
       WHERE dr.discussion_id = ? ORDER BY dr.created_at ASC`,
      [discussionId]
    );

    return res.status(200).json({
      success: true,
      data: {
        ...discussion[0],
        replies: replies,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch discussion.",
      error: error.message,
    });
  }
});

app.post("/api/discussions", async (req, res) => {
  try {
    const { studentId, title, content, subject } = req.body || {};

    if (!studentId || !title || !content) {
      return res.status(422).json({
        success: false,
        message: "Student ID, title, and content are required.",
      });
    }

    const pool = getPool();

    const [result] = await pool.query(
      `INSERT INTO discussions (student_id, title, content, subject) 
       VALUES (?, ?, ?, ?)`,
      [studentId, title, content, subject || "general"]
    );

    return res.status(201).json({
      success: true,
      message: "Discussion created successfully.",
      data: { discussion_id: result.insertId },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not create discussion.",
      error: error.message,
    });
  }
});

app.post("/api/discussions/:discussionId/reply", async (req, res) => {
  try {
    const { discussionId } = req.params;
    const { studentId, content } = req.body || {};

    if (!studentId || !content) {
      return res.status(422).json({
        success: false,
        message: "Student ID and content are required.",
      });
    }

    const pool = getPool();

    await pool.query(
      `INSERT INTO discussion_replies (discussion_id, student_id, content) 
       VALUES (?, ?, ?)`,
      [discussionId, studentId, content]
    );

    await pool.query(
      `UPDATE discussions SET reply_count = reply_count + 1 WHERE discussion_id = ?`,
      [discussionId]
    );

    return res.status(201).json({
      success: true,
      message: "Reply added successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not add reply.",
      error: error.message,
    });
  }
});

app.get("/api/study-circles", async (req, res) => {
  try {
    const pool = getPool();

    const [circles] = await pool.query(
      `SELECT circle_id, name, subject, description, member_count, created_at
       FROM study_circles ORDER BY member_count DESC`
    );

    return res.status(200).json({
      success: true,
      data: circles,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch study circles.",
      error: error.message,
    });
  }
});

app.get("/api/study-circles/:circleId/members", async (req, res) => {
  try {
    const { circleId } = req.params;
    const pool = getPool();

    const [members] = await pool.query(
      `SELECT s.student_id, s.name, s.email, scm.joined_at
       FROM study_circle_members scm
       JOIN students s ON scm.student_id = s.student_id
       WHERE scm.circle_id = ? ORDER BY scm.joined_at DESC`,
      [circleId]
    );

    return res.status(200).json({
      success: true,
      data: members,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch circle members.",
      error: error.message,
    });
  }
});

app.post("/api/study-circles/:circleId/join", async (req, res) => {
  try {
    const { circleId } = req.params;
    const { studentId } = req.body || {};

    if (!studentId) {
      return res.status(422).json({
        success: false,
        message: "Student ID is required.",
      });
    }

    const pool = getPool();

    const [existing] = await pool.query(
      `SELECT * FROM study_circle_members WHERE circle_id = ? AND student_id = ?`,
      [circleId, studentId]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Already a member of this circle.",
      });
    }

    await pool.query(
      `INSERT INTO study_circle_members (circle_id, student_id) VALUES (?, ?)`,
      [circleId, studentId]
    );

    await pool.query(
      `UPDATE study_circles SET member_count = member_count + 1 WHERE circle_id = ?`,
      [circleId]
    );

    return res.status(201).json({
      success: true,
      message: "Joined study circle successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not join circle.",
      error: error.message,
    });
  }
});

async function cleanupSeededDiscussions(pool) {
  const demoTitles = [
    "Physics optics tips for admission mock?",
    "Share your chemistry revision notes",
    "How to manage time in full mocks?",
    "Interview prep checklist",
  ];

  await pool.query(
    `DELETE dr FROM discussion_replies dr
     JOIN discussions d ON dr.discussion_id = d.discussion_id
     WHERE d.title IN (${demoTitles.map(() => "?").join(",")})`,
    demoTitles
  );

  await pool.query(
    `DELETE FROM discussions WHERE title IN (${demoTitles.map(() => "?").join(",")})`,
    demoTitles
  );
}

async function cleanupSeededInstructorWorkspace(pool) {
  const demoCourseTitles = [
    "Motion chapter formula sheet",
    "Live revision class moved to 7:00 PM",
  ];
  const demoMessageTitles = [
    "New assignment uploaded",
    "Biology viva feedback",
  ];
  const demoAlertTitles = [
    "Proctoring violation flagged",
    "Student submitted exam",
    "Exam reminder",
    "New student question",
  ];

  if (demoMessageTitles.length) {
    await pool.query(
      `DELETE FROM instructor_messages WHERE title IN (${demoMessageTitles.map(() => "?").join(",")})`,
      demoMessageTitles
    );
  }

  if (demoAlertTitles.length) {
    await pool.query(
      `DELETE FROM instructor_alerts WHERE title IN (${demoAlertTitles.map(() => "?").join(",")})`,
      demoAlertTitles
    );
  }

  if (demoCourseTitles.length) {
    await pool.query(
      `DELETE FROM instructor_course_items WHERE title IN (${demoCourseTitles.map(() => "?").join(",")})`,
      demoCourseTitles
    );
  }
}

async function startServer() {
  try {
    await ensureDatabaseExists();
    await ensureSchema();
    await seedDemoAccounts();
    await seedDemoContentAndReports();
    await seedDemoStudyCircles();
    await seedDemoExamSchedules();

    const pool = getPool();
    await cleanupSeededDiscussions(pool);
    await cleanupSeededInstructorWorkspace(pool);

    await runExamAutomation();
    startExamAutomationLoop();

    app.listen(PORT, () => {
      console.log(`EduMate backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
