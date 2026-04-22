const bcrypt = require("bcryptjs");
const { getPool } = require("./db");

async function ensureSchema() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(120) NOT NULL UNIQUE,
      phone VARCHAR(25) NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('student', 'instructor', 'admin') NOT NULL DEFAULT 'student',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      student_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(120) NOT NULL UNIQUE,
      phone_number VARCHAR(25) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS instructors (
      instructor_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(120) NOT NULL UNIQUE,
      phone_number VARCHAR(25) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      admin_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(120) NOT NULL UNIQUE,
      phone_number VARCHAR(25) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function seedDemoUsers() {
  const pool = getPool();

  const demoUsers = [
    {
      fullName: "Demo Student",
      email: "demo@edumate.com",
      phone: "+8801000000000",
      password: "EduMate@123",
      role: "student",
    },
    {
      fullName: "Demo Instructor",
      email: "instructor@edumate.com",
      phone: null,
      password: "EduMate@123",
      role: "instructor",
    },
    {
      fullName: "Demo Admin",
      email: "admin@edumate.com",
      phone: null,
      password: "Admin@123",
      role: "admin",
    },
  ];

  for (const user of demoUsers) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    await pool.query(
      `
      INSERT INTO users (full_name, email, phone, password_hash, role)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        full_name = VALUES(full_name),
        role = VALUES(role)
      `,
      [user.fullName, user.email, user.phone, passwordHash, user.role]
    );
  }
}

module.exports = {
  ensureSchema,
  seedDemoUsers,
};
