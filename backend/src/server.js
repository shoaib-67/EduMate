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
  seedDemoDiscussions,
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

function toDateTimeValue(dateInput, timeInput) {
  const date = String(dateInput || "").trim();
  const time = String(timeInput || "").trim();

  if (!date || !time) return null;
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const parsed = new Date(`${date}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatSqlDateTime(date) {
  return new Date(date.getTime() - date.getMilliseconds())
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function deriveExamStatus(startTime, endTime, now = new Date()) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (now < start) return "upcoming";
  if (now <= end) return "ongoing";
  return "completed";
}

function buildJoinExamLink(examId) {
  return `mock-test.html?examId=${encodeURIComponent(examId)}`;
}

function canJoinExam(exam, now = new Date()) {
  const joinWindowMinutes = parsePositiveInteger(exam.join_window_minutes) || 15;
  const start = new Date(exam.start_time);
  const end = new Date(exam.end_time);
  const joinStart = new Date(start.getTime() - joinWindowMinutes * 60000);
  return now >= joinStart && now <= end;
}

function normalizeExamRecord(exam, now = new Date()) {
  const status = deriveExamStatus(exam.start_time, exam.end_time, now);
  return {
    id: exam.exam_id,
    subject: exam.subject,
    examDate: exam.exam_date,
    startTime: exam.start_time,
    endTime: exam.end_time,
    durationMinutes: exam.duration_minutes,
    batchName: exam.batch_name,
    instructions: exam.instructions,
    audienceType: exam.audience_type,
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
    SET status = CASE
      WHEN NOW() < start_time THEN 'upcoming'
      WHEN NOW() BETWEEN start_time AND end_time THEN 'ongoing'
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
        s.student_id,
        s.email,
        s.phone_number
      FROM exam_schedules e
      JOIN students s
        ON (
          (e.audience_type = 'batch' AND e.batch_name IS NOT NULL AND e.batch_name = s.batch_name)
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
      const message = `${assignment.subject} starts at ${startAt} for ${assignment.batch_name || "your schedule"}.`;
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
  const start = new Date(startTime);
  const end = new Date(start.getTime() + Number(durationMinutes || 0) * 60000);
  if (now < start) return "Upcoming";
  if (now <= end) return "Ongoing";
  return "Completed";
}

function normalizeInstructorExamRecord(exam, now = new Date()) {
  return {
    id: exam.instructor_exam_id,
    title: exam.title,
    batch: exam.batch_name,
    date: exam.exam_date,
    time: new Date(exam.start_time).toISOString().slice(11, 16),
    duration: Number(exam.duration_minutes || 0),
    joinWindow: Number(exam.join_window_minutes || 15),
    negativeMarking: exam.negative_marking || "",
    shuffleMode: exam.shuffle_mode || "None",
    examType: exam.exam_type,
    state: exam.publish_state,
    rules: exam.rules || "",
    status: deriveInstructorExamStatus(exam.start_time, exam.duration_minutes, now),
  };
}

async function findInstructorExamConflict(pool, { instructorId, batchName, startTime, durationMinutes }) {
  const endTime = new Date(new Date(startTime).getTime() + Number(durationMinutes || 0) * 60000);
  const [rows] = await pool.query(
    `
    SELECT instructor_exam_id, title, batch_name, exam_date, start_time, duration_minutes, join_window_minutes,
           negative_marking, shuffle_mode, exam_type, publish_state, rules
    FROM instructor_exam_schedules
    WHERE instructor_id = ?
      AND LOWER(batch_name) = LOWER(?)
      AND ? < DATE_ADD(start_time, INTERVAL duration_minutes MINUTE)
      AND ? > start_time
    ORDER BY start_time ASC
    LIMIT 1
    `,
    [instructorId, batchName, startTime, formatSqlDateTime(endTime)]
  );
  return rows[0] || null;
}

async function buildInstructorWorkspace(pool, instructorId) {
  const [courseItems] = await pool.query(
    `
    SELECT item_id, course_title, batch_name, content_type, title, summary, deadline
    FROM instructor_course_items
    WHERE instructor_id = ?
    ORDER BY created_at DESC
    `,
    [instructorId]
  );

  const [questionBank] = await pool.query(
    `
    SELECT question_id, subject, question_type, question_text, options_text, answer_key
    FROM instructor_question_bank
    WHERE instructor_id = ?
    ORDER BY created_at DESC
    `,
    [instructorId]
  );

  const [exams] = await pool.query(
    `
    SELECT instructor_exam_id, title, batch_name, exam_date, start_time, duration_minutes, join_window_minutes,
           negative_marking, shuffle_mode, exam_type, publish_state, rules
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

  const [gradingQueue] = await pool.query(
    `
    SELECT queue_id, exam_title, queue_item, owner_label
    FROM instructor_grading_queue
    WHERE instructor_id = ?
    ORDER BY created_at DESC
    `,
    [instructorId]
  );

  const [exportsList] = await pool.query(
    `
    SELECT export_id, label, format, status
    FROM instructor_export_jobs
    WHERE instructor_id = ?
    ORDER BY created_at DESC
    `,
    [instructorId]
  );

  const [topicPerformance] = await pool.query(
    `
    SELECT topic_id, topic, score, note
    FROM instructor_topic_performance
    WHERE instructor_id = ?
    ORDER BY created_at DESC
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
      batch: item.batch_name,
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
    gradingQueue: gradingQueue.map((item) => ({
      id: item.queue_id,
      exam: item.exam_title,
      item: item.queue_item,
      owner: item.owner_label,
    })),
    exportsList: exportsList.map((item) => ({
      id: item.export_id,
      label: item.label,
      format: item.format,
      status: item.status,
    })),
    topicPerformance: topicPerformance.map((item) => ({
      id: item.topic_id,
      topic: item.topic,
      score: Number(item.score || 0),
      note: item.note,
    })),
    scoreDistribution,
  };
}

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  return sendSuccess(res, { message: "EduMate API is running" });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body || {};

    const cleanFullName = String(fullName || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").trim();
    const cleanPassword = String(password || "");

    if (!cleanFullName || !cleanEmail || !cleanPhone || !cleanPassword) {
      return sendError(res, { status: 422, message: "All fields are required." });
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
      return sendError(res, { status: 409, message: "An account with this email or phone already exists." });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);

    await pool.query(
      "INSERT INTO students (name, email, phone_number, password_hash) VALUES (?, ?, ?, ?)",
      [cleanFullName, cleanEmail, cleanPhone, passwordHash]
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
      `SELECT * FROM ${table} WHERE (email = ? OR phone_number = ?) LIMIT 1`,
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
        id: account[idColumn] || account.id,
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
      .map((user) => ({
        ...user,
        status: formatAccountStatus(user.accountStatus),
      }))
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
      "SELECT submission_id as id, title, type, status, created_at FROM content_submissions ORDER BY created_at DESC"
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
      "SELECT title, type FROM content_submissions WHERE submission_id = ? LIMIT 1",
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
      "SELECT title, type FROM content_submissions WHERE submission_id = ? LIMIT 1",
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
    const batch = String(req.body?.batch || "").trim();
    const type = String(req.body?.type || "").trim();
    const title = String(req.body?.title || "").trim();
    const summary = String(req.body?.summary || "").trim();
    const deadline = String(req.body?.deadline || "").trim();

    if (!instructorId || !course || !batch || !type || !title || !summary) {
      return sendError(res, { status: 422, message: "Course, batch, type, title, and summary are required." });
    }

    const pool = getPool();
    await pool.query(
      `
      INSERT INTO instructor_course_items (instructor_id, course_title, batch_name, content_type, title, summary, deadline)
      VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''))
      `,
      [instructorId, course, batch, type, title, summary, deadline]
    );

    await pool.query(
      `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'New study material uploaded', ?)`,
      [instructorId, `${title} was added for ${batch}.`]
    );

    return sendSuccess(res, { status: 201, message: "Course content saved." });
  } catch (error) {
    return sendError(res, { message: "Could not save course content.", error: error.message });
  }
});

app.post("/api/instructor/:instructorId/question-bank", async (req, res) => {
  try {
    const instructorId = parseRequiredId(req.params.instructorId);
    const subject = String(req.body?.subject || "").trim();
    const type = String(req.body?.type || "").trim();
    const text = String(req.body?.text || "").trim();
    const options = String(req.body?.options || "").trim();
    const answerKey = String(req.body?.answerKey || "").trim();

    if (!instructorId || !subject || !type || !text || !options || !answerKey) {
      return sendError(res, { status: 422, message: "Subject, type, text, options, and answer key are required." });
    }

    const pool = getPool();
    await pool.query(
      `
      INSERT INTO instructor_question_bank (instructor_id, subject, question_type, question_text, options_text, answer_key)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [instructorId, subject, type, text, options, answerKey]
    );

    return sendSuccess(res, { status: 201, message: "Question added to bank." });
  } catch (error) {
    return sendError(res, { message: "Could not add question.", error: error.message });
  }
});

