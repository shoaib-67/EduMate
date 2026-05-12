const bcrypt = require("bcryptjs");

const { getPool } = require("../db");
const { sendError, sendSuccess, isSchemaError } = require("../lib/http");
const {
  DEFAULT_BATCH_OPTIONS,
  normalizeBatchName,
  deriveBatchFromProgram,
} = require("../lib/audience");
const { USER_ROLE_CONFIG } = require("../services/admin.service");

const authController = {
  signup: async (req, res) => {
    try {
      const { fullName, email, phone, program, batch, password } = req.body || {};

      const cleanFullName = String(fullName || "").trim();
      const cleanEmail = String(email || "").trim().toLowerCase();
      const cleanPhone = String(phone || "").trim();
      const cleanProgram = String(program || "").trim();
      const cleanBatchInput = normalizeBatchName(batch);
      const cleanBatch = cleanBatchInput || deriveBatchFromProgram(cleanProgram);
      const cleanPassword = String(password || "");

      if (!cleanFullName || !cleanEmail || !cleanPhone || !cleanProgram || !cleanPassword) {
        return sendError(res, { status: 422, message: "All fields are required." });
      }

      const allowedPrograms = ["Engineering", "Varsity", "Medical"];
      if (!allowedPrograms.includes(cleanProgram)) {
        return sendError(res, { status: 422, message: "Please choose a valid program." });
      }

      if (!DEFAULT_BATCH_OPTIONS.includes(cleanBatch)) {
        return sendError(res, {
          status: 422,
          message: "Please choose a valid batch (Engineering, Varsity, or Medical).",
        });
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
        return sendError(res, { status: 409, message: "An account already exists with this email or phone number." });
      }

      const passwordHash = await bcrypt.hash(cleanPassword, 10);
      await pool.query(
        "INSERT INTO students (name, email, phone_number, password_hash, batch_name, course_track) VALUES (?, ?, ?, ?, ?, ?)",
        [cleanFullName, cleanEmail, cleanPhone, passwordHash, cleanBatch, cleanProgram]
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
  },

  login: async (req, res) => {
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
        `SELECT ${idColumn} AS id, name, email, account_status, password_hash
         FROM ${table}
         WHERE (email = ? OR phone_number = ?)
         LIMIT 1`,
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
          id: account.id,
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
  },
};

module.exports = { authController };

