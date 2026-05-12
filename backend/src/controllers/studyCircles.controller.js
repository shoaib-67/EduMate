const { getPool } = require("../db");

const studyCirclesController = {
  list: async (_req, res) => {
    try {
      const pool = getPool();
      const [circles] = await pool.query(
        `SELECT circle_id, name, subject, description, member_count, created_at
         FROM study_circles ORDER BY member_count DESC`
      );
      return res.status(200).json({ success: true, data: circles });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch study circles.", error: error.message });
    }
  },

  members: async (req, res) => {
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
      return res.status(200).json({ success: true, data: members });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not fetch circle members.", error: error.message });
    }
  },

  join: async (req, res) => {
    try {
      const { circleId } = req.params;
      const { studentId } = req.body || {};

      if (!studentId) {
        return res.status(422).json({ success: false, message: "Student ID is required." });
      }

      const pool = getPool();
      const [existing] = await pool.query(`SELECT * FROM study_circle_members WHERE circle_id = ? AND student_id = ?`, [
        circleId,
        studentId,
      ]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: "Already a member of this circle." });
      }

      await pool.query(`INSERT INTO study_circle_members (circle_id, student_id) VALUES (?, ?)`, [circleId, studentId]);
      await pool.query(`UPDATE study_circles SET member_count = member_count + 1 WHERE circle_id = ?`, [circleId]);

      return res.status(201).json({ success: true, message: "Joined study circle successfully." });
    } catch (error) {
      return res.status(500).json({ success: false, message: "Could not join circle.", error: error.message });
    }
  },
};

module.exports = { studyCirclesController };

