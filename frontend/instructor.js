const { API_BASE_URL, getStoredUser, escapeHTML, requireRole, setupLogoutHandlers } = window.EduMateShared;

const state = {
  instructorId: null,
  feedbackTimer: null,
  selectedExamQuestionIds: new Set(),
  examDraftQuestions: [],
  draftQuestionCounter: 0,
  workspace: {
    stats: { courseCount: 0, publishedExamCount: 0, managedStudentCount: 0, batchAverageScore: 0 },
    courseContent: [],
    questionBank: [],
    exams: [],
    students: [],
    communications: [],
    alerts: [],
    coursePerformance: [],
    scoreDistribution: [],
  },
};

function $(selector) {
  return document.querySelector(selector);
}

function getStatusChipClass(score) {
  if (score >= 80) return "chip";
  if (score >= 65) return "chip blue";
  if (score >= 50) return "chip amber";
  return "chip red";
}

function showConflict(message = "") {
  const banner = $("#conflictBanner");
  if (!banner) return;
  if (message) {
    banner.textContent = message;
    banner.classList.remove("is-hidden");
  } else {
    banner.textContent = "";
    banner.classList.add("is-hidden");
  }
}

function showBanner(message, type = "info", persistent = false) {
  const banner = $("#workspaceBanner");
  const healthBadge = $("#workspaceHealthBadge");
  if (!banner) return;

  banner.textContent = message;
  banner.className = `workspace-banner is-visible is-${type}`;

  if (healthBadge) {
    healthBadge.textContent =
      type === "error" ? "Connection issue" : type === "success" ? "Workspace ready" : "Workspace update";
  }

  if (state.feedbackTimer) {
    clearTimeout(state.feedbackTimer);
    state.feedbackTimer = null;
  }

  if (!persistent) {
    state.feedbackTimer = window.setTimeout(() => {
      banner.className = "workspace-banner";
      banner.textContent = "";
    }, 3600);
  }
}

function renderEmptyCard(title, note) {
  return `<div class="empty-card"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(note)}</span></div>`;
}

function formatExamMoment(exam) {
  const date = String(exam?.date || "").trim();
  const time = String(exam?.time || "").trim();
  return [date, time].filter(Boolean).join(" ");
}

function getNextExam(exams) {
  const now = Date.now();
  return exams
    .map((exam) => ({
      ...exam,
      startsAt:
        exam.accessMode === "open_anytime"
          ? now
          : Date.parse(`${exam.date}T${exam.time || "00:00"}`),
    }))
    .filter((exam) => Number.isFinite(exam.startsAt) && (exam.accessMode === "open_anytime" || exam.startsAt >= now))
    .sort((left, right) => left.startsAt - right.startsAt)[0] || null;
}

