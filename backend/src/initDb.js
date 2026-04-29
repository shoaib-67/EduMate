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
      \`status\` VARCHAR(50) DEFAULT 'open',
      \`priority\` VARCHAR(50) DEFAULT 'normal',
      \`value\` VARCHAR(100),
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
    { title: "Login spike review", status: "completed", priority: "high", value: "18k logins" },
    { title: "Content approval delay", status: "open", priority: "high", value: "3 pending" },
    { title: "System warning alert", status: "open", priority: "high", value: "2 issues" },
  ];

  for (const report of reportsList) {
    await pool.query(
      `
      INSERT INTO \`reports\` (title, status, priority, value)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title)
      `,
      [report.title, report.status, report.priority, report.value]
    );
  }
}

module.exports = {
  ensureSchema,
  seedDemoAccounts,
  seedDemoContentAndReports,
};
