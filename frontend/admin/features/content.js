import { API_BASE_URL, escapeHTML } from "../shared.js";
import { state } from "../state.js";
import { showToast } from "../ui/toast.js";
import { showContentDetail } from "../ui/modals.js";

export async function loadContent() {
  const response = await fetch(`${API_BASE_URL}/admin/content`);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.message || "Could not load content.");
  state.pendingContent = payload.data || [];
  return state.pendingContent;
}

let contentRefreshTimer = null;

export function startContentAutoRefresh() {
  if (contentRefreshTimer || !document.getElementById("contentList")) return;
  contentRefreshTimer = window.setInterval(async () => {
    try {
      await loadContent();
      renderContent();
    } catch {
      // Keep background refresh silent to avoid noisy admin UI.
    }
  }, 15000);
}

export function stopContentAutoRefresh() {
  if (!contentRefreshTimer) return;
  window.clearInterval(contentRefreshTimer);
  contentRefreshTimer = null;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeFingerprintText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildSubmissionFingerprint(item) {
  const sourceRef = normalizeFingerprintText(item.sourceRef || item.source_ref);
  if (sourceRef) {
    return `source:${sourceRef}`;
  }

  const fields = [
    item.instructorName,
    item.type,
    item.title,
    item.courseTitle,
    item.batchName,
    item.description,
    item.deadline,
  ].map((value) => normalizeFingerprintText(value));

  return fields.join("|");
}

function dedupePendingSubmissions(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const fingerprint = buildSubmissionFingerprint(item);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(item);
  }
  return unique;
}

function getCategory(item) {
  const type = normalizeText(item.type);
  if (type === "exam") return "exam";
  if (type === "announcement") return "announcement";
  if (type.includes("question bank")) return "content";
  if (type.includes("question")) return "question";
  return "content";
}

function parseExamDescription(description = "") {
  return String(description || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((result, line) => {
      const separator = line.indexOf(":");
      if (separator === -1) return result;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key) result[key] = value;
      return result;
    }, {});
}

function formatCreatedAt(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently submitted";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function setSummaryCounts(items) {
  const counts = items.reduce(
    (summary, item) => {
      summary[getCategory(item)] += 1;
      return summary;
    },
    { exam: 0, content: 0, announcement: 0, question: 0 }
  );

  const bindings = [
    ["pendingContentCount", counts.content],
    ["pendingAnnouncementCount", counts.announcement],
    ["pendingQuestionCount", 0],
  ];

  bindings.forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value);
  });

  const statusNote = document.getElementById("contentStatusNote");
  if (statusNote) {
    statusNote.textContent = items.length
      ? `${items.length} pending item${items.length === 1 ? "" : "s"} ready for review.`
      : "Approve or deny newly submitted learning material.";
  }
}

function renderCard(item) {
  const category = getCategory(item);
  const examMeta = category === "exam" ? parseExamDescription(item.description) : null;
  const courseText = item.courseTitle || "General";
  const batchText = item.batchName || "All batches";
  const descriptionPreview =
    category === "exam"
      ? [
          examMeta?.access || "Schedule not provided",
          examMeta?.duration || "Duration not provided",
          examMeta?.questions ? `${examMeta.questions} questions` : null,
        ]
          .filter(Boolean)
          .join(" • ")
      : String(item.description || "").trim() || "No extra description provided.";

  const secondaryLine =
    category === "exam"
      ? examMeta?.["exam type"] || courseText
      : `${courseText} • ${batchText}`;

  return `
    <article class="review-card review-card-${category}" data-content-id="${Number(item.id)}">
      <div class="review-card-head">
        <div class="review-card-pills">
          <span class="review-pill review-pill-type">${escapeHTML(item.type || "Item")}</span>
          <span class="review-pill review-pill-subtle">${escapeHTML(batchText)}</span>
        </div>
        <span class="review-card-time">${escapeHTML(formatCreatedAt(item.created_at || item.createdAt))}</span>
      </div>

      <div class="review-card-body">
        <h3>${escapeHTML(item.title)}</h3>
        <p class="review-card-line">${escapeHTML(secondaryLine)}</p>
        <p class="review-card-copy">${escapeHTML(descriptionPreview)}</p>
      </div>

      <div class="review-card-foot">
        <div class="review-card-meta">
          <span>${escapeHTML(item.instructorName || "Unknown instructor")}</span>
          ${
            item.deadline
              ? `<span>Deadline ${escapeHTML(item.deadline)}</span>`
              : `<span>${escapeHTML(courseText)}</span>`
          }
        </div>
        <div class="content-actions">
          <button class="btn btn-small btn-quiet" data-action="details">Details</button>
          <button class="btn btn-small" data-action="approve">Approve</button>
          <button class="btn btn-small btn-danger" data-action="deny">Deny</button>
        </div>
      </div>
    </article>
  `;
}

