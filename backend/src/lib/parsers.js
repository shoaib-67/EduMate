function parseRequiredId(rawValue) {
  const id = Number(rawValue);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parsePositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function parseQuestionIds(input) {
  const source = Array.isArray(input)
    ? input
    : String(input || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  return Array.from(
    new Set(
      source
        .map((item) => Number(item))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
}

function parseMcqOptions(optionsText = "") {
  const raw = String(optionsText || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // Fall back to delimiter-based parsing.
  }

  return raw
    .split("|")
    .map((part) => part.replace(/^\s*[A-Da-d][).:\-]\s*/, "").trim())
    .filter(Boolean);
}

function resolveAnswerIndex(answerKey, options) {
  const normalizedOptions = Array.isArray(options) ? options : [];
  const raw = String(answerKey || "").trim();
  if (!raw || !normalizedOptions.length) return -1;

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (numeric >= 0 && numeric < normalizedOptions.length) return numeric;
    if (numeric >= 1 && numeric <= normalizedOptions.length) return numeric - 1;
  }

  const letter = raw.toUpperCase();
  const letterIndex = ["A", "B", "C", "D"].indexOf(letter);
  if (letterIndex >= 0 && letterIndex < normalizedOptions.length) return letterIndex;

  const matchIndex = normalizedOptions.findIndex((option) => option.toLowerCase() === raw.toLowerCase());
  return matchIndex;
}

module.exports = {
  parseRequiredId,
  parsePositiveInteger,
  parseQuestionIds,
  parseMcqOptions,
  resolveAnswerIndex,
};