function buildAttentionItems() {
  const exams = state.workspace.exams || [];
  const alerts = state.workspace.alerts || [];
  const coursePerformance = state.workspace.coursePerformance || [];
  const upcoming = exams.filter((exam) => exam.status === "Upcoming");
  const drafts = exams.filter((exam) => exam.state === "Draft");
  const urgentAlerts = alerts.filter((item) => item.level === "urgent");

  return [
    {
      title: `${upcoming.length} upcoming exam${upcoming.length === 1 ? "" : "s"}`,
      note: upcoming.length ? "Check access windows and publishing state before the next batch sits." : "No upcoming exams are waiting on you right now.",
    },
    {
      title: `${coursePerformance.length} course-level metric${coursePerformance.length === 1 ? "" : "s"} ready`,
      note: coursePerformance.length ? "Real-time scores and pass rates are available for your active subjects." : "Course analytics will appear after students complete exams.",
    },
    {
      title: `${urgentAlerts.length} urgent alert${urgentAlerts.length === 1 ? "" : "s"}`,
      note: urgentAlerts.length ? "Submissions, violations, or questions need a fast look." : "Nothing urgent is flashing at the moment.",
    },
    {
      title: `${drafts.length} draft exam${drafts.length === 1 ? "" : "s"}`,
      note: drafts.length ? "Preview and publish when the schedule is confirmed." : "No draft exams are waiting to be published.",
    },
  ];
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const error = new Error(payload.message || "Request failed.");
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadWorkspace({ silent = false } = {}) {
  if (!silent) {
    showBanner("Refreshing instructor workspace data.", "info", true);
  }
  const payload = await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/workspace`);
  state.workspace = payload.data || state.workspace;
  renderAll();
  if (!silent) {
    showBanner("Instructor workspace is up to date.", "success");
  }
}

function renderStats() {
  const stats = state.workspace.stats || {};
  $("#courseCount").textContent = String(stats.courseCount || 0);
  $("#publishedExamCount").textContent = String(stats.publishedExamCount || 0);
  $("#managedStudentCount").textContent = String(stats.managedStudentCount || 0);
  $("#batchAverageScore").textContent = `${Number(stats.batchAverageScore || 0)}%`;
}

function renderWorkspaceOverview() {
  const exams = state.workspace.exams || [];
  const alerts = state.workspace.alerts || [];
  const nextExam = getNextExam(exams);
  const urgentAlerts = alerts.filter((item) => item.level === "urgent").length;
  const drafts = exams.filter((exam) => exam.state === "Draft").length;
  const nextExamLabel = nextExam
    ? nextExam.accessMode === "open_anytime"
      ? "Open anytime"
      : formatExamMoment(nextExam)
    : "";

  $("#workspaceHeadline").textContent = nextExam
    ? `Next exam: ${nextExam.title}`
    : "No upcoming exams on the board";
  $("#workspaceSummary").textContent = nextExam
    ? `${nextExam.batch} ${nextExam.accessMode === "open_anytime" ? "is available anytime." : `is scheduled for ${formatExamMoment(nextExam)}.`} Keep the access mode, rules, and publish state aligned before students arrive.`
    : "Your batches are clear right now. This is a good moment to upload materials, clear grading, or set the next mock test.";
  $("#nextExamPill").textContent = nextExam
    ? `${nextExam.batch} · ${nextExamLabel}`
    : "No scheduled upcoming exam";
  $("#attentionPill").textContent = urgentAlerts
    ? `${urgentAlerts} urgent alert${urgentAlerts === 1 ? "" : "s"} to review`
    : drafts
      ? `${drafts} draft exam${drafts === 1 ? "" : "s"} waiting to publish`
      : "No urgent blockers";

  $("#attentionList").innerHTML = buildAttentionItems()
    .map(
      (item) => `
        <div class="attention-item">
          <strong>${escapeHTML(item.title)}</strong>
          <span>${escapeHTML(item.note)}</span>
        </div>
      `
    )
    .join("");
}

function renderCourseContent() {
  const items = state.workspace.courseContent || [];
  $("#courseContentList").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(item.title)}</h4>
            <span>${escapeHTML(item.course)} - ${escapeHTML(item.batch)} - ${escapeHTML(item.type)}</span>
            <span>${escapeHTML(item.summary)}</span>
            ${item.link ? `<span>Link: <a href="${escapeHTML(item.link)}" target="_blank">${escapeHTML(item.link)}</a></span>` : ""}
            <span>${item.deadline ? `Deadline: ${escapeHTML(item.deadline)}` : "No deadline"}</span>
          </div>
          <span class="chip">${escapeHTML(item.type)}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No study materials yet", "Your course items will show up here once you upload the first PDF, note, assignment, or announcement.");
}

function renderQuestionBank() {
  const items = state.workspace.questionBank || [];
  const validIds = new Set(
    items
      .map((item) => Number(item.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  state.selectedExamQuestionIds.forEach((id) => {
    if (!validIds.has(id)) state.selectedExamQuestionIds.delete(id);
  });

  $("#questionBankList").innerHTML = items.length
    ? items
        .map(
          (item, index) => `
        <div class="list-item">
          <div>
            <h4>Q${index + 1} - ${escapeHTML(item.subject)} (${escapeHTML(item.type)})</h4>
            <span>Audience: ${escapeHTML(item.batchName || "General")}</span>
            <span>${escapeHTML(item.text)}</span>
            <span>${escapeHTML(item.options || "No option text provided")}</span>
            <span>Answer key: ${escapeHTML(item.answerKey)}</span>
          </div>
          <div class="list-item-actions">
            <span class="chip blue">${escapeHTML(item.type)}</span>
            <span class="chip ${
              item.approvalStatus === "approved"
                ? ""
                : item.approvalStatus === "denied"
                  ? "red"
                  : "amber"
            }">${escapeHTML(item.approvalStatus || "pending")}</span>
            ${
              String(item.type || "").toLowerCase() === "mcq"
                ? `<button class="btn btn-sm ${state.selectedExamQuestionIds.has(Number(item.id)) ? "btn-primary" : ""}" type="button" onclick="toggleExamQuestionSelection(${Number(item.id)})">${state.selectedExamQuestionIds.has(Number(item.id)) ? "Selected" : "Select"}</button>`
                : ""
            }
          </div>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("Question bank is empty", "Add reusable MCQ, short answer, or essay items so new exams are faster to assemble.");

  updateSelectedQuestionMeta();
}

