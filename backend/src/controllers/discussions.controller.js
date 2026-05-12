const { getPool } = require("../db");
const { parseRequiredId } = require("../lib/parsers");

const discussionsController = {
  list: async (_req, res) => {
    try {
      const pool = getPool();
      const [discussions] = await pool.query(
        `SELECT d.discussion_id, d.student_id, d.title, d.content, d.subject, d.tag,
                d.reply_count, d.is_pinned, d.created_at, s.name as author_name
         FROM discussions d
         JOIN students s ON d.student_id = s.student_id
         ORDER BY d.is_pinned DESC, d.created_at DESC LIMIT 20`
      );

      return res.status(200).json({ success: true, data: discussions });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch discussions.", error: error.message });
    }
  },

  getOne: async (req, res) => {
    try {
      const { discussionId } = req.params;
      const pool = getPool();
      const [discussion] = await pool.query(
        `SELECT d.*, s.name as author_name FROM discussions d
         JOIN students s ON d.student_id = s.student_id
         WHERE d.discussion_id = ?`,
        [discussionId]
      );
      if (!discussion.length) {
        return res.status(404).json({ success: false, message: "Discussion not found." });
      }

      const [replies] = await pool.query(
        `SELECT dr.reply_id, dr.student_id, dr.instructor_id, dr.author_role, dr.content, dr.created_at,
                COALESCE(s.name, i.name) as author_name
         FROM discussion_replies dr
         LEFT JOIN students s ON dr.student_id = s.student_id
         LEFT JOIN instructors i ON dr.instructor_id = i.instructor_id
         WHERE dr.discussion_id = ? ORDER BY dr.created_at ASC`,
        [discussionId]
      );

      return res.status(200).json({ success: true, data: { ...discussion[0], replies } });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch discussion.", error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { studentId, title, content, subject } = req.body || {};
      if (!studentId || !title || !content) {
        return res.status(422).json({ success: false, message: "Student ID, title, and content are required." });
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
      return res.status(500).json({ success: false, message: "Could not create discussion.", error: error.message });
    }
  },

  reply: async (req, res) => {
    try {
      const { discussionId } = req.params;
      const userRole = String(req.body?.userRole || "").trim().toLowerCase();
      const userId = parseRequiredId(req.body?.userId);
      const content = String(req.body?.content || "").trim();

      if (!["student", "instructor"].includes(userRole) || !userId || !content) {
        return res.status(422).json({ success: false, message: "A valid student or instructor reply is required." });
      }

      const pool = getPool();
      const [discussionRows] = await pool.query(`SELECT discussion_id FROM discussions WHERE discussion_id = ? LIMIT 1`, [
        discussionId,
      ]);
      if (!discussionRows.length) {
        return res.status(404).json({ success: false, message: "Discussion not found." });
      }

      const authorConfig =
        userRole === "instructor"
          ? { studentId: null, instructorId: userId, tableName: "instructors", idColumn: "instructor_id" }
          : { studentId: userId, instructorId: null, tableName: "students", idColumn: "student_id" };

      const [authorRows] = await pool.query(
        `SELECT ${authorConfig.idColumn} FROM ${authorConfig.tableName} WHERE ${authorConfig.idColumn} = ? LIMIT 1`,
        [userId]
      );
      if (!authorRows.length) {
        return res.status(404).json({
          success: false,
          message: `${userRole === "instructor" ? "Instructor" : "Student"} not found.`,
        });
      }

      await pool.query(
        `INSERT INTO discussion_replies (discussion_id, student_id, instructor_id, author_role, content)
         VALUES (?, ?, ?, ?, ?)`,
        [discussionId, authorConfig.studentId, authorConfig.instructorId, userRole, content]
      );

      await pool.query(`UPDATE discussions SET reply_count = reply_count + 1 WHERE discussion_id = ?`, [discussionId]);

      return res.status(201).json({ success: true, message: "Reply added successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not add reply.", error: error.message });
    }
  },
};

module.exports = { discussionsController };

