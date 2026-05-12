import { API_BASE_URL } from "../shared.js";

function ensureAnimationStyles() {
  const existing = document.getElementById("adminAnimationStyles");
  if (existing) return;
  const style = document.createElement("style");
  style.id = "adminAnimationStyles";
  style.textContent = `
    @keyframes pulseFade {
      0% { opacity: 0.4; transform: translateY(0); }
      50% { opacity: 1; transform: translateY(-2px); }
      100% { opacity: 0.4; transform: translateY(0); }
    }
    .admin-live-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      opacity: 0.85;
    }
    .admin-live-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--accent, #22c55e);
      animation: pulseFade 1.6s infinite;
    }
  `;
  document.head.appendChild(style);
}

function animateValue(element, targetValue, duration = 600) {
  const startValue = Number(element.textContent) || 0;
  const startTime = performance.now();

  const tick = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const current = Math.round(startValue + (targetValue - startValue) * progress);
    element.textContent = String(current);
    if (progress < 1) requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

export async function updateStats() {
  const response = await fetch(`${API_BASE_URL}/admin/overview`);
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error(payload.message || "Could not load overview stats.");
  const data = payload.data || {};

  const userCount = document.getElementById("userCount");
  const newSignupCount = document.getElementById("newSignupCount");
  const reportCount = document.getElementById("reportCount");
  const contentCount = document.getElementById("contentCount");

  if (userCount) animateValue(userCount, Number(data.activeUsers || 0));
  if (newSignupCount) animateValue(newSignupCount, Number(data.newSignups || 0));
  if (reportCount) animateValue(reportCount, Number(data.pendingReports || 0));
  if (contentCount) animateValue(contentCount, Number(data.contentUpdates || 0));

  ensureAnimationStyles();
  return data;
}

let refreshTimer = null;

export function startStatsAutoRefresh() {
  if (refreshTimer) return;
  refreshTimer = window.setInterval(() => updateStats().catch(() => {}), 15000);
}

export function stopStatsAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

