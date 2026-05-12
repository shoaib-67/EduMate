const {
  API_BASE_URL,
  getStudentId,
  requireRole,
  setupLogoutHandlers,
} = window.EduMateShared || {};

let bankCards = [];
const bankFilters = Array.from(document.querySelectorAll(".filters .filter-btn"));
const bankSearchInput = document.querySelector(".search-box input");
const bankGrid = document.querySelector(".bank-grid");
const pageHeaderCopy = document.querySelector(".page-header p");

const state = {
  activeFilter: "all",
  searchTerm: "",
  programGroup: "",
  bankItems: [],
};

const normalizeBankValue = (value) => String(value || "").trim().toLowerCase();

function deriveProgramGroup(rawValue) {
  const value = normalizeBankValue(rawValue);
  if (!value) return "";
  if (value.includes("engineering")) return "engineering";
  if (value.includes("varsity") || value.includes("versity")) return "varsity";
  if (value.includes("medical")) return "medical";
  return "";
}

async function resolveStudentProgramGroup() {
  if (!API_BASE_URL || typeof getStudentId !== "function") return "";
  const studentId = getStudentId();
  if (!studentId) return "";

  try {
    const response = await fetch(`${API_BASE_URL}/student/${studentId}/exams`);
    const payload = await response.json();
    if (!response.ok || !payload?.success) return "";
    const student = payload.data?.student || {};
    return deriveProgramGroup(student.courseTrack || student.batchName || "");
  } catch {
    return "";
  }
}

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBatchLabel(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "All Batches";
  if (normalizeBankValue(value) === "all_batches") return "All Batches";
  return value;
}

function deriveFilterKey(item) {
  const batch = normalizeBankValue(item.batchName || "");
  if (!batch || batch === "all_batches") return "all";
  const programGroup = deriveProgramGroup(batch);
  return programGroup || batch;
}

function deriveProgramKey(item) {
  const fromBatch = deriveProgramGroup(item.batchName || "");
  if (fromBatch) return fromBatch;
  const fromCourse = deriveProgramGroup(item.courseTitle || "");
  if (fromCourse) return fromCourse;
  return "all";
}

function formatDateLabel(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString();
}

