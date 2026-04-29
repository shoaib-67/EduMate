const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");

const { ensureDatabaseExists, getPool } = require("./db");
const { ensureSchema, seedDemoAccounts, seedDemoContentAndReports, seedDemoDiscussions, seedDemoStudyCircles } = require("./initDb");

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

// Student Performance & Dashboard API Endpoints

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

    app.listen(PORT, () => {
      console.log(`EduMate backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
