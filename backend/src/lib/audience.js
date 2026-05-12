const DEFAULT_BATCH_OPTIONS = ["Engineering", "Varsity", "Medical"];
const ALL_BATCHES_LABEL = "ALL_BATCHES";
const ALL_BATCHES_DISPLAY = "All Batches";

function normalizeBatchName(rawBatch) {
  const value = String(rawBatch || "").trim();
  if (!value) return "";

  const normalized = value.toLowerCase().replace(/\s+/g, " ");
  if (
    normalized === "all" ||
    normalized === "all batch" ||
    normalized === "all batches" ||
    normalized === "all-batches" ||
    normalized === "all_batches"
  ) {
    return ALL_BATCHES_LABEL;
  }

  return value;
}

function deriveBatchFromProgram(program) {
  const group = deriveProgramGroup(program);
  if (group === "engineering") return "Engineering";
  if (group === "varsity") return "Varsity";
  if (group === "medical") return "Medical";
  return "";
}

function deriveProgramGroup(rawValue) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) return "";
  const groups = [];
  if (normalized.includes("engineering")) groups.push("engineering");
  if (normalized.includes("varsity") || normalized.includes("versity")) groups.push("varsity");
  if (normalized.includes("medical")) groups.push("medical");
  return groups.length === 1 ? groups[0] : "";
}

function resolveStudentProgramGroup(studentRow) {
  const fromTrack = deriveProgramGroup(studentRow?.course_track);
  if (fromTrack) return fromTrack;
  return deriveProgramGroup(studentRow?.batch_name);
}

function normalizeAudienceType(rawAudienceType, fallback = "batch") {
  const clean = String(rawAudienceType || fallback).trim().toLowerCase();
  if (["all", "all_batches", "all-batches"].includes(clean)) return "all";
  if (clean === "specific") return "specific";
  return "batch";
}

function formatAudienceLabel(audienceType, batchName) {
  if (normalizeAudienceType(audienceType) === "all") return ALL_BATCHES_DISPLAY;
  const normalizedBatch = normalizeBatchName(batchName);
  if (normalizedBatch === ALL_BATCHES_LABEL) return ALL_BATCHES_DISPLAY;
  return String(batchName || "").trim() || "General";
}

function isAudienceVisibleToStudent({ audienceType, batchName, studentBatchName, studentProgramGroup }) {
  const cleanAudienceType = normalizeAudienceType(audienceType, "batch");
  if (cleanAudienceType === "all") return true;

  const normalizedBatch = normalizeBatchName(batchName);
  if (normalizedBatch === ALL_BATCHES_LABEL) return true;

  const targetGroup = deriveProgramGroup(batchName);
  if (targetGroup && studentProgramGroup) return targetGroup === studentProgramGroup;

  const normalizedStudentBatch = normalizeBatchName(studentBatchName);
  if (!normalizedBatch || !normalizedStudentBatch) return false;
  return normalizedBatch.toLowerCase() === normalizedStudentBatch.toLowerCase();
}

module.exports = {
  DEFAULT_BATCH_OPTIONS,
  ALL_BATCHES_LABEL,
  ALL_BATCHES_DISPLAY,
  normalizeBatchName,
  deriveBatchFromProgram,
  deriveProgramGroup,
  resolveStudentProgramGroup,
  normalizeAudienceType,
  formatAudienceLabel,
  isAudienceVisibleToStudent,
};

