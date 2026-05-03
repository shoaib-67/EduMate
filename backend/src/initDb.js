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
      \`title\` VARCHAR(255) NOT NULL,
      \`type\` VARCHAR(50) NOT NULL,
      \`description\` TEXT,
      \`status\` VARCHAR(50) DEFAULT 'pending',
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (\`instructor_id\`) REFERENCES \`instructors\`(\`instructor_id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
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

async function ensureSchema() {
  const pool = getPool();

  for (const config of roleTableConfig) {
    await ensureRoleTable(pool, config.tableName, config.idColumn);
  }
  
  await ensureContentSubmissionsTable(pool);
  await ensureReportsTable(pool);
  await ensureAdminActivityLogsTable(pool);
  await ensureStudentPerformanceTable(pool);
  await ensureDiscussionsTable(pool);
  await ensureDiscussionRepliesTable(pool);
  await ensureStudyCirclesTable(pool);
  await ensureStudyCircleMembersTable(pool);
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

async function seedDemoContentAndReports() {
  const pool = getPool();

  // Seed content submissions
  const contentSubmissions = [
    { title: "Physics: Work & Energy", type: "PDF", description: "Comprehensive guide on work and energy concepts" },
    { title: "Math Quiz Set - Algebra", type: "Quiz", description: "20 questions covering algebra fundamentals" },
    { title: "Chemistry lab worksheet", type: "Assignment", description: "Practical chemistry lab exercises" },
  ];

  for (const content of contentSubmissions) {
    await pool.query(
      `
      INSERT INTO \`content_submissions\` (title, type, description, status)
      VALUES (?, ?, ?, 'pending')
      ON DUPLICATE KEY UPDATE
        title = VALUES(title)
      `,
      [content.title, content.type, content.description]
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
};
