import { API_BASE_URL, escapeHTML } from "../shared.js";
import { state } from "../state.js";

function formatActivityAction(action) {
  const clean = String(action || "").replace(/_/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export async function loadActivityLogs() {
  const response = await fetch(`${API_BASE_URL}/admin/activity-logs`);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.message || "Could not load activity logs.");
  state.activityLogs = payload.data || [];
  return state.activityLogs;
}

export function renderActivityLogs() {
  const list = document.getElementById("activityLogList");
  if (!list) return;

  list.innerHTML = state.activityLogs.length
    ? state.activityLogs
        .map(
          (log) => `
        <li class="activity-item">
          <div>
            <strong>${escapeHTML(formatActivityAction(log.action))}</strong>
            <span>${escapeHTML(log.targetLabel || log.targetType || "")}</span>
          </div>
          <span>${escapeHTML(log.createdAt ? new Date(log.createdAt).toLocaleString() : "")}</span>
        </li>
      `
        )
        .join("")
    : `<li class="activity-item empty-state"><strong>No activity yet</strong><span>Admin actions will appear here.</span></li>`;
}

