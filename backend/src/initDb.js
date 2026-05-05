const bcrypt = require("bcryptjs");
const { getPool } = require("./db");

const roleTableConfig = [
  { tableName: "students", idColumn: "student_id" },
  { tableName: "instructors", idColumn: "instructor_id" },
  { tableName: "admins", idColumn: "admin_id" },
];

async function columnExists(pool, tableName, columnName) {
  const [rows] = await pool.query(
    `
    SELECT COUNT(*) AS count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND column_name = ?
    `,
    [tableName, columnName]
  );

  return Number(rows[0]?.count || 0) > 0;
}

async function indexExists(pool, tableName, indexName) {
  const [rows] = await pool.query(
    `
    SELECT COUNT(*) AS count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = ?
      AND index_name = ?
    `,
    [tableName, indexName]
  );

  return Number(rows[0]?.count || 0) > 0;
}

async function ensureColumn(pool, tableName, columnName, columnDefinition) {
  const exists = await columnExists(pool, tableName, columnName);
  if (exists) return;

  await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnDefinition}`);
}

async function ensureUniqueIndex(pool, tableName, indexName, columnName) {
  const exists = await indexExists(pool, tableName, indexName);
  if (exists) return;

  await pool.query(
    `ALTER TABLE \`${tableName}\` ADD UNIQUE INDEX \`${indexName}\` (\`${columnName}\`)`
  );
}

