const { API_BASE_URL, getStoredUser, getStudentId, escapeHTML, requireRole, getUserRole, setupLogoutHandlers } = window.EduMateShared;

const routineState = {
  studentId: null,
  exams: [],
  nextExam: null,
  notifications: [],
  countdownTimer: null,
  useDemoData: false,
};

const dom = {};

function setText(node, value) {
  if (node) {
    node.textContent = value;
  }
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDurationMs(durationMs) {
  const hours = String(Math.floor(durationMs / 3600000)).padStart(2, "0");
  const minutes = String(Math.floor((durationMs % 3600000) / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((durationMs % 60000) / 1000)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function getStatusClass(status) {
  return `status-${String(status || "upcoming").toLowerCase()}`;
}

function toTitleCase(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

function createEmptyState(message) {
  return `<div class="empty-state">${escapeHTML(message)}</div>`;
}

function buildDemoDate(daysFromNow, hour, minute, durationMinutes) {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return { start, end };
}

function normalizeRoutineExam(exam, now = new Date()) {
  const start = new Date(exam.startTime);
  const end = new Date(exam.endTime);
  const joinWindowMinutes = Number(exam.joinWindowMinutes || 15);
  const joinStart = new Date(start.getTime() - joinWindowMinutes * 60000);

  let status = "completed";
  if (now < start) {
    status = "upcoming";
  } else if (now <= end) {
    status = "ongoing";
  }

  return {
    ...exam,
    status,
    joinAvailable: now >= joinStart && now <= end,
  };
}

function refreshRoutineState(now = new Date()) {
  routineState.exams = routineState.exams.map((exam) => normalizeRoutineExam(exam, now));
  routineState.nextExam =
    routineState.exams.find((exam) => exam.status === "ongoing") ||
    routineState.exams.find((exam) => exam.status === "upcoming") ||
    null;
}

function getWeekExamSummary() {
  const now = Date.now();
  const recentWindowMs = 24 * 60 * 60 * 1000;
  const weekWindowMs = 7 * 24 * 60 * 60 * 1000;
  const exams = routineState.exams.filter((exam) => {
    const diffMs = new Date(exam.startTime).getTime() - now;
    return diffMs >= -recentWindowMs && diffMs <= weekWindowMs;
  });

  return {
    exams,
    upcomingCount: exams.filter((exam) => exam.status === "upcoming").length,
    ongoingCount: exams.filter((exam) => exam.status === "ongoing").length,
  };
}

function getUnreadNotificationCount() {
  return routineState.notifications.filter((item) => item.status === "unread").length;
}

function updateRoutineDisplays() {
  updateHero();
  renderStats();
  renderCalendar();
  renderList();
}

function createDemoRoutine() {
  const physics = buildDemoDate(1, 9, 0, 90);
  const chemistry = buildDemoDate(2, 19, 30, 60);
  const math = buildDemoDate(4, 8, 30, 75);
  const biology = buildDemoDate(-1, 17, 0, 45);

  const exams = [
    {
      id: 201,
      subject: "Physics Mock Test",
      startTime: physics.start.toISOString(),
      endTime: physics.end.toISOString(),
      durationMinutes: 90,
      batchName: "Engineering A",
      instructions: "Join 15 minutes early. Calculator allowed.",
      audienceType: "batch",
      joinWindowMinutes: 15,
      joinUrl: "mock-test.html?demoExam=physics",
    },
    {
      id: 202,
      subject: "Chemistry Drill",
      startTime: chemistry.start.toISOString(),
      endTime: chemistry.end.toISOString(),
      durationMinutes: 60,
      batchName: "Engineering A",
      instructions: "Organic reaction recap and timed MCQ set.",
      audienceType: "specific",
      joinWindowMinutes: 10,
      joinUrl: "mock-test.html?demoExam=chemistry",
    },
    {
      id: 203,
      subject: "Higher Math Speed Test",
      startTime: math.start.toISOString(),
      endTime: math.end.toISOString(),
      durationMinutes: 75,
      batchName: "Engineering A",
      instructions: "Focus on algebra, trigonometry, and short solving.",
      audienceType: "batch",
      joinWindowMinutes: 15,
      joinUrl: "mock-test.html?demoExam=math",
    },
    {
      id: 204,
      subject: "Biology Viva Practice",
      startTime: biology.start.toISOString(),
      endTime: biology.end.toISOString(),
      durationMinutes: 45,
      batchName: "Medical+Versity",
      instructions: "Completed demo oral practice session.",
      audienceType: "specific",
      joinWindowMinutes: 10,
      joinUrl: "mock-test.html?demoExam=biology",
    },
  ];

  const notifications = [
    {
      notification_id: 901,
      title: "24-hour reminder: Physics Mock Test",
      message: "Physics Mock Test starts tomorrow at 9:00 AM.",
      status: "unread",
      sent_at: new Date(Date.now() - 20 * 60000).toISOString(),
    },
    {
      notification_id: 902,
      title: "1-hour reminder: Chemistry Drill",
      message: "Chemistry Drill starts in 1 hour. Keep your notes ready.",
      status: "unread",
      sent_at: new Date(Date.now() - 8 * 60000).toISOString(),
    },
    {
      notification_id: 903,
      title: "Exam completed: Biology Viva Practice",
      message: "Your demo viva practice has been marked completed.",
      status: "read",
      sent_at: new Date(Date.now() - 18 * 60 * 60000).toISOString(),
    },
  ];

  return {
    student: {
      batchName: "Engineering A",
      courseTrack: "Engineering",
    },
    exams,
    notifications,
  };
}

function loadDemoRoutine() {
  const demo = createDemoRoutine();
  routineState.useDemoData = true;
  routineState.exams = demo.exams;
  routineState.notifications = demo.notifications;
  refreshRoutineState();
  setText(dom.studentBatchBadge, `${demo.student.batchName} - ${demo.student.courseTrack} Demo`);
  updateRoutineDisplays();
  renderCountdown();
  renderNotifications();
}

function renderStats() {
  const weekSummary = getWeekExamSummary();
  const nextExam = routineState.nextExam;

  setText(dom.nextExamTitle, nextExam ? nextExam.subject : "No exam");
  setText(
    dom.nextExamMeta,
    nextExam ? `${formatDateTime(nextExam.startTime)} - ${nextExam.batchName || "General"}` : "No active schedule yet"
  );
  setText(dom.weeklyExamCount, `${weekSummary.exams.length} Exam${weekSummary.exams.length === 1 ? "" : "s"}`);
  setText(
    dom.weeklyExamBreakdown,
    weekSummary.exams.length
      ? `${weekSummary.upcomingCount} upcoming, ${weekSummary.ongoingCount} ongoing`
      : "No exam due this week"
  );
  setText(dom.reminderCount, String(getUnreadNotificationCount()));
}

function updateHero() {
  const nextExam = routineState.nextExam;
  if (!dom.heroHeadline || !dom.heroCopy || !dom.heroBatchPill || !dom.heroStatusPill || !dom.heroTip) {
    return;
  }

  setText(dom.heroBatchPill, dom.studentBatchBadge?.textContent || "Batch loading...");

  if (!nextExam) {
    setText(dom.heroHeadline, "No upcoming exam in your routine");
    setText(dom.heroCopy, "Use this page to stay ready when a new schedule is assigned to your batch.");
    setText(dom.heroStatusPill, "Routine clear");
    setText(dom.heroTip, "This is a good time to review older mistakes and keep your study rhythm steady.");
    return;
  }

  setText(
    dom.heroHeadline,
    nextExam.status === "ongoing" ? `${nextExam.subject} is live now` : `${nextExam.subject} is your next exam`
  );
  setText(
    dom.heroCopy,
    `${formatDateTime(nextExam.startTime)} for ${nextExam.batchName || "General batch"} - ${nextExam.durationMinutes} minutes with ${nextExam.joinWindowMinutes} minutes early access.`
  );
  setText(
    dom.heroStatusPill,
    nextExam.status === "ongoing" ? "Join window active" : nextExam.joinAvailable ? "Ready to join soon" : "Upcoming schedule"
  );
  setText(
    dom.heroTip,
    nextExam.status === "ongoing"
      ? "Open the exam, stay focused, and follow the instructions on the card below."
      : nextExam.joinAvailable
        ? "Your join window is open. Enter calmly and double-check the instructions before you begin."
        : "Read the instructions and be ready a few minutes before the join window opens."
  );
}

function stopCountdown() {
  if (routineState.countdownTimer) {
    clearInterval(routineState.countdownTimer);
    routineState.countdownTimer = null;
  }
}

function renderCalendar() {
  if (!dom.calendarGrid) {
    return;
  }

  if (!routineState.exams.length) {
    dom.calendarGrid.innerHTML = createEmptyState("No exams assigned yet.");
    return;
  }

  const grouped = routineState.exams.reduce((accumulator, exam) => {
    const key = new Date(exam.startTime).toDateString();
    accumulator[key] = accumulator[key] || [];
    accumulator[key].push(exam);
    return accumulator;
  }, {});

  dom.calendarGrid.innerHTML = Object.entries(grouped)
    .sort(([leftKey], [rightKey]) => new Date(leftKey).getTime() - new Date(rightKey).getTime())
    .map(([dayKey, exams]) => {
      const date = new Date(dayKey);
      return `
        <article class="calendar-day">
          <div class="calendar-day-header">
            <h3>${date.toLocaleDateString([], { month: "short", day: "numeric" })}</h3>
            <span>${date.toLocaleDateString([], { weekday: "short" })}</span>
          </div>
          <div class="calendar-event-list">
            ${exams
              .map(
                (exam) => `
                  <div class="calendar-event ${getStatusClass(exam.status)}">
                    <h4>${escapeHTML(exam.subject)}</h4>
                    <p>${escapeHTML(formatTime(exam.startTime))} - ${escapeHTML(exam.batchName || "General")}</p>
                    <small>${escapeHTML(toTitleCase(exam.status))} - ${escapeHTML(String(exam.durationMinutes))} min</small>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderList() {
  if (!dom.examRoutineList) {
    return;
  }

  if (!routineState.exams.length) {
    dom.examRoutineList.innerHTML = createEmptyState("No exams in your routine yet.");
    return;
  }

  dom.examRoutineList.innerHTML = routineState.exams
    .map((exam) => {
      const joinLabel = exam.joinAvailable
        ? exam.status === "ongoing"
          ? "Join ongoing exam"
          : "Join exam"
        : `Available ${exam.joinWindowMinutes} min before start`;

      return `
        <article class="routine-card">
          <div class="routine-card-head">
            <div>
              <h3>${escapeHTML(exam.subject)}</h3>
              <p>${escapeHTML(formatDateTime(exam.startTime))}</p>
            </div>
            <span class="routine-status-pill ${getStatusClass(exam.status)}">${escapeHTML(exam.status)}</span>
          </div>
          <div class="routine-card-meta">
            <div class="routine-meta-box">
              <strong>Batch</strong>
              <span>${escapeHTML(exam.batchName || "General")}</span>
            </div>
            <div class="routine-meta-box">
              <strong>Duration</strong>
              <span>${escapeHTML(String(exam.durationMinutes))} minutes</span>
            </div>
            <div class="routine-meta-box">
              <strong>Audience</strong>
              <span>${escapeHTML(exam.audienceType === "specific" ? "Selected students" : "Entire batch")}</span>
            </div>
          </div>
          <p class="routine-card-summary">${escapeHTML(exam.instructions || "No instructions provided.")}</p>
          <div class="routine-card-actions">
            <a class="join-exam-btn${exam.joinAvailable ? "" : " is-disabled"}" href="${exam.joinAvailable ? exam.joinUrl : "#"}">${escapeHTML(joinLabel)}</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderNotifications() {
  const bell = dom.notificationBell;
  if (!dom.notificationList || !bell) {
    return;
  }

  if (!bell.querySelector(".notif-panel")) {
    const panel = document.createElement("div");
    panel.className = "notif-panel";
    panel.innerHTML = `<h3>Notifications</h3><div class="notif-panel-list" id="notifPanelList"></div>`;
    bell.appendChild(panel);

    bell.addEventListener("click", async (event) => {
      event.stopPropagation();
      panel.classList.toggle("is-open");
      if (panel.classList.contains("is-open")) {
        await markNotificationsRead();
      }
    });

    document.addEventListener("click", () => panel.classList.remove("is-open"));
  }

  const content = routineState.notifications.length
    ? routineState.notifications
        .map(
          (item) => `
            <div class="list-item notification-row">
              <div>
                <h4>${escapeHTML(item.title)}</h4>
                <span>${escapeHTML(item.message)}</span>
                <small>${escapeHTML(formatDateTime(item.sent_at || item.created_at))}</small>
              </div>
            </div>
          `
        )
        .join("")
    : createEmptyState("No reminders yet.");

  dom.notificationList.innerHTML = content;

  const panelList = bell.querySelector("#notifPanelList");
  if (panelList) {
    panelList.innerHTML = content;
  }

  if (dom.notificationDot) {
    dom.notificationDot.style.display = getUnreadNotificationCount() ? "block" : "none";
  }
}

function renderCountdown() {
  stopCountdown();

  const tick = () => {
    refreshRoutineState();
    updateRoutineDisplays();

    if (!routineState.nextExam) {
      setText(dom.examCountdown, "--:--:--");
      setText(dom.countdownLabel, "Waiting for the next exam");
      return;
    }

    const now = new Date();
    const start = new Date(routineState.nextExam.startTime);
    const end = new Date(routineState.nextExam.endTime);

    if (now >= start && now <= end) {
      setText(dom.examCountdown, formatDurationMs(end.getTime() - now.getTime()));
      setText(dom.countdownLabel, "Exam in progress");
      return;
    }

    if (now > end) {
      setText(dom.examCountdown, "00:00:00");
      setText(dom.countdownLabel, "This exam window has ended");
      return;
    }

    setText(dom.examCountdown, formatDurationMs(start.getTime() - now.getTime()));
    setText(dom.countdownLabel, routineState.nextExam.joinAvailable ? "Join window is open" : "Time until start");
  };

  tick();
  routineState.countdownTimer = setInterval(tick, 1000);
}

async function markNotificationsRead() {
  if (routineState.useDemoData) {
    routineState.notifications = routineState.notifications.map((item) => ({ ...item, status: "read" }));
    renderNotifications();
    renderStats();
    return;
  }

  const unreadItems = routineState.notifications.filter((item) => item.status === "unread");
  if (!routineState.studentId || !unreadItems.length) {
    return;
  }

  try {
    await Promise.all(
      unreadItems.map((item) =>
        fetch(`${API_BASE_URL}/student/${routineState.studentId}/notifications/${item.notification_id}/read`, {
          method: "PATCH",
        })
      )
    );
  } catch {
    return;
  }

  routineState.notifications = routineState.notifications.map((item) => ({ ...item, status: "read" }));
  renderNotifications();
  renderStats();
}

async function loadRoutine() {
  const response = await fetch(`${API_BASE_URL}/student/${routineState.studentId}/exams`);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Could not load routine.");
  }

  routineState.useDemoData = false;
  routineState.exams = (payload.data?.exams || []).map((exam) => normalizeRoutineExam(exam));
  routineState.nextExam = payload.data?.nextExam ? normalizeRoutineExam(payload.data.nextExam) : null;

  setText(
    dom.studentBatchBadge,
    payload.data?.student?.batchName
      ? `${payload.data.student.batchName} - ${payload.data.student.courseTrack || "Track"}`
      : "Batch not assigned"
  );

  updateRoutineDisplays();
  renderCountdown();
}

async function loadNotifications() {
  if (routineState.useDemoData) {
    renderNotifications();
    renderStats();
    return;
  }

  const response = await fetch(`${API_BASE_URL}/student/${routineState.studentId}/notifications`);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Could not load notifications.");
  }

  routineState.notifications = payload.data?.items || [];
  renderNotifications();
  renderStats();
}

function setupViewToggle() {
  const activate = (view) => {
    const isCalendar = view === "calendar";
    dom.calendarViewBtn.classList.toggle("active", isCalendar);
    dom.listViewBtn.classList.toggle("active", !isCalendar);
    dom.calendarView.classList.toggle("is-hidden", !isCalendar);
    dom.listView.classList.toggle("is-hidden", isCalendar);
  };

  dom.calendarViewBtn.addEventListener("click", () => activate("calendar"));
  dom.listViewBtn.addEventListener("click", () => activate("list"));
}

function cacheDom() {
  dom.nextExamTitle = document.getElementById("nextExamTitle");
  dom.nextExamMeta = document.getElementById("nextExamMeta");
  dom.weeklyExamCount = document.getElementById("weeklyExamCount");
  dom.weeklyExamBreakdown = document.getElementById("weeklyExamBreakdown");
  dom.reminderCount = document.getElementById("reminderCount");
  dom.studentBatchBadge = document.getElementById("studentBatchBadge");
  dom.heroHeadline = document.getElementById("heroHeadline");
  dom.heroCopy = document.getElementById("heroCopy");
  dom.heroBatchPill = document.getElementById("heroBatchPill");
  dom.heroStatusPill = document.getElementById("heroStatusPill");
  dom.heroTip = document.getElementById("heroTip");
  dom.calendarGrid = document.getElementById("calendarGrid");
  dom.examRoutineList = document.getElementById("examRoutineList");
  dom.notificationList = document.getElementById("notificationList");
  dom.notificationBell = document.querySelector(".notif-btn");
  dom.notificationDot = document.querySelector(".notif-dot");
  dom.examCountdown = document.getElementById("examCountdown");
  dom.countdownLabel = document.getElementById("countdownLabel");
  dom.calendarViewBtn = document.getElementById("calendarViewBtn");
  dom.listViewBtn = document.getElementById("listViewBtn");
  dom.calendarView = document.getElementById("calendarView");
  dom.listView = document.getElementById("listView");
}

document.addEventListener("DOMContentLoaded", async () => {
  const currentUser = getStoredUser();
  if (currentUser && getUserRole(currentUser) !== "student") {
    requireRole("student");
    return;
  }

  setupLogoutHandlers();
  routineState.studentId = getStudentId() || "demo-student";

  cacheDom();
  setupViewToggle();

  try {
    await loadRoutine();
    await loadNotifications();
  } catch {
    loadDemoRoutine();
  }
});