function updateSelectedQuestionMeta() {
  const countNode = $("#selectedQuestionCount");
  if (!countNode) return;
  const bankCount = state.selectedExamQuestionIds.size;
  const draftCount = state.examDraftQuestions.length;
  const total = bankCount + draftCount;
  countNode.textContent = String(total);
  const metaNode = $("#draftQuestionMeta");
  if (metaNode) {
    metaNode.textContent = `(${draftCount} draft, ${bankCount} from bank)`;
  }
  const finalSubmitBtn = $("#finalExamSubmitBtn");
  if (finalSubmitBtn) {
    finalSubmitBtn.disabled = total < 1;
  }
}

function renderExamDraftQuestions() {
  const draftItems = state.examDraftQuestions || [];
  const node = $("#examDraftQuestionList");
  if (!node) return;

  node.innerHTML = draftItems.length
    ? draftItems
        .map(
          (item, index) => `
        <div class="list-item">
          <div>
            <h4>Draft Q${index + 1} - ${escapeHTML(item.subject)} (${escapeHTML(item.type)})</h4>
            <span>Batch: ${escapeHTML(item.batchName || "General")}</span>
            <span>${escapeHTML(item.text)}</span>
            <span>${escapeHTML(item.previewOptions || "No option text provided")}</span>
            <span>Answer key: ${escapeHTML(item.answerKey)}</span>
          </div>
          <div class="list-item-actions">
            <span class="chip amber">Draft</span>
            <button class="btn btn-sm" type="button" onclick="removeDraftQuestion(${Number(item.localId)})">Remove</button>
          </div>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No draft questions yet", "Add questions above. They will appear here and go to admin when you submit the mock test.");

  updateSelectedQuestionMeta();
}

function toggleExamQuestionSelection(questionId) {
  const id = Number(questionId);
  if (!Number.isInteger(id) || id <= 0) return;
  if (state.selectedExamQuestionIds.has(id)) state.selectedExamQuestionIds.delete(id);
  else state.selectedExamQuestionIds.add(id);
  renderQuestionBank();
}

function clearExamQuestionSelection() {
  state.selectedExamQuestionIds.clear();
  renderQuestionBank();
}

function removeDraftQuestion(localId) {
  const cleanId = Number(localId);
  if (!Number.isInteger(cleanId) || cleanId <= 0) return;
  state.examDraftQuestions = state.examDraftQuestions.filter((item) => Number(item.localId) !== cleanId);
  renderExamDraftQuestions();
}

function clearDraftQuestions() {
  state.examDraftQuestions = [];
  renderExamDraftQuestions();
}

function renderExams() {
  const exams = state.workspace.exams || [];
  $("#examList").innerHTML = exams.length
    ? exams
        .map(
          (exam) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(exam.title)}</h4>
            <span>${escapeHTML(exam.batch)} - ${escapeHTML(exam.examType)} - ${escapeHTML(exam.accessMode === "open_anytime" ? "Available anytime" : `${exam.date} ${exam.time}`)}</span>
            <span>${escapeHTML(String(exam.duration))} min · ${escapeHTML(exam.accessMode === "open_anytime" ? "Open anytime" : "Scheduled")} · ${escapeHTML(exam.shuffleMode)}</span>
            <span>${escapeHTML(exam.rules || "No extra rules added.")}</span>
          </div>
          <div class="list-item-actions">
            <span class="chip ${exam.state === "Published" ? "" : exam.state === "Draft" ? "amber" : "blue"}">${escapeHTML(exam.state)}</span>
            <span class="chip ${exam.status === "Upcoming" ? "blue" : exam.status === "Ongoing" ? "" : "red"}">${escapeHTML(exam.status)}</span>
          </div>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No exams created yet", "Create a mock test or assignment quiz to start filling the assessment board.");
}

function renderStudents() {
  const students = state.workspace.students || [];
  $("#studentTableBody").innerHTML = students.length
    ? students
        .map(
          (student) => `
        <tr>
          <td>${escapeHTML(student.name)}</td>
          <td>${escapeHTML(student.batch)}</td>
          <td>${escapeHTML(student.progress)}</td>
          <td><span class="${getStatusChipClass(Number(student.score || 0))}">${escapeHTML(String(student.score || 0))}%</span></td>
          <td>${escapeHTML(student.note)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="5">${renderEmptyCard("No assigned students yet", "Student profiles and progress rows will appear here when the batch roster is available.")}</td></tr>`;
}

function renderAnalytics() {
  const scoreDistribution = state.workspace.scoreDistribution || [];
  const coursePerformance = state.workspace.coursePerformance || [];

  $("#distributionList").innerHTML = scoreDistribution.length
    ? scoreDistribution
        .map((item) => `<div class="list-item"><div><h4>${escapeHTML(item.band)}</h4><span>Students in this range</span></div><span class="chip">${escapeHTML(String(item.count || 0))}</span></div>`)
        .join("")
    : renderEmptyCard("No score distribution yet", "Once students take an objective exam, performance bands will appear here.");

  $("#coursePerformanceList").innerHTML = coursePerformance.length
    ? coursePerformance
        .map((item) => `<div class="list-item"><div><h4>${escapeHTML(item.course)}</h4><span>Avg ${escapeHTML(String(item.averageScore || 0))}% from ${escapeHTML(String(item.assessments || 0))} records</span><span>Top ${escapeHTML(String(item.topScore || 0))}% · Low ${escapeHTML(String(item.bottomScore || 0))}%</span></div><span class="chip ${getStatusChipClass(Number(item.averageScore || 0))}">${escapeHTML(String(item.passRate || 0))}% pass</span></div>`)
        .join("")
    : renderEmptyCard("No course performance data yet", "Student assessments will populate this panel automatically.");

  $("#passRateList").innerHTML = coursePerformance.length
    ? coursePerformance
        .map((item) => `<div class="list-item"><div><h4>${escapeHTML(item.course)}</h4><span>${escapeHTML(String(item.assessments || 0))} scored · ${escapeHTML(String(item.passRate || 0))}% pass rate</span></div></div>`)
        .join("")
    : renderEmptyCard("No pass rate data yet", "Course pass rates appear once test scores are recorded for your batches.");
}

function renderCommunications() {
  const items = state.workspace.communications || [];
  $("#communicationList").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(item.title)}</h4>
            <span>${escapeHTML(item.type)} - ${escapeHTML(item.audience)}</span>
            <span>${escapeHTML(item.body)}</span>
          </div>
          <span class="chip blue">${escapeHTML(item.type)}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No messages posted yet", "Announcements, discussion starters, and direct notices will appear here after you send them.");
}

function renderAlerts() {
  const items = state.workspace.alerts || [];
  $("#alertList").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(item.title)}</h4>
            <span>${escapeHTML(item.note)}</span>
          </div>
          <span class="chip ${item.level === "urgent" ? "red" : "blue"}">${item.level === "urgent" ? "Urgent" : "Info"}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No active alerts", "Submission events, student questions, and exam reminders will show up here.");
}

function renderAll() {
  renderWorkspaceOverview();
  renderStats();
  renderCourseContent();
  renderQuestionBank();
  renderExamDraftQuestions();
  renderExams();
  renderStudents();
  renderAnalytics();
  renderCommunications();
  renderAlerts();
}

async function submitForm(button, task) {
  const originalLabel = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  try {
    await task();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

async function handleCourseSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  await submitForm(submitButton, async () => {
    await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/course-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        course: String(formData.get("courseTitle") || "").trim(),
        type: String(formData.get("contentType") || "").trim(),
        audienceType: String(formData.get("courseAudienceType") || "batch").trim(),
        batchName: String(formData.get("courseBatch") || "").trim(),
        title: String(formData.get("contentTitle") || "").trim(),
        summary: String(formData.get("contentSummary") || "").trim(),
        deadline: String(formData.get("contentDeadline") || "").trim(),
        link: String(formData.get("contentLink") || "").trim(),
      }),
    });
    event.currentTarget.reset();
    $("#linkField").style.display = "block";
    $("#contentLink").required = true;
    $("#courseAudienceType")?.dispatchEvent(new Event("change"));
    await loadWorkspace();
    showBanner("Course content uploaded and sent to admin for approval.", "success");
  });
}

async function handleExamSubmit(event) {
  event.preventDefault();
  showConflict("");
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const selectedQuestionIds = Array.from(state.selectedExamQuestionIds);
  const draftQuestions = [...state.examDraftQuestions];
  if (!selectedQuestionIds.length && !draftQuestions.length) {
    showBanner("Add at least one question (draft or question bank) before submitting this mock test.", "error");
    return;
  }

  const accessMode = String(formData.get("accessMode") || "scheduled").trim();
  const date = String(formData.get("examDate") || "").trim();
  const time = String(formData.get("examTime") || "").trim();
  const endTime = String(formData.get("examEndTime") || "").trim();
  const subject = String(formData.get("examSubject") || "").trim();
  const perMcqMark = Number(formData.get("perMcqMark") || 0);
  const durationFromForm = Number(formData.get("examDuration") || 0);
  let durationToSend = durationFromForm;

  if (accessMode === "scheduled" && (!date || !time)) {
    showBanner("Scheduled exams require a date and time.", "error");
    return;
  }
  if (!Number.isFinite(durationToSend) || durationToSend <= 0) {
    showBanner("Duration must be greater than 0.", "error");
    return;
  }
  if (accessMode === "scheduled" && endTime) {
    const startDate = parseLocalDateTime(date, time);
    const manualEndDate = parseLocalDateTime(date, endTime);
    if (!startDate || !manualEndDate) {
      showBanner("End time is invalid.", "error");
      return;
    }
    if (manualEndDate <= startDate) manualEndDate.setDate(manualEndDate.getDate() + 1);
    const computedMinutes = Math.round((manualEndDate.getTime() - startDate.getTime()) / 60000);
    if (!Number.isFinite(computedMinutes) || computedMinutes <= 0) {
      showBanner("End time must be after start time.", "error");
      return;
    }
    durationToSend = computedMinutes;
  }
  if (!subject) {
    showBanner("Subject is required.", "error");
    return;
  }
  if (!Number.isFinite(perMcqMark) || perMcqMark <= 0) {
    showBanner("Per MCQ mark must be greater than 0.", "error");
    return;
  }

  try {
    await submitForm(submitButton, async () => {
      const createdQuestionIds = [];

      for (const draftQuestion of draftQuestions) {
        const questionPayload = await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/question-bank`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: draftQuestion.subject,
            type: draftQuestion.type,
            audienceType: draftQuestion.audienceType,
            batchName: draftQuestion.batchName,
            text: draftQuestion.text,
            options: draftQuestion.options,
            mcqOptions: draftQuestion.mcqOptions,
            answerKey: draftQuestion.answerKey,
            skipSubmission: true,
          }),
        });

        const createdQuestionId = Number(questionPayload?.data?.questionId || 0);
        if (createdQuestionId > 0) {
          createdQuestionIds.push(createdQuestionId);
        }
      }

      const finalQuestionIds = [...selectedQuestionIds, ...createdQuestionIds];
      await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/exams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(formData.get("examTitle") || "").trim(),
          subject,
          audienceType: String(formData.get("examAudienceType") || "batch").trim(),
          batchName: String(formData.get("examBatch") || "").trim(),
          accessMode,
          date: accessMode === "scheduled" ? date : "",
          time: accessMode === "scheduled" ? time : "",
          endTime: accessMode === "scheduled" ? endTime : "",
          duration: durationToSend,
          negativeMarking: String(formData.get("negativeMarking") || "").trim(),
          perMcqMark,
          shuffleMode: String(formData.get("shuffleMode") || "").trim(),
          examType: String(formData.get("examType") || "").trim(),
          state: String(formData.get("publishState") || "").trim(),
          rules: String(formData.get("examRules") || "").trim(),
          questionIds: finalQuestionIds,
        }),
      });
      event.currentTarget.reset();
      state.selectedExamQuestionIds.clear();
      state.examDraftQuestions = [];
      const questionForm = $("#questionBankForm");
      questionForm?.reset();
      const endInput = $("#examEndTime");
      if (endInput) endInput.dataset.manual = "false";
      syncExamEndTimePreview(true);
      $("#questionType")?.dispatchEvent(new Event("change"));
      await loadWorkspace();
      showBanner("Mock test and questions sent to admin for approval.", "success");
    });
  } catch (error) {
    throw error;
  }
}