async function ensureRoleTable(pool, tableName, idColumn) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`${tableName}\` (
      \`${idColumn}\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(120) NOT NULL UNIQUE,
      phone_number VARCHAR(25) UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      account_status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumn(pool, tableName, "name", "name VARCHAR(100) NOT NULL DEFAULT ''");
  await ensureColumn(pool, tableName, "email", "email VARCHAR(120) NOT NULL DEFAULT ''");
  await ensureColumn(pool, tableName, "phone_number", "phone_number VARCHAR(25) NULL");
  await ensureColumn(
    pool,
    tableName,
    "password_hash",
    "password_hash VARCHAR(255) NOT NULL DEFAULT ''"
  );
  await ensureColumn(
    pool,
    tableName,
    "account_status",
    "account_status VARCHAR(20) NOT NULL DEFAULT 'active'"
  );
  await ensureColumn(
    pool,
    tableName,
    "created_at",
    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
  );

  await ensureUniqueIndex(pool, tableName, `${tableName}_email_unique`, "email");
  await ensureUniqueIndex(pool, tableName, `${tableName}_phone_unique`, "phone_number");
}

async function ensureContentSubmissionsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`content_submissions\` (
      \`submission_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED,
      \`course_title\` VARCHAR(150),
      \`batch_name\` VARCHAR(80),
      \`title\` VARCHAR(255) NOT NULL,
      \`type\` VARCHAR(50) NOT NULL,
      \`description\` TEXT,
      \`deadline\` DATE NULL,
      \`status\` VARCHAR(50) DEFAULT 'pending',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumn(pool, "content_submissions", "course_title", "course_title VARCHAR(150) NULL");
  await ensureColumn(pool, "content_submissions", "batch_name", "batch_name VARCHAR(80) NULL");
  await ensureColumn(pool, "content_submissions", "deadline", "deadline DATE NULL");
}

async function ensureReportsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`reports\` (
      \`report_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`title\` VARCHAR(255) NOT NULL,
      \`description\` TEXT,
      \`category\` VARCHAR(50) NOT NULL DEFAULT 'bug',
      \`reporter_name\` VARCHAR(100),
      \`reporter_email\` VARCHAR(120),
      \`status\` VARCHAR(50) DEFAULT 'open',
      \`priority\` VARCHAR(50) DEFAULT 'normal',
      \`value\` VARCHAR(100),
      \`admin_note\` TEXT,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumn(pool, "reports", "category", "category VARCHAR(50) NOT NULL DEFAULT 'bug'");
  await ensureColumn(pool, "reports", "reporter_name", "reporter_name VARCHAR(100) NULL");
  await ensureColumn(pool, "reports", "reporter_email", "reporter_email VARCHAR(120) NULL");
  await ensureColumn(pool, "reports", "admin_note", "admin_note TEXT NULL");
}

async function ensureAdminActivityLogsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`admin_activity_logs\` (
      \`log_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`action\` VARCHAR(80) NOT NULL,
      \`target_type\` VARCHAR(50) NOT NULL,
      \`target_id\` INT UNSIGNED,
      \`target_label\` VARCHAR(255),
      \`details\` TEXT,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX \`idx_created\` (\`created_at\`),
      INDEX \`idx_target\` (\`target_type\`, \`target_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureStudentPerformanceTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`student_performance\` (
      \`performance_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`student_id\` INT UNSIGNED NOT NULL,
      \`subject\` VARCHAR(100) NOT NULL,
      \`test_type\` VARCHAR(50) NOT NULL DEFAULT 'mock',
      \`score\` DECIMAL(5, 2) NOT NULL,
      \`total_questions\` INT,
      \`correct_answers\` INT,
      \`test_name\` VARCHAR(255),
      \`rank\` INT,
      \`total_participants\` INT,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`student_id\`) REFERENCES \`students\`(\`student_id\`) ON DELETE CASCADE,
      INDEX \`idx_student_created\` (\`student_id\`, \`created_at\`),
      INDEX \`idx_subject\` (\`subject\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureDiscussionsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`discussions\` (
      \`discussion_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`student_id\` INT UNSIGNED NOT NULL,
      \`title\` VARCHAR(255) NOT NULL,
      \`content\` TEXT NOT NULL,
      \`subject\` VARCHAR(100),
      \`tag\` VARCHAR(50) DEFAULT 'general',
      \`reply_count\` INT DEFAULT 0,
      \`is_pinned\` BOOLEAN DEFAULT FALSE,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (\`student_id\`) REFERENCES \`students\`(\`student_id\`) ON DELETE CASCADE,
      INDEX \`idx_created\` (\`created_at\`),
      INDEX \`idx_subject\` (\`subject\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureDiscussionRepliesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`discussion_replies\` (
      \`reply_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`discussion_id\` INT UNSIGNED NOT NULL,
      \`student_id\` INT UNSIGNED NOT NULL,
      \`content\` TEXT NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`discussion_id\`) REFERENCES \`discussions\`(\`discussion_id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`student_id\`) REFERENCES \`students\`(\`student_id\`) ON DELETE CASCADE,
      INDEX \`idx_discussion\` (\`discussion_id\`),
      INDEX \`idx_created\` (\`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureStudyCirclesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`study_circles\` (
      \`circle_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`name\` VARCHAR(100) NOT NULL UNIQUE,
      \`subject\` VARCHAR(100) NOT NULL,
      \`description\` TEXT,
      \`member_count\` INT DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX \`idx_subject\` (\`subject\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureStudyCircleMembersTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`study_circle_members\` (
      \`member_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`circle_id\` INT UNSIGNED NOT NULL,
      \`student_id\` INT UNSIGNED NOT NULL,
      \`joined_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`circle_id\`) REFERENCES \`study_circles\`(\`circle_id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`student_id\`) REFERENCES \`students\`(\`student_id\`) ON DELETE CASCADE,
      UNIQUE KEY \`unique_member\` (\`circle_id\`, \`student_id\`),
      INDEX \`idx_student\` (\`student_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureStudentProfileColumns(pool) {
  await ensureColumn(
    pool,
    "students",
    "batch_name",
    "batch_name VARCHAR(80) NULL"
  );
  await ensureColumn(
    pool,
    "students",
    "course_track",
    "course_track VARCHAR(80) NULL"
  );
}

async function ensureExamSchedulesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`exam_schedules\` (
      \`exam_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`subject\` VARCHAR(120) NOT NULL,
      \`exam_date\` DATE NOT NULL,
      \`start_time\` DATETIME NOT NULL,
      \`end_time\` DATETIME NOT NULL,
      \`duration_minutes\` INT UNSIGNED NOT NULL,
      \`batch_name\` VARCHAR(80),
      \`instructions\` TEXT,
      \`audience_type\` VARCHAR(20) NOT NULL DEFAULT 'batch',
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'upcoming',
      \`join_window_minutes\` INT UNSIGNED NOT NULL DEFAULT 15,
      \`created_by_admin_id\` INT UNSIGNED,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX \`idx_exam_batch_time\` (\`batch_name\`, \`start_time\`, \`end_time\`),
      INDEX \`idx_exam_status\` (\`status\`),
      FOREIGN KEY (\`created_by_admin_id\`) REFERENCES \`admins\`(\`admin_id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureExamAssignmentsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`exam_assignments\` (
      \`assignment_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`exam_id\` INT UNSIGNED NOT NULL,
      \`student_id\` INT UNSIGNED NOT NULL,
      \`assigned_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY \`unique_exam_student\` (\`exam_id\`, \`student_id\`),
      INDEX \`idx_student_exam\` (\`student_id\`, \`exam_id\`),
      FOREIGN KEY (\`exam_id\`) REFERENCES \`exam_schedules\`(\`exam_id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`student_id\`) REFERENCES \`students\`(\`student_id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureNotificationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`notifications\` (
      \`notification_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`student_id\` INT UNSIGNED NOT NULL,
      \`exam_id\` INT UNSIGNED NULL,
      \`channel\` VARCHAR(20) NOT NULL DEFAULT 'in_app',
      \`type\` VARCHAR(40) NOT NULL DEFAULT 'exam_reminder',
      \`title\` VARCHAR(160) NOT NULL,
      \`message\` TEXT NOT NULL,
      \`status\` VARCHAR(20) NOT NULL DEFAULT 'unread',
      \`scheduled_for\` DATETIME NULL,
      \`sent_at\` DATETIME NULL,
      \`read_at\` DATETIME NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX \`idx_student_status\` (\`student_id\`, \`status\`),
      INDEX \`idx_scheduled\` (\`scheduled_for\`, \`status\`),
      UNIQUE KEY \`unique_exam_channel_notice\` (\`student_id\`, \`exam_id\`, \`channel\`, \`title\`),
      FOREIGN KEY (\`student_id\`) REFERENCES \`students\`(\`student_id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`exam_id\`) REFERENCES \`exam_schedules\`(\`exam_id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorCourseItemsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_course_items\` (
      \`item_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`course_title\` VARCHAR(150) NOT NULL,
      \`batch_name\` VARCHAR(80) NOT NULL,
      \`content_type\` VARCHAR(60) NOT NULL,
      \`title\` VARCHAR(255) NOT NULL,
      \`summary\` TEXT,
      \`deadline\` DATE NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_course_items\` (\`instructor_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorQuestionBankTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_question_bank\` (
      \`question_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`subject\` VARCHAR(120) NOT NULL,
      \`question_type\` VARCHAR(40) NOT NULL,
      \`question_text\` TEXT NOT NULL,
      \`options_text\` TEXT,
      \`answer_key\` TEXT,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_question_bank\` (\`instructor_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorExamSchedulesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_exam_schedules\` (
      \`instructor_exam_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`title\` VARCHAR(180) NOT NULL,
      \`batch_name\` VARCHAR(80) NOT NULL,
      \`exam_date\` DATE NOT NULL,
      \`start_time\` DATETIME NOT NULL,
      \`duration_minutes\` INT UNSIGNED NOT NULL,
      \`join_window_minutes\` INT UNSIGNED NOT NULL DEFAULT 15,
      \`negative_marking\` VARCHAR(60),
      \`shuffle_mode\` VARCHAR(80),
      \`exam_type\` VARCHAR(60) NOT NULL,
      \`publish_state\` VARCHAR(30) NOT NULL DEFAULT 'Draft',
      \`rules\` TEXT,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_exam_schedule\` (\`instructor_id\`, \`batch_name\`, \`start_time\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorStudentAssignmentsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_student_assignments\` (
      \`assignment_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`student_id\` INT UNSIGNED NOT NULL,
      \`assigned_batch\` VARCHAR(80) NOT NULL,
      \`is_active\` BOOLEAN NOT NULL DEFAULT TRUE,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`unique_instructor_student\` (\`instructor_id\`, \`student_id\`),
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`student_id\`) REFERENCES \`students\`(\`student_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_batch\` (\`instructor_id\`, \`assigned_batch\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorStudentNotesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_student_notes\` (
      \`note_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`student_id\` INT UNSIGNED NOT NULL,
      \`progress_label\` VARCHAR(120),
      \`note\` TEXT,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`unique_instructor_student_note\` (\`instructor_id\`, \`student_id\`),
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`student_id\`) REFERENCES \`students\`(\`student_id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorMessagesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_messages\` (
      \`message_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`message_type\` VARCHAR(50) NOT NULL,
      \`audience\` VARCHAR(150) NOT NULL,
      \`title\` VARCHAR(255) NOT NULL,
      \`body\` TEXT NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_messages\` (\`instructor_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorAlertsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_alerts\` (
      \`alert_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`level\` VARCHAR(20) NOT NULL DEFAULT 'info',
      \`title\` VARCHAR(255) NOT NULL,
      \`note\` TEXT NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_alerts\` (\`instructor_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorGradingQueueTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_grading_queue\` (
      \`queue_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`exam_title\` VARCHAR(180) NOT NULL,
      \`queue_item\` VARCHAR(255) NOT NULL,
      \`owner_label\` VARCHAR(120),
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_grading_queue\` (\`instructor_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorExportJobsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_export_jobs\` (
      \`export_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`label\` VARCHAR(180) NOT NULL,
      \`format\` VARCHAR(20) NOT NULL,
      \`status\` VARCHAR(40) NOT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_exports\` (\`instructor_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureInstructorTopicPerformanceTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`instructor_topic_performance\` (
      \`topic_id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`instructor_id\` INT UNSIGNED NOT NULL,
      \`topic\` VARCHAR(150) NOT NULL,
      \`score\` DECIMAL(5,2) NOT NULL DEFAULT 0,
      \`note\` TEXT,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE CASCADE,
      INDEX \`idx_instructor_topic_performance\` (\`instructor_id\`, \`created_at\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureSchema() {
  const pool = getPool();

  for (const config of roleTableConfig) {
    await ensureRoleTable(pool, config.tableName, config.idColumn);
  }

  await ensureStudentProfileColumns(pool);
  await ensureContentSubmissionsTable(pool);
  await ensureReportsTable(pool);
  await ensureAdminActivityLogsTable(pool);
  await ensureStudentPerformanceTable(pool);
  await ensureDiscussionsTable(pool);
  await ensureDiscussionRepliesTable(pool);
  await ensureStudyCirclesTable(pool);
  await ensureStudyCircleMembersTable(pool);
  await ensureExamSchedulesTable(pool);
  await ensureExamAssignmentsTable(pool);
  await ensureNotificationsTable(pool);
  await ensureInstructorCourseItemsTable(pool);
  await ensureInstructorQuestionBankTable(pool);
  await ensureInstructorExamSchedulesTable(pool);
  await ensureInstructorStudentAssignmentsTable(pool);
  await ensureInstructorStudentNotesTable(pool);
  await ensureInstructorMessagesTable(pool);
  await ensureInstructorAlertsTable(pool);
  await ensureInstructorGradingQueueTable(pool);
  await ensureInstructorExportJobsTable(pool);
  await ensureInstructorTopicPerformanceTable(pool);
}

async function seedDemoAccounts() {
  const pool = getPool();

  const demoAccounts = [
    {
      tableName: "students",
      name: "Demo Student",
      email: "demo@edumate.com",
      phoneNumber: "+8801000000000",
      password: "EduMate@123",
    },
    {
      tableName: "instructors",
      name: "Demo Instructor",
      email: "instructor@edumate.com",
      phoneNumber: null,
      password: "EduMate@123",
    },
    {
      tableName: "admins",
      name: "Demo Admin",
      email: "admin@edumate.com",
      phoneNumber: null,
      password: "Admin@123",
    },
  ];

  for (const account of demoAccounts) {
    const passwordHash = await bcrypt.hash(account.password, 10);

    if (account.tableName === "students") {
      await pool.query(
        `
        INSERT INTO \`students\` (name, email, phone_number, password_hash, batch_name, course_track)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          password_hash = VALUES(password_hash),
          batch_name = VALUES(batch_name),
          course_track = VALUES(course_track)
        `,
        [
          account.name,
          account.email,
          account.phoneNumber,
          passwordHash,
          "Engineering A",
          "Engineering",
        ]
      );
    } else {
      await pool.query(
        `
        INSERT INTO \`${account.tableName}\` (name, email, phone_number, password_hash)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          password_hash = VALUES(password_hash)
        `,
        [account.name, account.email, account.phoneNumber, passwordHash]
      );
    }
  }
}

