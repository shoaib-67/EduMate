const { API_BASE_URL, getStudentId, requireRole, setupLogoutHandlers } = window.EduMateShared;

function getAccuracyColorClass(accuracy) {
  if (accuracy >= 80) return "bar-primary";
  if (accuracy >= 70) return "bar-amber";
  return "bar-red";
}

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

    statCards[2].innerHTML = `
      <p class="s-label">Mock Tests</p>
      <p class="s-val">${data.mockTestsCompleted}</p>
      <p class="s-sub">${data.totalTests} total</p>
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

async function loadSubjectAccuracy() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/performance/subjects`);
    const result = await response.json();
    const subjectList = document.querySelector(".panel-grid .panel:first-child .list");
    if (!subjectList) return;
    subjectList.innerHTML = "";

    if (result.success && result.data && result.data.length > 0) {
      result.data.forEach((subject) => {
        const colorClass = getAccuracyColorClass(subject.accuracy);
        const width = clampPercent(subject.accuracy);

        const listItem = document.createElement("div");
        listItem.className = "list-item";
        listItem.innerHTML = `
          <div>
            <h4>${subject.subject}</h4>
            <span>${subject.test_count} tests taken</span>
          </div>
          <div class="metric">
            <div class="bar"><div class="bar-fill ${colorClass}" style="width: ${width}%;"></div></div>
            <span class="metric-value">${toDisplayPercent(subject.accuracy)}%</span>
          </div>
        `;
        subjectList.appendChild(listItem);
      });
    } else {
      subjectList.innerHTML = '<div class="list-item"><div><h4>No performance data yet</h4><span>Take a mock test to see subject analytics.</span></div><span class="chip">New</span></div>';
    }
  } catch (error) {
    console.error("Error loading subject accuracy:", error);
  }
}

async function loadRecentTests() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/performance/recent-tests`);
    const result = await response.json();
    const panels = document.querySelectorAll(".panel-grid .panel");
    if (panels.length <= 1) return;
    const recentTestsPanel = panels[1];
    const testList = recentTestsPanel.querySelector(".list");
    if (!testList) return;
    testList.innerHTML = "";

    if (result.success && result.data && result.data.length > 0) {
      result.data.slice(0, 3).forEach((test) => {
        const chip = getPerformanceChip(test.score);
        const rankInfo = test.rank ? ` - Rank ${test.rank} of ${test.total_participants}` : "";

        const listItem = document.createElement("div");
        listItem.className = "list-item";
        listItem.innerHTML = `
          <div>
            <h4>${test.test_name || `${test.subject} Test`}</h4>
            <span>Score ${toDisplayPercent(test.score)}%${rankInfo}</span>
          </div>
          <span class="chip ${chip.class}">${chip.text}</span>
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

async function loadTrendAndActions() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const [recentRes, subjectRes] = await Promise.all([
      fetch(`${API_BASE_URL}/student/${studentId}/performance/recent-tests`),
      fetch(`${API_BASE_URL}/student/${studentId}/performance/subjects`),
    ]);
    const recentPayload = await recentRes.json();
    const subjectPayload = await subjectRes.json();
    const recentTests = recentPayload.success ? recentPayload.data || [] : [];
    const subjects = subjectPayload.success ? subjectPayload.data || [] : [];

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

    const nextActionsList = document.getElementById("nextActionsList");
    if (nextActionsList) {
      if (!subjects.length) {
        nextActionsList.innerHTML = '<div class="list-item"><div><h4>No recommendations yet</h4><span>Complete a few mocks first.</span></div><span class="chip">New</span></div>';
      } else {
        const weakSubjects = [...subjects].sort((a, b) => Number(a.accuracy) - Number(b.accuracy)).slice(0, 3);
        nextActionsList.innerHTML = weakSubjects
          .map(
            (subject) => `
              <div class="list-item">
                <div>
                  <h4>${subject.subject} revision</h4>
                  <span>Current accuracy ${toDisplayPercent(subject.accuracy)}% - ${subject.test_count} tests</span>
                </div>
                <a class="action-link" href="mock-test.html">Practice now</a>
              </div>
            `
          )
          .join("");
      }
    }
  } catch (error) {
    console.error("Error loading trends/actions:", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireRole("student")) return;
  setupLogoutHandlers();
  loadPerformanceStats();
  loadSubjectAccuracy();
  loadRecentTests();
  loadTrendAndActions();
});
