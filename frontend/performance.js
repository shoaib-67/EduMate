const { API_BASE_URL, getStudentId, requireRole, setupLogoutHandlers } = window.EduMateShared;

function getPerformanceChip(score) {
  if (score >= 80) return { class: "", text: "Strong" };
  if (score >= 70) return { class: "amber", text: "Good" };
  if (score >= 60) return { class: "blue", text: "Improve" };
  return { class: "red", text: "Focus" };
}

function toDisplayPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function formatAttemptTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Time unavailable";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function loadPerformanceStats() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const dashboardResponse = await fetch(`${API_BASE_URL}/student/${studentId}/dashboard`);
    const dashboardResult = await dashboardResponse.json();
    if (!dashboardResult.success || !dashboardResult.data) return;

    const data = dashboardResult.data;
    const statCards = document.querySelectorAll(".stat-row .stat-card");
    if (statCards.length < 4) return;

    statCards[0].classList.add("highlight");
    statCards[0].innerHTML = `
      <p class="s-label">Average Score</p>
      <p class="s-val">${toDisplayPercent(data.averageScore)}%</p>
      <p class="s-sub">Up 6% in 30 days</p>
    `;

    statCards[1].innerHTML = `
      <p class="s-label">Best Score</p>
      <p class="s-val">${toDisplayPercent(data.bestScore)}%</p>
      <p class="s-sub">Latest achievement</p>
    `;

    const completedMocks = Number(data.completedMocks ?? data.mockTestsCompleted ?? 0);
    const totalAttempts = Number(data.totalAttempts ?? data.totalTests ?? 0);
    statCards[2].innerHTML = `
      <p class="s-label">Mock Tests</p>
      <p class="s-val">${completedMocks}</p>
      <p class="s-sub">${totalAttempts} total</p>
    `;

    statCards[3].innerHTML = `
      <p class="s-label">Accuracy</p>
      <p class="s-val">${toDisplayPercent(data.accuracy)}%</p>
      <p class="s-sub">${Number(data.bestScore || 0) >= 80 ? "Physics is strongest" : "Keep practicing"}</p>
    `;
  } catch (error) {
    console.error("Error loading performance stats:", error);
  }
}

async function loadRecentTests() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/performance/recent-tests`);
    const result = await response.json();
    const recentTestsPanel = document.querySelector(".panel-grid .panel");
    if (!recentTestsPanel) return;
    const testList = recentTestsPanel.querySelector(".list");
    if (!testList) return;
    testList.innerHTML = "";

    if (result.success && result.data && result.data.length > 0) {
      result.data.forEach((test) => {
        const chip = getPerformanceChip(test.score);
        const rankInfo = test.rank ? ` - Rank ${test.rank} of ${test.total_participants}` : "";
        const attemptTime = formatAttemptTime(test.created_at);

        const listItem = document.createElement("div");
        listItem.className = "list-item";
        listItem.innerHTML = `
          <div>
            <h4>${test.test_name || `${test.subject} Test`}</h4>
            <span>Score ${toDisplayPercent(test.score)}%${rankInfo}</span>
          </div>
          <div class="chip-stack">
            <span class="chip ${chip.class}">${chip.text}</span>
            <span class="chip-time">${attemptTime}</span>
          </div>
        `;
        testList.appendChild(listItem);
      });
    } else {
      testList.innerHTML = '<div class="list-item"><div><h4>No recent tests</h4><span>Your latest tests will appear here.</span></div><span class="chip">Pending</span></div>';
    }
  } catch (error) {
    console.error("Error loading recent tests:", error);
  }
}

async function loadTrend() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const recentRes = await fetch(`${API_BASE_URL}/student/${studentId}/performance/recent-tests`);
    const recentPayload = await recentRes.json();
    const recentTests = recentPayload.success ? recentPayload.data || [] : [];

    const trendChart = document.getElementById("scoreTrendChart");
    if (trendChart) {
      if (!recentTests.length) {
        trendChart.innerHTML = '<div class="list-item"><div><h4>No trend yet</h4><span>Take tests to build a trend.</span></div></div>';
      } else {
        trendChart.innerHTML = recentTests
          .slice(0, 5)
          .reverse()
          .map((test) => {
            const score = clampPercent(test.score);
            return `
              <div class="trend-row">
                <span class="trend-label">${test.test_name || test.subject || "Test"}</span>
                <div class="trend-bar"><div class="trend-fill" style="width: ${score}%;"></div></div>
                <span class="metric-value">${toDisplayPercent(score)}%</span>
              </div>
            `;
          })
          .join("");
      }
    }

  } catch (error) {
    console.error("Error loading trend:", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireRole("student")) return;
  setupLogoutHandlers();
  loadPerformanceStats();
  loadRecentTests();
  loadTrend();
});