async function seedDemoExamSchedules() {
  const pool = getPool();

  const [students] = await pool.query(
    `SELECT student_id, batch_name FROM students ORDER BY student_id ASC LIMIT 3`
  );

  if (students.length === 0) return;

  const primaryStudent = students[0];
  const now = new Date();

  const createExamDate = (dayOffset, hour, minute, durationMinutes) => {
    const start = new Date(now);
    start.setSeconds(0, 0);
    start.setDate(start.getDate() + dayOffset);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    return {
      examDate: start.toISOString().slice(0, 10),
      startTime: start.toISOString().slice(0, 19).replace("T", " "),
      endTime: end.toISOString().slice(0, 19).replace("T", " "),
    };
  };

  const createRelativeExamDate = (minutesFromNow, durationMinutes) => {
    const start = new Date(now.getTime() + minutesFromNow * 60000);
    start.setSeconds(0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    return {
      examDate: start.toISOString().slice(0, 10),
      startTime: start.toISOString().slice(0, 19).replace("T", " "),
      endTime: end.toISOString().slice(0, 19).replace("T", " "),
    };
  };

  const physics = createExamDate(1, 9, 0, 90);
  const chemistry = createRelativeExamDate(12, 60);
  const biology = createExamDate(-1, 18, 0, 45);

  const exams = [
    {
      subject: "Physics Mock",
      ...physics,
      duration: 90,
      batchName: primaryStudent.batch_name || "Engineering A",
      instructions: "Join 15 minutes early with calculator and rough sheet.",
      audienceType: "batch",
      studentIds: [],
    },
    {
      subject: "Chemistry Drill",
      ...chemistry,
      duration: 60,
      batchName: primaryStudent.batch_name || "Engineering A",
      instructions: "Focus on reaction balancing and organic MCQ speed.",
      audienceType: "specific",
      studentIds: [primaryStudent.student_id],
    },
    {
      subject: "Biology Viva",
      ...biology,
      duration: 45,
      batchName: "Medical A",
      instructions: "Completed sample oral assessment for revision.",
      audienceType: "specific",
      studentIds: [primaryStudent.student_id],
    },
  ];

  for (const exam of exams) {
    const [existing] = await pool.query(
      `SELECT exam_id FROM exam_schedules WHERE subject = ? AND start_time = ? LIMIT 1`,
      [exam.subject, exam.startTime]
    );

    let examId = existing[0]?.exam_id;

    if (examId) {
      await pool.query(
        `
        UPDATE exam_schedules
        SET exam_date = ?, end_time = ?, duration_minutes = ?, batch_name = ?,
            instructions = ?, audience_type = ?
        WHERE exam_id = ?
        `,
        [
          exam.examDate,
          exam.endTime,
          exam.duration,
          exam.batchName,
          exam.instructions,
          exam.audienceType,
          examId,
        ]
      );
    } else {
      const [result] = await pool.query(
        `
        INSERT INTO exam_schedules
          (subject, exam_date, start_time, end_time, duration_minutes, batch_name, instructions, audience_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          exam.subject,
          exam.examDate,
          exam.startTime,
          exam.endTime,
          exam.duration,
          exam.batchName,
          exam.instructions,
          exam.audienceType,
        ]
      );
      examId = result.insertId;
    }

    if (exam.audienceType === "specific" && exam.studentIds.length > 0) {
      for (const studentId of exam.studentIds) {
        await pool.query(
          `
          INSERT IGNORE INTO exam_assignments (exam_id, student_id)
          VALUES (?, ?)
          `,
          [examId, studentId]
        );
      }
    }
  }
}

async function seedDemoInstructorWorkspace() {
  const pool = getPool();
  const demoStudentPassword = await bcrypt.hash("EduMate@123", 10);
  const demoStudents = [
    { name: "Farzana Islam", email: "farzana@edumate.com", phone: "+8801000000001", batch: "Engineering A", track: "Engineering" },
    { name: "Nabil Hossain", email: "nabil@edumate.com", phone: "+8801000000002", batch: "Engineering A", track: "Engineering" },
    { name: "Sadia Rahman", email: "sadia@edumate.com", phone: "+8801000000003", batch: "Medical+Versity", track: "Medical+Versity" },
    { name: "Tanvir Alam", email: "tanvir@edumate.com", phone: "+8801000000004", batch: "Medical+Versity", track: "Medical+Versity" },
  ];

  for (const student of demoStudents) {
    await pool.query(
      `
      INSERT INTO students (name, email, phone_number, password_hash, batch_name, course_track)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        password_hash = VALUES(password_hash),
        batch_name = VALUES(batch_name),
        course_track = VALUES(course_track)
      `,
      [student.name, student.email, student.phone, demoStudentPassword, student.batch, student.track]
    );
  }

  const [instructorRows] = await pool.query(
    `SELECT instructor_id, name FROM instructors WHERE email = 'instructor@edumate.com' LIMIT 1`
  );
  if (!instructorRows.length) return;
  const instructorId = instructorRows[0].instructor_id;

  const [studentRows] = await pool.query(
    `SELECT student_id, name, batch_name FROM students WHERE email IN (?, ?, ?, ?) ORDER BY student_id ASC`,
    demoStudents.map((student) => student.email)
  );

  for (const student of studentRows) {
    await pool.query(
      `
      INSERT INTO instructor_student_assignments (instructor_id, student_id, assigned_batch, is_active)
      VALUES (?, ?, ?, TRUE)
      ON DUPLICATE KEY UPDATE
        assigned_batch = VALUES(assigned_batch),
        is_active = TRUE
      `,
      [instructorId, student.student_id, student.batch_name]
    );
  }

  const courseItems = [
    ["Engineering Physics", "Engineering A", "PDF", "Motion chapter formula sheet", "Core equations, solved examples, and quick revision table.", "2026-05-10"],
    ["Organic Chemistry", "Medical+Versity", "Announcement", "Live revision class moved to 7:00 PM", "Topic focus: reaction mechanisms and naming shortcuts.", null],
  ];
  for (const item of courseItems) {
    const [existing] = await pool.query(
      `SELECT item_id FROM instructor_course_items WHERE instructor_id = ? AND title = ? AND batch_name = ? LIMIT 1`,
      [instructorId, item[3], item[1]]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE instructor_course_items SET course_title = ?, content_type = ?, summary = ?, deadline = ? WHERE item_id = ?`,
        [item[0], item[2], item[4], item[5], existing[0].item_id]
      );
    } else {
      await pool.query(
        `
        INSERT INTO instructor_course_items (instructor_id, course_title, batch_name, content_type, title, summary, deadline)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [instructorId, ...item]
      );
    }
  }

  const questionItems = [
    ["Physics", "MCQ", "A body starts from rest and accelerates uniformly. Which graph becomes linear?", "A) v-t | B) s-t^2 | C) a-v | D) s-v", "A"],
    ["Biology", "Essay", "Explain the role of mitochondria in aerobic respiration.", "Long answer prompt", "ATP production, Krebs cycle linkage, membrane role"],
  ];
  for (const item of questionItems) {
    const [existing] = await pool.query(
      `SELECT question_id FROM instructor_question_bank WHERE instructor_id = ? AND question_text = ? LIMIT 1`,
      [instructorId, item[2]]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE instructor_question_bank SET subject = ?, question_type = ?, options_text = ?, answer_key = ? WHERE question_id = ?`,
        [item[0], item[1], item[3], item[4], existing[0].question_id]
      );
    } else {
      await pool.query(
        `
        INSERT INTO instructor_question_bank (instructor_id, subject, question_type, question_text, options_text, answer_key)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [instructorId, ...item]
      );
    }
  }

  const examItems = [
    ["Physics Weekly Mock 3", "Engineering A", "2026-05-06", "2026-05-06 09:00:00", 90, 15, "-0.25 per MCQ", "Questions and options", "Mock Test", "Published", "Calculator allowed. No retake after submission."],
    ["Medical Biology Short Test", "Medical+Versity", "2026-05-06", "2026-05-06 10:00:00", 60, 10, "None", "Questions only", "Batch Exam", "Draft", "Short-answer review needed before final publish."],
    ["Engineering Math Speed Quiz", "Engineering A", "2026-05-04", "2026-05-04 18:30:00", 45, 10, "-0.25 per MCQ", "Questions only", "Assignment Quiz", "Published", "Fast drill for algebra and trigonometry."],
  ];
  for (const item of examItems) {
    const [existing] = await pool.query(
      `SELECT instructor_exam_id FROM instructor_exam_schedules WHERE instructor_id = ? AND title = ? AND batch_name = ? LIMIT 1`,
      [instructorId, item[0], item[1]]
    );
    if (existing.length > 0) {
      await pool.query(
        `
        UPDATE instructor_exam_schedules
        SET exam_date = ?, start_time = ?, duration_minutes = ?, join_window_minutes = ?, negative_marking = ?,
            shuffle_mode = ?, exam_type = ?, publish_state = ?, rules = ?
        WHERE instructor_exam_id = ?
        `,
        [item[2], item[3], item[4], item[5], item[6], item[7], item[8], item[9], item[10], existing[0].instructor_exam_id]
      );
    } else {
      await pool.query(
        `
        INSERT INTO instructor_exam_schedules
          (instructor_id, title, batch_name, exam_date, start_time, duration_minutes, join_window_minutes, negative_marking, shuffle_mode, exam_type, publish_state, rules)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [instructorId, ...item]
      );
    }
  }

  const studentMeta = {
    "Farzana Islam": ["72% complete", "Needs more chemistry review"],
    "Nabil Hossain": ["58% complete", "Often late to mock exams"],
    "Sadia Rahman": ["84% complete", "Strong in biology essays"],
    "Tanvir Alam": ["63% complete", "Manual grading pending for short answers"],
  };
  for (const student of studentRows) {
    const [progressLabel, note] = studentMeta[student.name] || ["Pending update", "No note yet"];
    await pool.query(
      `
      INSERT INTO instructor_student_notes (instructor_id, student_id, progress_label, note)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        progress_label = VALUES(progress_label),
        note = VALUES(note)
      `,
      [instructorId, student.student_id, progressLabel, note]
    );
  }

  const messages = [
    ["Announcement", "Engineering A", "New assignment uploaded", "Solve the motion chapter worksheet before Friday night."],
    ["Exam Feedback", "Sadia Rahman", "Biology viva feedback", "Excellent structure. Add clearer examples in the final answer."],
  ];
  for (const message of messages) {
    const [existing] = await pool.query(
      `SELECT message_id FROM instructor_messages WHERE instructor_id = ? AND title = ? AND audience = ? LIMIT 1`,
      [instructorId, message[2], message[1]]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE instructor_messages SET message_type = ?, body = ? WHERE message_id = ?`,
        [message[0], message[3], existing[0].message_id]
      );
    } else {
      await pool.query(
        `INSERT INTO instructor_messages (instructor_id, message_type, audience, title, body) VALUES (?, ?, ?, ?, ?)`,
        [instructorId, ...message]
      );
    }
  }

  const alerts = [
    ["urgent", "Proctoring violation flagged", "Engineering Math Speed Quiz - tab switch detected for Nabil Hossain."],
    ["info", "Student submitted exam", "Farzana Islam submitted Physics Weekly Mock 3."],
    ["info", "Exam reminder", "Physics Weekly Mock 3 starts in 30 minutes."],
    ["info", "New student question", "Sadia Rahman asked about essay grading rubric."],
  ];
  for (const alert of alerts) {
    const [existing] = await pool.query(
      `SELECT alert_id FROM instructor_alerts WHERE instructor_id = ? AND title = ? LIMIT 1`,
      [instructorId, alert[1]]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE instructor_alerts SET level = ?, note = ? WHERE alert_id = ?`,
        [alert[0], alert[2], existing[0].alert_id]
      );
    } else {
      await pool.query(
        `INSERT INTO instructor_alerts (instructor_id, level, title, note) VALUES (?, ?, ?, ?)`,
        [instructorId, ...alert]
      );
    }
  }

  const gradingQueue = [
    ["Medical Biology Short Test", "4 short answers pending", "Medical+Versity"],
    ["Engineering Physics Assignment", "12 manual comments pending", "Engineering A"],
  ];
  for (const queueItem of gradingQueue) {
    const [existing] = await pool.query(
      `SELECT queue_id FROM instructor_grading_queue WHERE instructor_id = ? AND exam_title = ? LIMIT 1`,
      [instructorId, queueItem[0]]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE instructor_grading_queue SET queue_item = ?, owner_label = ? WHERE queue_id = ?`,
        [queueItem[1], queueItem[2], existing[0].queue_id]
      );
    } else {
      await pool.query(
        `INSERT INTO instructor_grading_queue (instructor_id, exam_title, queue_item, owner_label) VALUES (?, ?, ?, ?)`,
        [instructorId, ...queueItem]
      );
    }
  }

  const exportJobs = [
    ["Batch A result sheet", "CSV", "Ready"],
    ["Biology essay review pack", "PDF", "Needs grading"],
  ];
  for (const exportJob of exportJobs) {
    const [existing] = await pool.query(
      `SELECT export_id FROM instructor_export_jobs WHERE instructor_id = ? AND label = ? LIMIT 1`,
      [instructorId, exportJob[0]]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE instructor_export_jobs SET format = ?, status = ? WHERE export_id = ?`,
        [exportJob[1], exportJob[2], existing[0].export_id]
      );
    } else {
      await pool.query(
        `INSERT INTO instructor_export_jobs (instructor_id, label, format, status) VALUES (?, ?, ?, ?)`,
        [instructorId, ...exportJob]
      );
    }
  }

  const topicItems = [
    ["Kinematics", 82, "Strong pace and formula recall"],
    ["Organic Naming", 69, "More drills needed"],
    ["Cell Respiration", 76, "Good concept clarity"],
  ];
  for (const topicItem of topicItems) {
    const [existing] = await pool.query(
      `SELECT topic_id FROM instructor_topic_performance WHERE instructor_id = ? AND topic = ? LIMIT 1`,
      [instructorId, topicItem[0]]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE instructor_topic_performance SET score = ?, note = ? WHERE topic_id = ?`,
        [topicItem[1], topicItem[2], existing[0].topic_id]
      );
    } else {
      await pool.query(
        `INSERT INTO instructor_topic_performance (instructor_id, topic, score, note) VALUES (?, ?, ?, ?)`,
        [instructorId, ...topicItem]
      );
    }
  }

  const performanceRows = [
    ["Farzana Islam", "Physics", "mock", 81, 50, 41, "Physics Weekly Mock 3", 14, 120],
    ["Nabil Hossain", "Math", "mock", 67, 40, 27, "Engineering Math Speed Quiz", 29, 120],
    ["Sadia Rahman", "Biology", "mock", 88, 45, 40, "Medical Biology Short Test", 8, 95],
    ["Tanvir Alam", "Chemistry", "mock", 74, 40, 30, "Organic Chemistry Drill", 19, 95],
  ];
  const studentIdByName = Object.fromEntries(studentRows.map((row) => [row.name, row.student_id]));
  for (const performance of performanceRows) {
    const studentId = studentIdByName[performance[0]];
    if (!studentId) continue;
    const [existingRows] = await pool.query(
      `SELECT performance_id FROM student_performance WHERE student_id = ? AND test_name = ? LIMIT 1`,
      [studentId, performance[6]]
    );
    if (existingRows.length === 0) {
      await pool.query(
        `
        INSERT INTO student_performance
          (student_id, subject, test_type, score, total_questions, correct_answers, test_name, rank, total_participants)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [studentId, performance[1], performance[2], performance[3], performance[4], performance[5], performance[6], performance[7], performance[8]]
      );
    }
  }
}

