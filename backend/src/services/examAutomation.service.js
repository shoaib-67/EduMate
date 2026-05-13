const { getPool } = require("../db");

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

async function runExamAutomation() {
  const pool = getPool();
  await updateExamStatuses(pool);
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
  updateExamStatuses,
  runExamAutomation,
  startExamAutomationLoop,
  findExamConflict,
};

