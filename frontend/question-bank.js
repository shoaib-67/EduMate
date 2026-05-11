const {
  API_BASE_URL,
  getStudentId,
  requireRole,
  setupLogoutHandlers,
} = window.EduMateShared || {};

const bankCards = Array.from(document.querySelectorAll(".bank-card"));
const bankFilters = Array.from(document.querySelectorAll(".filters .filter-btn"));
const bankSearchInput = document.querySelector(".search-box input");
const bankGrid = document.querySelector(".bank-grid");
const pageHeaderCopy = document.querySelector(".page-header p");

const state = {
  activeFilter: "all",
  searchTerm: "",
  programGroup: "",
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
  message.textContent = "No question bank materials available for your program right now.";
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

  bindFilters();
  applyBankFilters();
}

initQuestionBankPage();