async function seedDemoContentAndReports() {
  const pool = getPool();

  // Seed content submissions
  const contentSubmissions = [
    {
      title: "Physics: Work & Energy",
      type: "PDF",
      courseTitle: "Engineering Physics",
      batchName: "Engineering A",
      description: "Comprehensive guide on work and energy concepts",
      deadline: null,
    },
    {
      title: "Math Quiz Set - Algebra",
      type: "Quiz",
      courseTitle: "Engineering Math",
      batchName: "Engineering A",
      description: "20 questions covering algebra fundamentals",
      deadline: null,
    },
    {
      title: "Chemistry lab worksheet",
      type: "Assignment",
      courseTitle: "Organic Chemistry",
      batchName: "Medical+Versity",
      description: "Practical chemistry lab exercises",
      deadline: "2026-05-12",
    },
  ];

  for (const content of contentSubmissions) {
    await pool.query(
      `
      INSERT INTO \`content_submissions\` (title, type, course_title, batch_name, description, deadline, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
      ON DUPLICATE KEY UPDATE
        title = VALUES(title)
      `,
      [content.title, content.type, content.courseTitle, content.batchName, content.description, content.deadline]
    );
  }

  // Seed reports
  const reportsList = [
    {
      title: "Student cannot access mock test",
      description: "A student reported that the mock test page opens but the start button does not respond.",
      category: "bug",
      reporterName: "Demo Student",
      reporterEmail: "demo@edumate.com",
      status: "open",
      priority: "high",
      value: "Mock test",
    },
    {
      title: "Incorrect content in chemistry worksheet",
      description: "A content issue was reported for an instructor worksheet with mismatched answer options.",
      category: "content",
      reporterName: "Demo Instructor",
      reporterEmail: "instructor@edumate.com",
      status: "open",
      priority: "medium",
      value: "Worksheet",
    },
    {
      title: "Account freeze request",
      description: "A user complaint was submitted about suspicious activity from a shared account.",
      category: "complaint",
      reporterName: "Support Desk",
      reporterEmail: "support@edumate.com",
      status: "completed",
      priority: "high",
      value: "Account",
    },
  ];

  await pool.query(
    `
    DELETE old_reports FROM \`reports\` old_reports
    JOIN \`reports\` newer_reports
      ON old_reports.title = newer_reports.title
     AND old_reports.report_id < newer_reports.report_id
    WHERE old_reports.title IN (?, ?, ?, ?, ?, ?)
    `,
    [
      "Login spike review",
      "Content approval delay",
      "System warning alert",
      "Student cannot access mock test",
      "Incorrect content in chemistry worksheet",
      "Account freeze request",
    ]
  );

  for (const report of reportsList) {
    const [existingReports] = await pool.query(
      "SELECT report_id FROM `reports` WHERE title = ? LIMIT 1",
      [report.title]
    );

    if (existingReports.length > 0) {
      await pool.query(
        `
        UPDATE \`reports\`
        SET description = ?, category = ?, reporter_name = ?, reporter_email = ?,
            status = ?, priority = ?, value = ?
        WHERE report_id = ?
        `,
        [
          report.description,
          report.category,
          report.reporterName,
          report.reporterEmail,
          report.status,
          report.priority,
          report.value,
          existingReports[0].report_id,
        ]
      );
    } else {
      await pool.query(
        `
        INSERT INTO \`reports\`
          (title, description, category, reporter_name, reporter_email, status, priority, value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          report.title,
          report.description,
          report.category,
          report.reporterName,
          report.reporterEmail,
          report.status,
          report.priority,
          report.value,
        ]
      );
    }
  }

  // Seed student performance data
  const [studentRows] = await pool.query("SELECT student_id FROM students LIMIT 1");
  if (studentRows.length > 0) {
    const studentId = studentRows[0].student_id;
    
    const performanceData = [
      { subject: "Physics", testType: "mock", score: 84, totalQuestions: 100, correctAnswers: 84, testName: "Full Admission Mock - Set 11", rank: 42, totalParticipants: 210 },
      { subject: "Chemistry", testType: "mock", score: 72, totalQuestions: 80, correctAnswers: 58, testName: "Chemistry Midterm", rank: 58, totalParticipants: 180 },
      { subject: "Math", testType: "practice", score: 63, totalQuestions: 50, correctAnswers: 32, testName: "Algebra Practice Set", rank: null, totalParticipants: null },
      { subject: "Physics", testType: "practice", score: 82, totalQuestions: 30, correctAnswers: 26, testName: "Physics Speed Drill", rank: null, totalParticipants: null },
      { subject: "Chemistry", testType: "mock", score: 78, totalQuestions: 100, correctAnswers: 78, testName: "Chemistry Full Test", rank: 35, totalParticipants: 150 },
      { subject: "Math", testType: "mock", score: 79, totalQuestions: 100, correctAnswers: 79, testName: "Math Practice Mock Set 4", rank: null, totalParticipants: null },
    ];

    for (const perf of performanceData) {
      await pool.query(
        `
        INSERT INTO \`student_performance\` 
        (student_id, subject, test_type, score, total_questions, correct_answers, test_name, rank, total_participants)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          score = VALUES(score)
        `,
        [
          studentId,
          perf.subject,
          perf.testType,
          perf.score,
          perf.totalQuestions,
          perf.correctAnswers,
          perf.testName,
          perf.rank,
          perf.totalParticipants,
        ]
      );
    }
  }
}

