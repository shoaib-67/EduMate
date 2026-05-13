import { API_BASE_URL, escapeHTML } from "../shared.js";
import { state } from "../state.js";
import { showToast } from "../ui/toast.js";
import { openReportNoteModal } from "../ui/modals.js";

export const REPORT_ACTIONS = {
  resolve: {
    label: "Resolve report",
    actionLabel: "Resolve",
    busyLabel: "…",
    endpoint: "resolve",
    successMessage: "Report resolved.",
  },
  deny: {
    label: "Dismiss report",
    actionLabel: "Close",
    busyLabel: "…",
    endpoint: "deny",
    successMessage: "Report dismissed.",
  },
};

export async function loadReports() {
  const response = await fetch(`${API_BASE_URL}/admin/reports`);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.message || "Could not load reports.");
  state.reports = payload.data || [];
  const reportCount = document.getElementById("reportCount");
  const reportBadge = document.getElementById("reportBadge");
  const openCount = state.reports.filter((r) => String(r.status || "").toLowerCase() === "open").length;
  if (reportCount) reportCount.textContent = String(openCount);
  if (reportBadge) reportBadge.textContent = `${openCount} open`;
  return state.reports;
}

export function renderReports() {
  const container = document.getElementById("reportCards");
  if (!container) return;

  const q = state.filters.reports.query.trim().toLowerCase();
  const status = state.filters.reports.status;
  const priority = state.filters.reports.priority;
  const category = state.filters.reports.category;

  const filtered = state.reports.filter((report) => {
    const matchesQuery = !q || `${report.title} ${report.description}`.toLowerCase().includes(q);
    const matchesStatus = status === "all" || String(report.status || "").toLowerCase() === status;
    const matchesPriority = priority === "all" || String(report.priority || "").toLowerCase() === priority;
    const matchesCategory = category === "all" || String(report.category || "").toLowerCase() === category;
    return matchesQuery && matchesStatus && matchesPriority && matchesCategory;
  });

  const statusColor = (value) => {
    const clean = String(value || "").toLowerCase();
    if (clean === "open") return "chip red";
    if (clean === "completed") return "chip";
    if (clean === "denied") return "chip amber";
    return "chip blue";
  };

  container.innerHTML = filtered.length
    ? filtered
        .map(
          (report) => `
        <article class="report-card" data-report-id="${Number(report.id)}">
          <div class="report-card-head">
            <h3>${escapeHTML(report.title)}</h3>
            <span class="${statusColor(report.status)}">${escapeHTML(report.status)}</span>
          </div>
          <p>${escapeHTML(report.description)}</p>
          <div class="report-meta">
            <span>${escapeHTML(report.category)} · ${escapeHTML(report.priority)}</span>
            <span>${escapeHTML(report.reporterName || "Anonymous")}${report.reporterRole ? ` (${escapeHTML(report.reporterRole)})` : ""}</span>
          </div>
          <div class="report-actions">
            <button class="btn btn-small" data-action="resolve">${REPORT_ACTIONS.resolve.actionLabel}</button>
            <button class="btn btn-small btn-light" data-action="deny">${REPORT_ACTIONS.deny.actionLabel}</button>
          </div>
        </article>
      `
        )
        .join("")
    : `
      <div class="thread empty-state">
        <h4>No reports found</h4>
        <span>Try changing filters.</span>
      </div>
    `;

  container.querySelectorAll("[data-report-id]").forEach((card) => {
    const id = Number(card.dataset.reportId || 0);
    const report = state.reports.find((r) => Number(r.id) === id);
    if (!report) return;

    card.querySelector('[data-action="resolve"]')?.addEventListener("click", (event) => {
      openReportNoteModal({ report, action: REPORT_ACTIONS.resolve, trigger: event.currentTarget });
    });
    card.querySelector('[data-action="deny"]')?.addEventListener("click", (event) => {
      openReportNoteModal({ report, action: REPORT_ACTIONS.deny, trigger: event.currentTarget });
    });
  });
}

export async function submitReport(payload) {
  const response = await fetch(`${API_BASE_URL}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(json.message || "Could not submit report.");
  }
  showToast(json.message || "Report submitted.", "success");
  return json;
}