app.post("/api/instructor/:instructorId/exams", async (req, res) => {
  try {
    const instructorId = parseRequiredId(req.params.instructorId);
    const title = String(req.body?.title || "").trim();
    const batch = String(req.body?.batch || "").trim();
    const date = String(req.body?.date || "").trim();
    const time = String(req.body?.time || "").trim();
    const duration = parsePositiveInteger(req.body?.duration);
    const joinWindow = parsePositiveInteger(req.body?.joinWindow) || 15;
    const negativeMarking = String(req.body?.negativeMarking || "").trim();
    const shuffleMode = String(req.body?.shuffleMode || "").trim();
    const examType = String(req.body?.examType || "").trim();
    const state = String(req.body?.state || "Draft").trim();
    const rules = String(req.body?.rules || "").trim();
    const startDate = toDateTimeValue(date, time);

    if (!instructorId || !title || !batch || !date || !time || !duration || !examType) {
      return sendError(res, { status: 422, message: "Title, batch, date, time, duration, and exam type are required." });
    }
    if (!startDate) return sendError(res, { status: 422, message: "Invalid exam date or time." });

    const pool = getPool();
    const startTime = formatSqlDateTime(startDate);
    const conflict = await findInstructorExamConflict(pool, {
      instructorId,
      batchName: batch,
      startTime,
      durationMinutes: duration,
    });
    if (conflict) {
      return sendError(res, {
        status: 409,
        message: "Schedule conflict detected for this batch.",
        conflict: normalizeInstructorExamRecord(conflict),
      });
    }

    await pool.query(
      `
      INSERT INTO instructor_exam_schedules
        (instructor_id, title, batch_name, exam_date, start_time, duration_minutes, join_window_minutes, negative_marking, shuffle_mode, exam_type, publish_state, rules)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [instructorId, title, batch, date, startTime, duration, joinWindow, negativeMarking || null, shuffleMode || null, examType, state, rules || null]
    );

    await pool.query(
      `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, 'info', 'New exam scheduled', ?)`,
      [instructorId, `${title} scheduled for ${batch} on ${date} ${time}.`]
    );

    return sendSuccess(res, { status: 201, message: "Exam created successfully." });
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
    const [rows] = await pool.query(
      `
      SELECT DISTINCT
        e.*,
        COUNT(DISTINCT ea2.student_id) AS assigned_student_count
      FROM exam_schedules e
      LEFT JOIN exam_assignments ea ON ea.exam_id = e.exam_id
      LEFT JOIN exam_assignments ea2 ON ea2.exam_id = e.exam_id
      WHERE (e.audience_type = 'batch' AND e.batch_name = ?)
         OR (ea.student_id = ?)
      GROUP BY e.exam_id
      ORDER BY e.start_time ASC
      `,
      [student.batch_name || "", studentId]
    );

    const now = new Date();
    const exams = rows.map((row) => normalizeExamRecord(row, now));
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

async function startServer() {
  try {
    await ensureDatabaseExists();
    await ensureSchema();
    await seedDemoAccounts();
    await seedDemoContentAndReports();
    await seedDemoDiscussions();
    await seedDemoStudyCircles();
    await seedDemoExamSchedules();
    await seedDemoInstructorWorkspace();
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