async function seedDemoDiscussions() {
  const pool = getPool();
  const [studentRows] = await pool.query("SELECT student_id FROM students LIMIT 1");
  if (studentRows.length === 0) return;

  const studentId = studentRows[0].student_id;

  const discussions = [
    { title: "Physics optics tips for admission mock?", content: "Any tips for solving optics problems faster?", subject: "Physics", tag: "New" },
    { title: "Share your chemistry revision notes", content: "Please share your revision notes and tips for chemistry.", subject: "Chemistry", tag: "Trending" },
    { title: "How to manage time in full mocks?", content: "What's your strategy for time management during full mocks?", subject: "General", tag: "Hot" },
    { title: "Interview prep checklist", content: "Here's a comprehensive checklist for interview preparation.", subject: "Interview", tag: "Pinned" },
  ];

  for (const disc of discussions) {
    const [result] = await pool.query(
      `INSERT INTO \`discussions\` (student_id, title, content, subject, tag) 
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title)`,
      [studentId, disc.title, disc.content, disc.subject, disc.tag]
    );

    const discussionId = result.insertId || (await pool.query(
      `SELECT discussion_id FROM discussions WHERE title = ? LIMIT 1`,
      [disc.title]
    ))[0][0]?.discussion_id;

    if (discussionId) {
      const replies = [
        { content: "Great question! I find practicing with past papers helps." },
        { content: "Yes, this topic appears frequently in the mock tests." },
      ];

      for (const reply of replies) {
        await pool.query(
          `INSERT INTO \`discussion_replies\` (discussion_id, student_id, content) VALUES (?, ?, ?)`,
          [discussionId, studentId, reply.content]
        );
      }

      await pool.query(
        `UPDATE \`discussions\` SET reply_count = ? WHERE discussion_id = ?`,
        [replies.length, discussionId]
      );
    }
  }
}