function renderBankCards() {
  if (!bankGrid) return;
  const items = state.bankItems || [];
  bankGrid.innerHTML = items
    .map((item) => {
      const batchLabel = formatBatchLabel(item.batchName);
      const programKey = deriveProgramKey(item);
      const filterKey = deriveFilterKey(item);
      const link = String(item.link || "").trim();
      const courseTitle = String(item.courseTitle || "").trim();
      const instructorLabel = item.instructorName ? `Added by ${item.instructorName}` : "";

      return `
        <article class="bank-card" data-filter="${escapeHTML(filterKey)}" data-programs="${escapeHTML(programKey)}">
          <div class="u-flex u-align-center u-space-between u-gap-8">
            <h3>${escapeHTML(item.title || "Question Bank Link")}</h3>
            <span class="chip">${escapeHTML(batchLabel)}</span>
          </div>
          ${courseTitle ? `<p>${escapeHTML(courseTitle)}</p>` : ""}
          <p>${escapeHTML(item.description || "")}</p>
          <div class="u-flex u-gap-8 u-flex-wrap">
            <span class="chip blue">${escapeHTML(item.type || "Question Bank")}</span>
            ${instructorLabel ? `<span class="chip amber">${escapeHTML(instructorLabel)}</span>` : ""}
          </div>
          <div class="u-flex u-align-center u-space-between u-gap-8">
            <span class="muted">${escapeHTML(formatDateLabel(item.createdAt))}</span>
            ${
              link
                ? `<a class="btn btn-secondary" href="${escapeHTML(link)}" target="_blank" rel="noreferrer">Open</a>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");

  bankCards = Array.from(bankGrid.querySelectorAll(".bank-card"));
}

function cardMatchesProgram(card) {
  if (!state.programGroup) return true;
  const rawPrograms = normalizeBankValue(card.dataset.programs || "");
  if (!rawPrograms) return true;
  const programs = rawPrograms.split(",").map((item) => item.trim()).filter(Boolean);
  return programs.includes(state.programGroup) || programs.includes("all");
}

function cardMatchesFilter(card) {
  if (state.activeFilter === "all") return true;
  return normalizeBankValue(card.dataset.filter || "") === state.activeFilter;
}

function cardMatchesSearch(card) {
  if (!state.searchTerm) return true;
  return normalizeBankValue(card.textContent).includes(state.searchTerm);
}

function updateFilterButtonVisibility() {
  const visibleFilterKeys = new Set(
    bankCards
      .filter((card) => cardMatchesProgram(card))
      .map((card) => normalizeBankValue(card.dataset.filter || ""))
      .filter(Boolean)
  );

  bankFilters.forEach((button) => {
    const key = normalizeBankValue(button.dataset.filter || button.textContent);
    const shouldShow = key === "all" || visibleFilterKeys.has(key);
    button.hidden = !shouldShow;

    if (shouldShow) {
      button.classList.toggle("active", key === state.activeFilter);
    } else {
      button.classList.remove("active");
    }
  });

  const activeButton = bankFilters.find(
    (button) =>
      !button.hidden &&
      normalizeBankValue(button.dataset.filter || button.textContent) === state.activeFilter
  );

  if (!activeButton) {
    state.activeFilter = "all";
    bankFilters.forEach((button) => {
      const key = normalizeBankValue(button.dataset.filter || button.textContent);
      button.classList.toggle("active", key === "all");
    });
  }
}

function renderNoResultsMessage(visibleCount) {
  if (!bankGrid) return;
  const existing = bankGrid.querySelector(".no-bank-message");
  if (existing) existing.remove();

  if (visibleCount > 0) return;
  const message = document.createElement("p");
  message.className = "no-bank-message";
  message.textContent = state.bankItems.length
    ? "No question bank materials match the selected filters."
    : "No approved question bank links are available right now.";
  bankGrid.appendChild(message);
}

function applyBankFilters() {
  updateFilterButtonVisibility();

  let visibleCount = 0;
  bankCards.forEach((card) => {
    const isVisible = cardMatchesProgram(card) && cardMatchesFilter(card) && cardMatchesSearch(card);
    card.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  renderNoResultsMessage(visibleCount);
}

function bindFilters() {
  bankFilters.forEach((button) => {
    button.addEventListener("click", () => {
      const key = normalizeBankValue(button.dataset.filter || button.textContent);
      state.activeFilter = key || "all";
      bankFilters.forEach((item) => {
        const itemKey = normalizeBankValue(item.dataset.filter || item.textContent);
        item.classList.toggle("active", itemKey === state.activeFilter);
      });
      applyBankFilters();
    });
  });

  if (bankSearchInput) {
    bankSearchInput.addEventListener("input", () => {
      state.searchTerm = normalizeBankValue(bankSearchInput.value);
      applyBankFilters();
    });
  }
}

async function loadQuestionBankLinks() {
  if (!API_BASE_URL || typeof getStudentId !== "function") return;
  const studentId = getStudentId();
  if (!studentId) return;

  try {
    const response = await fetch(`${API_BASE_URL}/student/${studentId}/question-bank`);
    const payload = await response.json();
    if (!response.ok || !payload?.success) {
      state.bankItems = [];
      return;
    }
    state.bankItems = Array.isArray(payload.data) ? payload.data : [];
  } catch {
    state.bankItems = [];
  }
}

async function initQuestionBankPage() {
  const user = requireRole?.("student") || null;
  if (!user) return;
  setupLogoutHandlers?.();

  state.programGroup = await resolveStudentProgramGroup();

  if (pageHeaderCopy && state.programGroup) {
    const label =
      state.programGroup === "engineering"
        ? "Engineering"
        : state.programGroup === "varsity"
          ? "Varsity"
          : "Medical";
    pageHeaderCopy.textContent = `Showing ${label} program materials only.`;
  }

  await loadQuestionBankLinks();
  renderBankCards();
  bindFilters();
  applyBankFilters();
}

initQuestionBankPage();
