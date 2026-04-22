const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");

const { ensureDatabaseExists, getPool } = require("./db");
const { ensureSchema, seedDemoUsers } = require("./initDb");

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
      "SELECT id FROM users WHERE email = ? OR phone = ? LIMIT 1",
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
      "INSERT INTO users (full_name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [cleanFullName, cleanEmail, cleanPhone, passwordHash, "student"]
    );

    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
    });
  } catch (error) {
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

    const [rows] = await pool.query(
      "SELECT id, full_name, email, phone, password_hash, role FROM users WHERE (email = ? OR phone = ?) AND role = ? LIMIT 1",
      [cleanIdentifier, cleanIdentifier, cleanRole]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials.",
      });
    }

    const user = rows[0];
    const passwordOk = await bcrypt.compare(cleanPassword, user.password_hash);

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
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not login.",
      error: error.message,
    });
  }
});

async function startServer() {
  try {
    await ensureDatabaseExists();
    await ensureSchema();
    await seedDemoUsers();

    app.listen(PORT, () => {
      console.log(`EduMate backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