function renderSection(title, note, items) {
  return `
    <section class="content-review-section">
      <div class="content-review-section-head">
        <div>
          <h3>${escapeHTML(title)}</h3>
          <p>${escapeHTML(note)}</p>
        </div>
        <span class="badge">${items.length} waiting</span>
      </div>
      ${
        items.length
          ? `<div class="content-review-grid">${items.map((item) => renderCard(item)).join("")}</div>`
          : `<div class="empty-state"><strong>No items in this lane</strong><span>New submissions will appear here when available.</span></div>`
      }
    </section>
  `;
}

export function renderContent() {
  const contentList = document.getElementById("contentList");
  const typeFilter = document.getElementById("contentTypeFilter");
  if (!contentList) return;

  const query = state.filters.content.query.trim().toLowerCase();
  const type = state.filters.content.type;

  const pendingOnly = state.pendingContent.filter(
    (item) =>
      normalizeText(item.status) === "pending" &&
      getCategory(item) !== "exam" &&
      getCategory(item) !== "question"
  );
  const dedupedPending = dedupePendingSubmissions(pendingOnly);
  const types = Array.from(new Set(dedupedPending.map((item) => String(item.type || "Unknown")))).sort((left, right) =>
    left.localeCompare(right)
  );

  setSummaryCounts(dedupedPending);

  if (typeFilter) {
    typeFilter.innerHTML = ['<option value="all">All types</option>', ...types.map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)].join("");
    typeFilter.value = types.includes(type) ? type : "all";
  }

  const filtered = dedupedPending.filter((item) => {
    const haystack = `${item.title} ${item.courseTitle || ""} ${item.batchName || ""} ${item.description || ""}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesType = type === "all" || String(item.type) === type;
    return matchesQuery && matchesType;
  });

  if (!filtered.length) {
    contentList.innerHTML = `
      <div class="empty-state">
        <strong>No pending content</strong>
        <span>Pending submissions will appear here.</span>
      </div>
    `;
  } else {
    const announcements = filtered.filter((item) => getCategory(item) === "announcement");
    const resources = filtered.filter((item) => getCategory(item) === "content");

    contentList.innerHTML = [
      renderSection("Pending announcements", "Student-facing notices queued by instructors.", announcements),
      renderSection("Pending study materials", "Notes, links, and learning resources.", resources),
    ].join("");
  }

  contentList.querySelectorAll("[data-content-id]").forEach((node) => {
    const id = Number(node.dataset.contentId || 0);
    const item = filtered.find((entry) => Number(entry.id) === id);
    if (!item) return;

    node.querySelector('[data-action="details"]')?.addEventListener("click", () => showContentDetail(item));

    node.querySelector('[data-action="approve"]')?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "...";
      try {
        const response = await fetch(`${API_BASE_URL}/admin/content/${id}/approve`, { method: "POST" });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.message || "Could not approve content.");
        item.status = "approved";
        renderContent();
        showToast(payload.message || "Approved.", "success");
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });

    node.querySelector('[data-action="deny"]')?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "...";
      try {
        const response = await fetch(`${API_BASE_URL}/admin/content/${id}/deny`, { method: "POST" });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.message || "Could not deny content.");
        item.status = "denied";
        renderContent();
        showToast(payload.message || "Denied.", "success");
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
  });
}
