const { API_BASE_URL, getStudentId, requireRole, setupLogoutHandlers } = window.EduMateShared;

let allCourses = [];

const courseSearchInput = document.querySelector(".search-box input");

const normalize = (value) => String(value || "").trim().toLowerCase();

function updateCourseStats(stats) {
  const statCards = document.querySelectorAll(".stat-row .stat-card");
  if (statCards.length < 3) return;

  statCards[0].innerHTML = `
    <p class="s-label">Active Courses</p>
    <p class="s-val">${stats.activeCourses}</p>
    <p class="s-sub">${stats.activeCourses > 0 ? 'Available' : 'No courses yet'}</p>
  `;

  statCards[1].innerHTML = `
    <p class="s-label">Lessons Completed</p>
    <p class="s-val">${stats.lessonsCompleted}</p>
    <p class="s-sub">${stats.lessonsCompleted > 0 ? 'Completed' : 'Start learning'}</p>
  `;

  statCards[2].innerHTML = `
    <p class="s-label">Average Progress</p>
    <p class="s-val text-primary">${stats.avgProgress}%</p>
    <p class="s-sub">${stats.avgProgress > 50 ? 'Good progress' : 'Keep going'}</p>
  `;
}

function renderCourses(courses) {
  const grid = document.querySelector(".grid");
  if (!grid) return;

  if (!courses || courses.length === 0) {
    grid.innerHTML = '<div class="course-card"><h3>No courses available</h3><p>Courses for your program will appear here once uploaded by instructors.</p></div>';
    return;
  }

  grid.innerHTML = courses.map(course => `
    <div class="course-card">
      <div class="u-flex u-align-center u-space-between u-gap-8">
        <h3>${course.course_title}</h3>
        <span class="chip">${course.content_type}</span>
      </div>
      <p>${course.summary || 'No description available'}</p>
      <div class="course-meta u-flex u-space-between">
        <span>Batch: ${course.batch_name}</span>
        <span>${course.deadline ? `Due: ${new Date(course.deadline).toLocaleDateString()}` : 'No deadline'}</span>
      </div>
      ${course.link ? `<div class="progress"><div class="progress-fill progress-75"></div></div>` : ''}
      <div class="u-flex u-gap-8 u-flex-wrap">
        ${course.link ? `<span class="chip blue">Available</span>` : `<span class="chip amber">Pending</span>`}
      </div>
      ${course.link ? `<a class="btn btn-primary" href="${course.link}" target="_blank">Access Content</a>` : `<a class="btn" href="#">Coming Soon</a>`}
    </div>
  `).join('');
}

async function loadCourses() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/courses`);
    const result = await response.json();

    if (!result.success || !result.data) return;

    const { courses, stats } = result.data;
    allCourses = courses || [];

    updateCourseStats(stats);
    renderCourses(allCourses);
  } catch (error) {
    console.error("Error loading courses:", error);
    const grid = document.querySelector(".grid");
    if (grid) {
      grid.innerHTML = '<div class="course-card"><h3>Error loading courses</h3><p>Please try again later.</p></div>';
    }
  }
}

function applySearch() {
  const searchTerm = normalize(courseSearchInput?.value || "");

  const filteredCourses = allCourses.filter(course => {
    return (
      !searchTerm ||
      normalize(course.title).includes(searchTerm) ||
      normalize(course.summary).includes(searchTerm) ||
      normalize(course.course_title).includes(searchTerm)
    );
  });

  renderCourses(filteredCourses);
}

if (courseSearchInput) {
  courseSearchInput.addEventListener("input", applySearch);
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireRole("student")) return;
  setupLogoutHandlers();
  loadCourses();
});