async function seedDemoStudyCircles() {
  const pool = getPool();
  const [studentRows] = await pool.query("SELECT student_id FROM students LIMIT 1");
  if (studentRows.length === 0) return;

  const studentId = studentRows[0].student_id;

  const circles = [
    { name: "Physics Circle", subject: "Physics", description: "Weekly problem-solving sessions" },
    { name: "Chemistry Circle", subject: "Chemistry", description: "Share reaction sheets and tips" },
    { name: "Math Circle", subject: "Math", description: "Daily drills and doubt clearing" },
  ];

  for (const circle of circles) {
    const [result] = await pool.query(
      `INSERT INTO \`study_circles\` (name, subject, description, member_count) 
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [circle.name, circle.subject, circle.description, Math.floor(Math.random() * 50) + 30]
    );

    const circleId = result.insertId || (await pool.query(
      `SELECT circle_id FROM study_circles WHERE name = ? LIMIT 1`,
      [circle.name]
    ))[0][0]?.circle_id;

    if (circleId) {
      await pool.query(
        `INSERT INTO \`study_circle_members\` (circle_id, student_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE circle_id = circle_id`,
        [circleId, studentId]
      );
    }
  }
}

module.exports = {
  ensureSchema,
  seedDemoAccounts,
  seedDemoContentAndReports,
  seedDemoDiscussions,
  seedDemoStudyCircles,
  seedDemoExamSchedules,
  seedDemoInstructorWorkspace,
};
