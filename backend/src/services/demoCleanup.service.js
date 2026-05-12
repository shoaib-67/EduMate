async function cleanupSeededDiscussions(pool) {
  const demoTitles = [
    "Physics optics tips for admission mock?",
    "Share your chemistry revision notes",
    "How to manage time in full mocks?",
    "Interview prep checklist",
  ];

  await pool.query(
    `DELETE dr FROM discussion_replies dr
     JOIN discussions d ON dr.discussion_id = d.discussion_id
     WHERE d.title IN (${demoTitles.map(() => "?").join(",")})`,
    demoTitles
  );

  await pool.query(
    `DELETE FROM discussions WHERE title IN (${demoTitles.map(() => "?").join(",")})`,
    demoTitles
  );
}

async function cleanupSeededInstructorWorkspace(pool) {
  const demoCourseTitles = ["Motion chapter formula sheet", "Live revision class moved to 7:00 PM"];
  const demoMessageTitles = ["Biology viva feedback"];
  const demoAlertTitles = ["Proctoring violation flagged", "Student submitted exam", "Exam reminder", "New student question"];

  if (demoMessageTitles.length) {
    await pool.query(
      `DELETE FROM instructor_messages WHERE title IN (${demoMessageTitles.map(() => "?").join(",")})`,
      demoMessageTitles
    );
  }

  if (demoAlertTitles.length) {
    await pool.query(
      `DELETE FROM instructor_alerts WHERE title IN (${demoAlertTitles.map(() => "?").join(",")})`,
      demoAlertTitles
    );
  }

  if (demoCourseTitles.length) {
    await pool.query(
      `DELETE FROM instructor_course_items WHERE title IN (${demoCourseTitles.map(() => "?").join(",")})`,
      demoCourseTitles
    );
  }
}

module.exports = { cleanupSeededDiscussions, cleanupSeededInstructorWorkspace };

