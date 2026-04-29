const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");

const { ensureDatabaseExists, getPool } = require("./db");
const { ensureSchema, seedDemoAccounts, seedDemoContentAndReports } = require("./initDb");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "EduMate API is running" });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body || {};

    const cleanFullName = String(fullName || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").trim();
    const cleanPassword = String(password || "");

    if (!cleanFullName || !cleanEmail || !cleanPhone || !cleanPassword) {
      return res.status(422).json({
        success: false,
        message: "All fields are required.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(422).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (cleanPassword.length < 8) {
      return res.status(422).json({
        success: false,
        message: "Password must be at least 8 characters long.",
      });
    }

    const pool = getPool();
    const [existingRows] = await pool.query(
      "SELECT student_id FROM students WHERE email = ? OR phone_number = ? LIMIT 1",
      [cleanEmail, cleanPhone]
    );

    if (existingRows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "An account with this email or phone already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);

    await pool.query(
      "INSERT INTO students (name, email, phone_number, password_hash) VALUES (?, ?, ?, ?)",
      [cleanFullName, cleanEmail, cleanPhone, passwordHash]
    );

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
    });
  } catch (error) {
    if (error && (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_FIELD_ERROR")) {
      return res.status(500).json({
        success: false,
        message:
          "Students table/schema is missing required fields. Please create students(name, email, phone_number, password_hash) in XAMPP first.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Could not create account.",
      error: error.message,
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { identifier, password, role } = req.body || {};

    const cleanIdentifier = String(identifier || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    const cleanRole = String(role || "student").trim().toLowerCase();

    if (!cleanIdentifier || !cleanPassword) {
      return res.status(422).json({
        success: false,
        message: "Identifier and password are required.",
      });
    }

    if (!["student", "instructor", "admin"].includes(cleanRole)) {
      return res.status(422).json({
        success: false,
        message: "Invalid login role.",
      });
    }

    const pool = getPool();
    const roleTableConfig = {
      student: { table: "students", idColumn: "student_id" },
      instructor: { table: "instructors", idColumn: "instructor_id" },
      admin: { table: "admins", idColumn: "admin_id" },
    };
    const { table, idColumn } = roleTableConfig[cleanRole];

    const [rows] = await pool.query(
      `SELECT * FROM ${table} WHERE (email = ? OR phone_number = ?) LIMIT 1`,
      [cleanIdentifier, cleanIdentifier]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    const account = rows[0];
    const passwordOk = await bcrypt.compare(cleanPassword, account.password_hash);

    if (!passwordOk) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      user: {
        id: account[idColumn] || account.id,
        fullName: account.name || account.full_name,
        email: account.email,
        role: cleanRole,
      },
    });
  } catch (error) {
    if (error && (error.code === "ER_NO_SUCH_TABLE" || error.code === "ER_BAD_FIELD_ERROR")) {
      return res.status(500).json({
        success: false,
        message:
          "Required auth tables are missing required fields. Please create students/instructors/admins with (name, email, phone_number, password_hash) in XAMPP first.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Could not login.",
      error: error.message,
    });
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
    
    // Get total active users (students + instructors + admins)
    const totalActiveUsers = (studentRows[0]?.count || 0) + (instructorRows[0]?.count || 0);

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

    // Get all users combined
    const [students] = await pool.query(
      "SELECT student_id as id, name, email, 'Student' as role, 'Active' as status FROM students LIMIT 10"
    );
    const [instructors] = await pool.query(
      "SELECT instructor_id as id, name, email, 'Instructor' as role, 'Active' as status FROM instructors LIMIT 10"
    );

    const allUsers = [...students, ...instructors];

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
      "SELECT report_id as id, title, status, priority, value, created_at FROM reports ORDER BY created_at DESC"
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

app.post("/api/admin/content/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    await pool.query(
      "UPDATE content_submissions SET status = 'approved' WHERE submission_id = ?",
      [id]
    );

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

    await pool.query(
      "UPDATE content_submissions SET status = 'denied' WHERE submission_id = ?",
      [id]
    );

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
    const pool = getPool();

    await pool.query(
      "UPDATE reports SET status = 'completed' WHERE report_id = ?",
      [id]
    );

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
    const pool = getPool();

    await pool.query(
      "UPDATE reports SET status = 'denied' WHERE report_id = ?",
      [id]
    );

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

async function startServer() {
  try {
    await ensureDatabaseExists();
    await ensureSchema();
    await seedDemoAccounts();
    await seedDemoContentAndReports();

    app.listen(PORT, () => {
      console.log(`EduMate backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