async function handleQuestionSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const type = String(formData.get("questionType") || "").trim();
  const normalizedType = type.toLowerCase();

  const audienceType = "batch";
  const batchName = String($("#examBatch")?.value || "").trim();
  const subject = String($("#examSubject")?.value || "").trim();
  if (!subject) {
    showBanner("Set exam subject first, then add questions.", "error");
    return;
  }
  if (!batchName) {
    showBanner("Set exam batch first, then add questions.", "error");
    return;
  }

  let optionsPayload = "";
  let answerKeyPayload = "";
  let mcqOptionsPayload = [];

  if (normalizedType === "mcq") {
    const optionKeys = ["questionOptionA", "questionOptionB", "questionOptionC", "questionOptionD"];
    const rawOptions = optionKeys
      .map((key) => String(formData.get(key) || "").trim())
      .filter(Boolean);

    if (rawOptions.length < 2) {
      showBanner("Please provide at least two MCQ options.", "error");
      return;
    }

    const answerOption = String(formData.get("questionAnswerOption") || "").trim().toUpperCase();
    if (!["A", "B", "C", "D"].includes(answerOption)) {
      showBanner("Please select a correct option for this MCQ.", "error");
      return;
    }

    optionsPayload = rawOptions.join(" | ");
    answerKeyPayload = answerOption;
    mcqOptionsPayload = rawOptions;
  } else {
    const rubricText = String(formData.get("nonMcqAnswer") || "").trim();
    if (!rubricText) {
      showBanner("Please add an expected answer or rubric for non-MCQ questions.", "error");
      return;
    }
    optionsPayload = rubricText;
    answerKeyPayload = rubricText;
  }

  await submitForm(submitButton, async () => {
    state.draftQuestionCounter += 1;
    state.examDraftQuestions.push({
      localId: state.draftQuestionCounter,
      subject,
      type,
      audienceType,
      batchName,
      text: String(formData.get("questionText") || "").trim(),
      options: optionsPayload,
      mcqOptions: mcqOptionsPayload,
      answerKey: answerKeyPayload,
      previewOptions: optionsPayload,
    });

    event.currentTarget.reset();
    $("#questionType")?.dispatchEvent(new Event("change"));
    renderExamDraftQuestions();
    showBanner("Question added to this mock test draft.", "success");
  });
}

