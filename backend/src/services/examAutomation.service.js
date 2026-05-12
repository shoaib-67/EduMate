const { getPool } = require("../db");
const { formatAudienceLabel } = require("../lib/audience");
const { formatSqlDateTime } = require("../lib/examUtils");

const EXAM_REMINDER_WINDOWS = [
  { minutes: 24 * 60, label: "24-hour reminder" },
  { minutes: 60, label: "1-hour reminder" },
];

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
      const message = `${assignment.subject} starts at ${startAt} for ${formatAudienceLabel(
        assignment.audience_type,
        assignment.batch_name
      )}.`;
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

module.exports = {
  EXAM_REMINDER_WINDOWS,
  updateExamStatuses,
  runExamAutomation,
  startExamAutomationLoop,
  findExamConflict,
};

