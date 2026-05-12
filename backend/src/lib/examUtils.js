const { normalizeAudienceType, formatAudienceLabel } = require("./audience");
const { parsePositiveInteger } = require("./parsers");

function toDateTimeValue(dateInput, timeInput) {
  const date = String(dateInput || "").trim();
  const time = String(timeInput || "").trim();

  if (!date || !time) return null;
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const parsed = new Date(`${date}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function padDateTimePart(value) {
  return String(value).padStart(2, "0");
}

function parseSqlDateTime(rawValue) {
  if (rawValue instanceof Date) {
    const d = rawValue;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
  }

  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  const normalized = raw.replace("T", " ").replace("Z", "");
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0)
  );
}

function formatSqlDateTime(date) {
  return `${date.getFullYear()}-${padDateTimePart(date.getMonth() + 1)}-${padDateTimePart(date.getDate())} ${padDateTimePart(
    date.getHours()
  )}:${padDateTimePart(date.getMinutes())}:${padDateTimePart(date.getSeconds())}`;
}

function resolveExamWindow(startTime, endTime, durationMinutes) {
  const start = parseSqlDateTime(startTime);
  let end = parseSqlDateTime(endTime);
  const duration = parsePositiveInteger(durationMinutes) || 0;

  if (start && (!end || end <= start) && duration > 0) {
    end = new Date(start.getTime() + duration * 60000);
  }

  return { start, end };
}

function deriveExamStatus(startTime, endTime, now = new Date(), durationMinutes = 0) {
  const { start, end } = resolveExamWindow(startTime, endTime, durationMinutes);
  if (!start || !end) return "upcoming";

  if (now < start) return "upcoming";
  if (now <= end) return "ongoing";
  return "completed";
}

function buildJoinExamLink(examId) {
  return `mock-test.html?examId=${encodeURIComponent(examId)}`;
}

function canJoinExam(exam, now = new Date()) {
  const joinWindowMinutes = parsePositiveInteger(exam.join_window_minutes) || 15;
  const { start, end } = resolveExamWindow(exam.start_time, exam.end_time, exam.duration_minutes);
  if (!start || !end) return false;
  const joinStart = new Date(start.getTime() - joinWindowMinutes * 60000);
  return now >= joinStart && now <= end;
}

function normalizeExamRecord(exam, now = new Date()) {
  const { start, end } = resolveExamWindow(exam.start_time, exam.end_time, exam.duration_minutes);
  const status = deriveExamStatus(start, end, now, exam.duration_minutes);
  const audienceType = normalizeAudienceType(exam.audience_type);
  return {
    id: exam.exam_id,
    subject: exam.subject,
    examDate: exam.exam_date,
    startTime: start || exam.start_time,
    endTime: end || exam.end_time,
    durationMinutes: exam.duration_minutes,
    batchName: formatAudienceLabel(audienceType, exam.batch_name),
    instructions: exam.instructions,
    audienceType,
    status,
    joinWindowMinutes: exam.join_window_minutes,
    joinAvailable: canJoinExam(exam, now),
    joinUrl: buildJoinExamLink(exam.exam_id),
    assignedStudentCount: Number(exam.assigned_student_count || 0),
  };
}

function deriveInstructorExamStatus(startTime, durationMinutes, now = new Date()) {
  const start = parseSqlDateTime(startTime);
  if (!start) return "Upcoming";
  const end = new Date(start.getTime() + Number(durationMinutes || 0) * 60000);
  if (now < start) return "Upcoming";
  if (now <= end) return "Ongoing";
  return "Completed";
}

function normalizeInstructorExamRecord(exam, now = new Date()) {
  let parsedQuestionIds = [];
  try {
    const raw = JSON.parse(exam.question_ids_json || "[]");
    parsedQuestionIds = Array.isArray(raw) ? raw : [];
  } catch {
    parsedQuestionIds = [];
  }

  const accessMode = exam.access_mode || "scheduled";
  const audienceType = normalizeAudienceType(exam.audience_type);
  const status =
    accessMode === "open_anytime" ? "always_open" : deriveInstructorExamStatus(exam.start_time, exam.duration_minutes, now);
  const start = parseSqlDateTime(exam.start_time);
  const timeValue = start ? `${padDateTimePart(start.getHours())}:${padDateTimePart(start.getMinutes())}` : "00:00";

  return {
    id: exam.instructor_exam_id,
    title: exam.title,
    batch: formatAudienceLabel(audienceType, exam.batch_name),
    audienceType,
    date: exam.exam_date,
    time: timeValue,
    duration: Number(exam.duration_minutes || 0),
    accessMode,
    negativeMarking: exam.negative_marking || "",
    shuffleMode: exam.shuffle_mode || "None",
    examType: exam.exam_type,
    state: exam.publish_state,
    approvalStatus: exam.approval_status || "pending",
    questionIds: parsedQuestionIds,
    rules: exam.rules || "",
    status,
  };
}

module.exports = {
  toDateTimeValue,
  padDateTimePart,
  parseSqlDateTime,
  formatSqlDateTime,
  resolveExamWindow,
  deriveExamStatus,
  buildJoinExamLink,
  canJoinExam,
  normalizeExamRecord,
  deriveInstructorExamStatus,
  normalizeInstructorExamRecord,
};

