// Student dashboard page script.

const API_BASE_URL = "http://localhost:5000/api";

function toDisplayPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

// Get student ID from localStorage
function getStudentId() {
  const user = JSON.parse(localStorage.getItem("edumateCurrentUser") || localStorage.getItem("user") || "{}");
  return user.id;
}

// Update page header with student name
function updatePageHeader() {
  const user = JSON.parse(localStorage.getItem("edumateCurrentUser") || localStorage.getItem("user") || "{}");
  const heading = document.querySelector(".page-header h1");
  if (heading && user.fullName) {
    heading.textContent = `Welcome back, ${user.fullName}`;
  }
}

// Fetch and display dashboard statistics
async function loadDashboardStats() {
  try {
    const studentId = getStudentId();
    if (!studentId) {
      console.error("Student ID not found");
      return;
    }

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/dashboard`);
    const result = await response.json();

    if (result.success && result.data) {
      const data = result.data;
      const statCards = document.querySelectorAll(".stat-row .stat-card");

      if (statCards.length >= 4) {
        // Update Mock Tests stat
        const mockTestCard = statCards[0];
        mockTestCard.innerHTML = `
          <p class="s-label">Mock Tests</p>
          <p class="s-val">${Number(data.mockTestsCompleted || 0)} Completed</p>
          <p class="s-sub">${Number(data.totalTests || 0)} total attempts</p>
        `;

        // Update Average Score stat
        const avgScoreCard = statCards[1];
        avgScoreCard.innerHTML = `
          <p class="s-label">Average Score</p>
          <p class="s-val text-primary">${toDisplayPercent(data.averageScore)}%</p>
          <p class="s-sub">Best: ${toDisplayPercent(data.bestScore)}%</p>
        `;

        // Update Accuracy stat
        const accuracyCard = statCards[2];
        accuracyCard.innerHTML = `
          <p class="s-label">Accuracy</p>
          <p class="s-val">${toDisplayPercent(data.accuracy)}%</p>
          <p class="s-sub">${Number(data.studyDays || 0)} study days</p>
        `;

        // Update Last Test stat (always overwrite static placeholder)
        const lastTestCard = statCards[3];
        if (data.lastTest) {
          lastTestCard.innerHTML = `
            <p class="s-label">Last Test</p>
            <p class="s-val">${data.lastTest.subject}</p>
            <p class="s-sub">${data.lastTest.name || "Recent test"}</p>
          `;
        } else {
          lastTestCard.innerHTML = `
            <p class="s-label">Last Test</p>
            <p class="s-val">No Data</p>
            <p class="s-sub">Take a mock test to update this.</p>
          `;
        }
      }
    }
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
}

function setupUpcomingExamCards() {
  const upcomingExamCards = document.querySelectorAll(".upcoming-exam-item");
  upcomingExamCards.forEach((card) => {
    const openExam = () => {
      const mockTestId = card.getAttribute("data-mock-test-id");
      if (!mockTestId) return;
      window.location.href = `mock-test.html?openTest=${encodeURIComponent(mockTestId)}`;
    };

    card.style.cursor = "pointer";
    card.addEventListener("click", openExam);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openExam();
      }
    });
  });
}

async function loadUpcomingAndInsights() {
  const studentId = getStudentId();
  if (!studentId) return;

  const upcomingExamList = document.getElementById("upcomingExamList");
  const courseProgressList = document.getElementById("courseProgressList");
  const performanceSnapshotList = document.getElementById("performanceSnapshotList");

  try {
    const [recentTestsRes, subjectsRes] = await Promise.all([
      fetch(`${API_BASE_URL}/student/${studentId}/performance/recent-tests`),
      fetch(`${API_BASE_URL}/student/${studentId}/performance/subjects`),
    ]);
    const recentTestsPayload = await recentTestsRes.json();
    const subjectsPayload = await subjectsRes.json();

    const recentTests = recentTestsPayload.success ? (recentTestsPayload.data || []) : [];
    const subjects = subjectsPayload.success ? (subjectsPayload.data || []) : [];

    if (upcomingExamList) {
      if (recentTests.length > 0) {
        upcomingExamList.innerHTML = recentTests.slice(0, 3).map((test, index) => `
          <div class="list-item upcoming-exam-item" data-mock-test-id="${index % 2 === 0 ? 2 : 8}" role="button" tabindex="0">
            <div>
              <h4>${test.test_name || `${test.subject} Mock Test`}</h4>
              <span>${test.subject} · ${test.test_type || "mock"} · Score ${toDisplayPercent(test.score)}%</span>
            </div>
            <span class="chip">${index === 0 ? "High" : "Upcoming"}</span>
          </div>
        `).join("");
      } else {
        upcomingExamList.innerHTML = `
          <div class="list-item">
            <div><h4>No upcoming exams</h4><span>Take a mock test to generate recommendations.</span></div>
            <span class="chip">New</span>
          </div>
        `;
      }
    }

    if (courseProgressList) {
      if (subjects.length > 0) {
        courseProgressList.innerHTML = subjects.slice(0, 3).map((subject) => `
          <div class="list-item">
            <div>
              <h4>${subject.subject} Practice Track</h4>
              <span>${subject.test_count} tests completed</span>
            </div>
            <span class="chip">${toDisplayPercent(subject.accuracy)}%</span>
          </div>
        `).join("");
      }
    }

    if (performanceSnapshotList) {
      if (subjects.length > 0) {
        const sorted = [...subjects].sort((a, b) => Number(b.accuracy) - Number(a.accuracy));
        const top = sorted[0];
        const weak = sorted[sorted.length - 1];
        performanceSnapshotList.innerHTML = `
          <div class="list-item">
            <div>
              <h4>Top subject</h4>
              <span>${top.subject} - ${toDisplayPercent(top.accuracy)}% average</span>
            </div>
            <span class="chip">Strong</span>
          </div>
          <div class="list-item">
            <div>
              <h4>Needs focus</h4>
              <span>${weak.subject} - target +10% improvement</span>
            </div>
            <span class="chip amber">Priority</span>
          </div>
          <div class="list-item">
            <div>
              <h4>Recent streak</h4>
              <span>${recentTests.length} tests recorded in history</span>
            </div>
            <span class="chip blue">On track</span>
          </div>
        `;
      }
    }
  } catch (error) {
    console.error("Error loading dashboard insights:", error);
  } finally {
    setupUpcomingExamCards();
  }
}

// Initialize dashboard on page load
document.addEventListener("DOMContentLoaded", () => {
  updatePageHeader();
  loadDashboardStats();
  setupUpcomingExamCards();
  loadUpcomingAndInsights();
});