async function handleStudentActionSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  await submitForm(submitButton, async () => {
    await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/student-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentName: String(formData.get("studentName") || "").trim(),
        batch: String(formData.get("studentBatch") || "").trim(),
        action: String(formData.get("studentAction") || "").trim(),
        progress: String(formData.get("studentProgress") || "").trim(),
        note: String(formData.get("studentMessage") || "").trim(),
      }),
    });
    event.currentTarget.reset();
    await loadWorkspace();
    showBanner("Student action recorded for this batch.", "success");
  });
}

async function handleCommunicationSubmit(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  await submitForm(submitButton, async () => {
    await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: String(formData.get("messageType") || "").trim(),
        audience: String(formData.get("messageAudience") || "").trim(),
        title: String(formData.get("messageTitle") || "").trim(),
        body: String(formData.get("messageBody") || "").trim(),
      }),
    });
    event.currentTarget.reset();
    await loadWorkspace();
    showBanner("Message posted to the communication hub.", "success");
  });
}

function syncBatchGroupVisibility(audienceSelectId, batchGroupId, batchInputId) {
  const audienceSelect = $(audienceSelectId);
  const batchGroup = $(batchGroupId);
  const batchInput = $(batchInputId);
  if (!audienceSelect || !batchGroup || !batchInput) return;

  const isAllBatches = String(audienceSelect.value || "batch").toLowerCase() === "all";
  batchGroup.classList.toggle("is-hidden", isAllBatches);
  batchInput.required = !isAllBatches;
}

