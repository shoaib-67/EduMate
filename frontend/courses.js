const { API_BASE_URL, getStudentId, requireRole, setupLogoutHandlers } = window.EduMateShared;

const state = {
  items: [],
  activeFilter: "all",
  searchTerm: "",
};

const categoryMeta = {
  "question-bank": { label: "Question Bank", chipClass: "chip blue" },
  "class-video": { label: "Class Video", chipClass: "chip" },
  "concept-book": { label: "Concept Book", chipClass: "chip amber" },
};

const normalize = (value) => String(value || "").trim().toLowerCase();
const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const filterButtons = Array.from(document.querySelectorAll(".filters .filter-btn"));
const searchInput = document.querySelector(".search-box input");

function classifyCategory(item) {
  const type = normalize(item.type);
  const title = normalize(item.title);
  const description = normalize(item.description);
  const combined = `${type} ${title} ${description}`;

  if (combined.includes("question bank")) return "question-bank";
  if (combined.includes("video")) return "class-video";
  if (combined.includes("concept") || combined.includes("book") || combined.includes("pdf")) return "concept-book";
  return "";
}

function mapItem(rawItem, source) {
  const rawId = rawItem.id ?? rawItem.submission_id ?? null;
  const item = {
    id: `${source}-${rawId ?? rawItem.title ?? Math.random()}`,
    rawId,
    title: String(rawItem.title || "Untitled").trim(),
    courseTitle: String(rawItem.courseTitle || rawItem.course_title || "").trim(),
    description: String(rawItem.description || "").trim(),
    type: String(rawItem.type || "").trim(),
    batchName: String(rawItem.batchName || rawItem.batch_name || "").trim(),
    link: String(rawItem.link || "").trim(),
    createdAt: rawItem.createdAt || rawItem.created_at || null,
    source,
  };

  const category = source === "question-bank" ? "question-bank" : classifyCategory(item);
  if (!category) return null;

  return { ...item, category };
}

function updateStats(items) {
  const statCards = document.querySelectorAll(".stat-row .stat-card");
  if (statCards.length < 3) return;

  const questionBankCount = items.filter((item) => item.category === "question-bank").length;
  const classVideoCount = items.filter((item) => item.category === "class-video").length;
  const conceptBookCount = items.filter((item) => item.category === "concept-book").length;

  statCards[0].innerHTML = `
    <p class="s-label">Question Bank</p>
    <p class="s-val">${questionBankCount}</p>
    <p class="s-sub">${questionBankCount > 0 ? "Approved items" : "No items yet"}</p>
  `;

  statCards[1].innerHTML = `
    <p class="s-label">Class Video</p>
    <p class="s-val">${classVideoCount}</p>
    <p class="s-sub">${classVideoCount > 0 ? "Available videos" : "No videos yet"}</p>
  `;

  statCards[2].innerHTML = `
    <p class="s-label">Concept Book</p>
    <p class="s-val text-primary">${conceptBookCount}</p>
    <p class="s-sub">${conceptBookCount > 0 ? "PDF/Book resources" : "No resources yet"}</p>
  `;
}

function filteredItems() {
  return state.items.filter((item) => {
    const filterMatch = state.activeFilter === "all" || item.category === state.activeFilter;
    const searchBase = normalize(`${item.title} ${item.courseTitle} ${item.description} ${item.batchName} ${item.type}`);
    const searchMatch = !state.searchTerm || searchBase.includes(state.searchTerm);
    return filterMatch && searchMatch;
  });
}

function renderCards() {
  const grid = document.querySelector(".grid");
  if (!grid) return;

  const items = filteredItems();
  if (!items.length) {
    grid.innerHTML = `
      <div class="course-card">
        <h3>No matching content</h3>
        <p>Try another filter or search term.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = items
    .map((item) => {
      const categoryInfo = categoryMeta[item.category];
      const dateLabel = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "";
      const batchLabel = item.batchName || "All Batches";

      return `
        <article class="course-card">
          <div class="u-flex u-align-center u-space-between u-gap-8">
            <h3>${escapeHtml(item.title)}</h3>
            <span class="${categoryInfo.chipClass}">${escapeHtml(categoryInfo.label)}</span>
          </div>
          <p>${escapeHtml(item.description || "No description provided.")}</p>
          <div class="course-meta u-flex u-space-between">
            <span>${escapeHtml(item.courseTitle || "General")}</span>
            <span>${escapeHtml(batchLabel)}</span>
          </div>
          <div class="course-meta u-flex u-space-between">
            <span>${escapeHtml(item.type || categoryInfo.label)}</span>
            <span>${escapeHtml(dateLabel || "Updated recently")}</span>
          </div>
          ${item.link
            ? `<a class="btn btn-primary" href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">Open</a>`
            : `<button class="btn" type="button" disabled>No Link</button>`}
        </article>
      `;
    })
    .join("");
}

function setActiveFilter(filterKey) {
  state.activeFilter = filterKey;
  filterButtons.forEach((button) => {
    const key = normalize(button.dataset.filter);
    button.classList.toggle("active", key === filterKey);
  });
  renderCards();
}

function bindControls() {
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const key = normalize(button.dataset.filter || "all") || "all";
      setActiveFilter(key);
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      state.searchTerm = normalize(searchInput.value);
      renderCards();
    });
  }
}

async function loadMergedContent() {
  const studentId = getStudentId();
  if (!studentId) return [];

  const [coursesResult, questionBankResult] = await Promise.allSettled([
    fetch(`${API_BASE_URL}/student/${studentId}/courses`).then((res) => res.json()),
    fetch(`${API_BASE_URL}/student/${studentId}/question-bank`).then((res) => res.json()),
  ]);

  const courseItems =
    coursesResult.status === "fulfilled" && coursesResult.value?.success && Array.isArray(coursesResult.value.data)
      ? coursesResult.value.data
      : [];
  const bankItems =
    questionBankResult.status === "fulfilled" &&
    questionBankResult.value?.success &&
    Array.isArray(questionBankResult.value.data)
      ? questionBankResult.value.data
      : [];

  const merged = [
    ...courseItems.map((item) => mapItem(item, "courses")),
    ...bankItems.map((item) => mapItem(item, "question-bank")),
  ].filter(Boolean);

  const seen = new Set();
  return merged.filter((item) => {
    const key =
      item.rawId != null && item.rawId !== ""
        ? `submission:${item.rawId}`
        : `${normalize(item.title)}|${normalize(item.link)}|${normalize(item.courseTitle)}|${normalize(item.batchName)}|${item.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function initPage() {
  if (!requireRole("student")) return;
  setupLogoutHandlers();
  bindControls();

  try {
    state.items = await loadMergedContent();
    updateStats(state.items);
    renderCards();
  } catch (_error) {
    const grid = document.querySelector(".grid");
    if (grid) {
      grid.innerHTML = `
        <div class="course-card">
          <h3>Could not load content</h3>
          <p>Please refresh after backend is running.</p>
        </div>
      `;
    }
  }
}

document.addEventListener("DOMContentLoaded", initPage);