function syncQuestionComposerMode() {
  const questionType = String($("#questionType")?.value || "MCQ").trim().toLowerCase();
  const isMcq = questionType === "mcq";

  $("#mcqEditorGroup")?.classList.toggle("is-hidden", !isMcq);
  $("#nonMcqAnswerGroup")?.classList.toggle("is-hidden", isMcq);

  ["#questionOptionA", "#questionOptionB", "#questionOptionC", "#questionOptionD"].forEach((selector) => {
    const input = $(selector);
    if (input) input.required = isMcq;
  });

  const answerSelect = $("#questionAnswerOption");
  if (answerSelect) answerSelect.required = isMcq;

  const nonMcqAnswer = $("#nonMcqAnswer");
  if (nonMcqAnswer) nonMcqAnswer.required = !isMcq;
}

function parseLocalDateTime(dateValue, timeValue) {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();
  if (!date || !time) return null;
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  const parsed = new Date(`${date}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimeInputValue(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function syncExamEndTimePreview(force = false) {
  const dateInput = $("#examDate");
  const startTimeInput = $("#examTime");
  const durationInput = $("#examDuration");
  const endTimeInput = $("#examEndTime");
  if (!dateInput || !startTimeInput || !durationInput || !endTimeInput) return;

  const date = String(dateInput.value || "").trim();
  const time = String(startTimeInput.value || "").trim();
  const duration = Number(durationInput.value || 0);

  if (!date || !time || !Number.isFinite(duration) || duration <= 0) {
    if (force) endTimeInput.value = "";
    return;
  }

  const start = parseLocalDateTime(date, time);
  if (!start) {
    if (force) endTimeInput.value = "";
    return;
  }

  const end = new Date(start.getTime() + duration * 60000);
  if (force || endTimeInput.dataset.manual !== "true" || !String(endTimeInput.value || "").trim()) {
    endTimeInput.value = formatTimeInputValue(end);
    endTimeInput.dataset.manual = "false";
  }
}

function syncDurationFromEndTime() {
  const date = String($("#examDate")?.value || "").trim();
  const startTime = String($("#examTime")?.value || "").trim();
  const endTime = String($("#examEndTime")?.value || "").trim();
  const durationInput = $("#examDuration");
  if (!durationInput || !date || !startTime || !endTime) return;

  const start = parseLocalDateTime(date, startTime);
  const end = parseLocalDateTime(date, endTime);
  if (!start || !end) return;
  if (end <= start) end.setDate(end.getDate() + 1);

  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (Number.isFinite(diffMinutes) && diffMinutes > 0) {
    durationInput.value = String(diffMinutes);
  }
}

function bindEvents() {
  $("#courseAudienceType")?.addEventListener("change", () => {
    syncBatchGroupVisibility("#courseAudienceType", "#courseBatchGroup", "#courseBatch");
  });
  $("#examDate")?.addEventListener("change", () => syncExamEndTimePreview(true));
  $("#examTime")?.addEventListener("change", () => syncExamEndTimePreview(true));
  $("#examDuration")?.addEventListener("input", () => syncExamEndTimePreview(false));
  $("#examEndTime")?.addEventListener("input", () => {
    const endInput = $("#examEndTime");
    if (endInput) endInput.dataset.manual = "true";
    syncDurationFromEndTime();
  });
  $("#questionType")?.addEventListener("change", () => {
    syncQuestionComposerMode();
  });

  $("#courseForm")?.addEventListener("submit", (event) => {
    handleCourseSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#examForm")?.addEventListener("submit", (event) => {
    handleExamSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#courseAudienceType")?.dispatchEvent(new Event("change"));
  syncExamEndTimePreview(true);
  $("#questionType")?.dispatchEvent(new Event("change"));
  $("#questionBankForm")?.addEventListener("submit", (event) => {
    handleQuestionSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#studentActionForm")?.addEventListener("submit", (event) => {
    handleStudentActionSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#communicationForm")?.addEventListener("submit", (event) => {
    handleCommunicationSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#clearSelectedQuestionsBtn")?.addEventListener("click", () => {
    clearExamQuestionSelection();
  });
  $("#clearDraftQuestionsBtn")?.addEventListener("click", () => {
    clearDraftQuestions();
  });
}

function bindSectionNav() {
  const sectionLinks = Array.from(document.querySelectorAll('a[href^="#"]'));
  const navItems = Array.from(document.querySelectorAll('.nav-item[href^="#"]'));

  sectionLinks.forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      const targetId = item.getAttribute('href').substring(1); // Remove the '#'
      const targetSection = document.getElementById(targetId);

      if (targetSection) {
        // Hide all sections
        document.querySelectorAll('.workspace-section').forEach(section => {
          section.classList.remove('active');
        });

        // Show the target section
        targetSection.classList.add('active');

        // Update active nav item only for sidebar links
        navItems.forEach(navItem => navItem.classList.remove('active'));
        if (item.classList.contains('nav-item')) {
          item.classList.add('active');
        } else {
          const matchingNav = navItems.find(navItem => navItem.getAttribute('href') === `#${targetId}`);
          if (matchingNav) {
            matchingNav.classList.add('active');
          }
        }
      }
    });
  });

  // Set overview as default active section
  const overviewSection = document.getElementById('overviewSection');
  if (overviewSection) {
    overviewSection.classList.add('active');
  }
  const overviewNav = navItems.find(item => item.getAttribute('href') === '#overviewSection');
  if (overviewNav) {
    overviewNav.classList.add('active');
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = requireRole("instructor");
  if (!user) return;

  setupLogoutHandlers();
  state.instructorId = Number(user?.id || 1);
  bindEvents();
  bindSectionNav();

  try {
    await loadWorkspace();
    window.setInterval(() => loadWorkspace({ silent: true }).catch(() => {}), 30000);
  } catch (error) {
    showBanner(`Instructor workspace could not load: ${error.message}`, "error", true);
  }
});

window.toggleExamQuestionSelection = toggleExamQuestionSelection;
window.removeDraftQuestion = removeDraftQuestion;
