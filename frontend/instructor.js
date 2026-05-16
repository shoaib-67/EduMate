const { API_BASE_URL, getStoredUser, escapeHTML, requireRole, setupLogoutHandlers, setupTabSync, setupAccountStatusGuard } = window.EduMateShared;

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
    coursePerformance: [],
    scoreDistribution: [],
    mockTestResults: [],
  },
  discussionHub: {
    items: [],
    activeDiscussionId: null,
    query: "",
    subject: "all",
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
  if (!banner) return;

  banner.textContent = message;
  banner.className = `workspace-banner is-visible is-${type}`;

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

function setInlineStatus(selector, message = "", type = "info") {
  const node = $(selector);
  if (!node) return;

  if (!message) {
    node.className = "workspace-banner";
    node.textContent = "";
    return;
  }

  node.textContent = message;
  node.className = `workspace-banner is-visible is-${type}`;
}

function setWorkspaceHealth(status) {
  const healthBadge = $("#workspaceHealthBadge");
  if (!healthBadge) return;
  const label =
    status === "ready"
      ? "Workspace ready"
      : status === "issue"
        ? "Connection issue"
        : "Syncing workspace";
  healthBadge.textContent = label;
  healthBadge.dataset.status = status;
}

function renderEmptyCard(title, note) {
  return `<div class="empty-card"><strong>${escapeHTML(title)}</strong><span>${escapeHTML(note)}</span></div>`;
}

function showDiscussionHubStatus(message = "", type = "info") {
  const status = $("#discussionHubStatus");
  if (!status) return;
  if (!message) {
    status.className = "workspace-banner";
    status.textContent = "";
    return;
  }
  status.textContent = message;
  status.className = `workspace-banner is-visible is-${type}`;
}

function getTimeAgo(createdAt) {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return "unknown time";

  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getDiscussionTagClass(tag) {
  const cleanTag = String(tag || "").toLowerCase();
  if (cleanTag === "trending") return "blue";
  if (cleanTag === "hot") return "amber";
  return "";
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
  const coursePerformance = state.workspace.coursePerformance || [];
  const active = exams.filter((exam) => {
    const status = String(exam.status || "").trim().toLowerCase();
    return status !== "completed" && status !== "missed";
  });
  const drafts = exams.filter((exam) => exam.state === "Draft");

  return [
    {
      title: `${active.length} active exam${active.length === 1 ? "" : "s"}`,
      note: active.length ? "Keep the published exams, rules, and question sets aligned for your batches." : "No active exams are waiting on you right now.",
    },
    {
      title: `${coursePerformance.length} course-level metric${coursePerformance.length === 1 ? "" : "s"} ready`,
      note: coursePerformance.length ? "Live database scores and pass rates are available for your active subjects." : "Student performance will appear here after assigned students complete exams.",
    },
    {
      title: `${drafts.length} draft exam${drafts.length === 1 ? "" : "s"}`,
      note: drafts.length ? "Review the draft questions and publish when the mock test is ready." : "No draft exams are waiting to be published.",
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
    setWorkspaceHealth("syncing");
  }
  try {
    const payload = await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/workspace`);
    state.workspace = payload.data || state.workspace;
    renderAll();
    setWorkspaceHealth("ready");
    if (!silent) {
      showBanner("Instructor workspace is up to date.", "success");
    }
    return payload;
  } catch (error) {
    setWorkspaceHealth("issue");
    throw error;
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
  const nextExam = getNextExam(exams);
  const drafts = exams.filter((exam) => exam.state === "Draft").length;

  $("#workspaceHeadline").textContent = nextExam
    ? `Active exam: ${nextExam.title}`
    : "No active exams on the board";
  $("#workspaceSummary").textContent = nextExam
    ? `${nextExam.batch} can access this mock test right away. Keep the rules, question set, and publish state aligned while students are taking it.`
    : "Your batches are clear right now. This is a good moment to upload materials, review student performance, or publish the next mock test.";
  $("#nextExamPill").textContent = nextExam
    ? `${nextExam.batch} - Open now`
    : "No active exam";
  $("#attentionPill").textContent = drafts
    ? `${drafts} draft exam${drafts === 1 ? "" : "s"} waiting to publish`
    : "No drafts pending";

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

  renderPublishedExamOverview(exams);
}

function renderPublishedExamOverview(exams = []) {
  const node = $("#publishedExamOverviewList");
  if (!node) return;

  const published = exams
    .filter((exam) => String(exam.state || "").trim().toLowerCase() === "published")
    .sort((left, right) => {
      const leftTime = Date.parse(`${left.date || ""}T${left.time || "00:00"}`);
      const rightTime = Date.parse(`${right.date || ""}T${right.time || "00:00"}`);
      if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
      if (!Number.isFinite(leftTime)) return 1;
      if (!Number.isFinite(rightTime)) return -1;
      return rightTime - leftTime;
    });

  if (!published.length) {
    node.innerHTML = renderEmptyCard(
      "No published exams yet",
      "Publish an exam from the exam section and it will appear here with full details."
    );
    return;
  }

  const formatExamDateTime = (exam) => {
    const parsed = new Date(`${exam.date || ""}T${exam.time || "00:00"}`);
    if (Number.isNaN(parsed.getTime())) return "Schedule not available";
    return parsed.toLocaleString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  node.innerHTML = published
    .map(
      (exam) => `
      <article class="published-exam-card">
        <div class="published-exam-head">
          <h4>${escapeHTML(exam.title || "Untitled exam")}</h4>
          <span class="chip">${escapeHTML(exam.state || "Published")}</span>
        </div>
        <div class="published-exam-meta">
          <span class="published-exam-chip">${escapeHTML(exam.batch || "General")}</span>
          <span class="published-exam-chip">${escapeHTML(exam.examType || "Exam")}</span>
          <span class="published-exam-chip">${escapeHTML(exam.duration || 0)} min</span>
          <span class="published-exam-chip">${escapeHTML(exam.accessMode === "open_anytime" ? "Open now" : "Scheduled")}</span>
        </div>
        <p class="published-exam-line"><strong>Scheduled:</strong> ${escapeHTML(formatExamDateTime(exam))}</p>
        <p class="published-exam-line"><strong>Status:</strong> ${escapeHTML(exam.status === "always_open" ? "Open" : exam.status || "N/A")} | <strong>Approval:</strong> ${escapeHTML(exam.approvalStatus || "pending")}</p>
        <p class="published-exam-line"><strong>Rules:</strong> ${escapeHTML(exam.rules || "No extra rules added.")}</p>
      </article>
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
          </div>
          <span class="chip">${escapeHTML(item.type)}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No study materials yet", "Your course items will show up here once you upload the first PDF, note, or announcement.");
}

function renderQuestionBank() {
  const listNode = $("#questionBankList");
  if (!listNode) return;

  const items = (state.workspace.questionBank || []).filter(
    (item) =>
      String(item?.type || "").trim().toUpperCase() === "MCQ" &&
      String(item?.approvalStatus || "").trim().toLowerCase() === "pending"
  );
  const validIds = new Set(
    items
      .map((item) => Number(item.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  state.selectedExamQuestionIds.forEach((id) => {
    if (!validIds.has(id)) state.selectedExamQuestionIds.delete(id);
  });

  listNode.innerHTML = items.length
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
    : renderEmptyCard("Question bank is empty", "Add reusable MCQ items so new exams are faster to assemble.");

  updateSelectedQuestionMeta();
}

function updateSelectedQuestionMeta() {
  const countNode = $("#selectedQuestionCount");
  if (!countNode) return;
  const draftCount = state.examDraftQuestions.length;
  const total = draftCount;
  countNode.textContent = String(total);
  const metaNode = $("#draftQuestionMeta");
  if (metaNode) {
    metaNode.textContent = `(${draftCount} draft)`;
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
  const activeExams = exams.filter((exam) => {
    const status = String(exam?.status || "").trim().toLowerCase();
    return status !== "completed" && status !== "missed";
  });

  $("#examList").innerHTML = activeExams.length
    ? activeExams
        .map(
          (exam) => `
        <div class="list-item">
          <div>
            <h4>${escapeHTML(exam.title)}</h4>
            <span>${escapeHTML(exam.batch)} - ${escapeHTML(exam.examType)} - ${escapeHTML(exam.accessMode === "open_anytime" ? "Open now" : "Published")}</span>
            <span>${escapeHTML(String(exam.duration))} min · ${escapeHTML(exam.accessMode === "open_anytime" ? "Immediate access" : "Published")} · ${escapeHTML(exam.shuffleMode)}</span>
            <span>${escapeHTML(exam.rules || "No extra rules added.")}</span>
          </div>
          <div class="list-item-actions">
            <span class="chip ${exam.state === "Published" ? "" : exam.state === "Draft" ? "amber" : "blue"}">${escapeHTML(exam.state)}</span>
            <span class="chip ${exam.status === "Upcoming" ? "blue" : exam.status === "Ongoing" || exam.status === "always_open" ? "" : "red"}">${escapeHTML(exam.status === "always_open" ? "Open" : exam.status)}</span>
          </div>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No active exams", "Completed exams are archived and hidden from this board.");
}

function renderMockTestResults() {
  const rows = state.workspace.mockTestResults || [];
  const tbody = $("#mockTestResultsBody");
  if (!tbody) return;

  tbody.innerHTML = rows.length
    ? rows
        .map((row) => {
          const scoreLabel =
            row.score != null && Number.isFinite(Number(row.score)) ? `${Math.round(Number(row.score) * 10) / 10}%` : "—";
          const total = row.totalQuestions != null ? Number(row.totalQuestions) : null;
          const correct = row.correctAnswers != null ? Number(row.correctAnswers) : null;
          const frac =
            total != null && total > 0 && correct != null && Number.isFinite(correct)
              ? `${correct}/${total}`
              : "—";
          let when = "—";
          if (row.createdAt) {
            const d = new Date(row.createdAt);
            when = Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
          }
          return `
        <tr>
          <td>${escapeHTML(row.studentName || "")}</td>
          <td>${escapeHTML(row.batch || "")}</td>
          <td>${escapeHTML(row.testName || "")}</td>
          <td>${escapeHTML(row.subject || "")}</td>
          <td><span class="${getStatusChipClass(Number(row.score || 0))}">${escapeHTML(scoreLabel)}</span></td>
          <td>${escapeHTML(frac)}</td>
          <td>${escapeHTML(when)}</td>
        </tr>
      `;
        })
        .join("")
    : `<tr><td colspan="7">${renderEmptyCard("No mock test results yet", "When assigned students submit mocks, each attempt appears here with score and timing.")}</td></tr>`;
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

function renderDiscussionHubList() {
  const listNode = $("#discussionHubList");
  if (!listNode) return;

  const items = state.discussionHub.items || [];
  const query = String(state.discussionHub.query || "").trim().toLowerCase();
  const subject = String(state.discussionHub.subject || "all").trim().toLowerCase();

  const filtered = items.filter((item) => {
    const matchQuery =
      !query ||
      String(item.title || "").toLowerCase().includes(query) ||
      String(item.content || "").toLowerCase().includes(query) ||
      String(item.author_name || "").toLowerCase().includes(query);
    const matchSubject = subject === "all" || String(item.subject || "").toLowerCase() === subject;
    return matchQuery && matchSubject;
  });

  if (!filtered.length) {
    listNode.innerHTML = renderEmptyCard(
      "No student discussions found",
      "Try another search text or subject filter."
    );
    return;
  }

  listNode.innerHTML = filtered
    .map((item) => {
      const activeClass = Number(item.discussion_id) === Number(state.discussionHub.activeDiscussionId) ? " is-active" : "";
      return `
        <div class="thread clickable${activeClass}" data-discussion-id="${Number(item.discussion_id)}">
          <div class="u-flex u-space-between u-gap-8">
            <h4>${escapeHTML(item.title || "Untitled discussion")}</h4>
            <span class="chip ${getDiscussionTagClass(item.tag)}">${escapeHTML(item.tag || item.subject || "new")}</span>
          </div>
          <span>${escapeHTML(String(item.reply_count || 0))} replies - by ${escapeHTML(item.author_name || "Student")} - ${escapeHTML(getTimeAgo(item.created_at))}</span>
        </div>
      `;
    })
    .join("");

  listNode.querySelectorAll("[data-discussion-id]").forEach((node) => {
    node.addEventListener("click", () => {
      const discussionId = Number(node.getAttribute("data-discussion-id"));
      if (!Number.isInteger(discussionId) || discussionId <= 0) return;
      loadDiscussionDetail(discussionId).catch(() => {});
    });
  });
}

function renderDiscussionHubDetail(discussion) {
  const detailNode = $("#discussionHubDetail");
  if (!detailNode) return;

  if (!discussion) {
    detailNode.innerHTML = `
      <h4>Select a discussion</h4>
      <p>The selected post and replies will appear here.</p>
    `;
    return;
  }

  const replies = Array.isArray(discussion.replies) ? discussion.replies : [];
  const replyHtml = replies.length
    ? replies
        .map(
          (reply) => `
        <div class="thread">
          <p>${escapeHTML(reply.content || "")}</p>
          <span>${escapeHTML(reply.author_name || "Unknown")} (${escapeHTML(reply.author_role || "student")}) - ${escapeHTML(getTimeAgo(reply.created_at))}</span>
        </div>
      `
        )
        .join("")
    : renderEmptyCard("No replies yet", "This student question has no replies yet.");

  detailNode.innerHTML = `
    <h4>${escapeHTML(discussion.title || "Untitled discussion")}</h4>
    <p>${escapeHTML(discussion.content || "No content available.")}</p>
    <p>${escapeHTML(String(replies.length))} replies - started by ${escapeHTML(discussion.author_name || "Student")}</p>
    <div class="list">${replyHtml}</div>
    <div class="discussion-reply-box">
      <textarea id="discussionHubReplyInput" placeholder="Write your instructor reply..."></textarea>
      <button class="btn btn-primary" id="discussionHubReplyBtn" type="button">Post reply</button>
    </div>
  `;

  detailNode.querySelector("#discussionHubReplyBtn")?.addEventListener("click", () => {
    submitDiscussionReply().catch((error) => {
      showDiscussionHubStatus(error.message || "Could not post reply.", "error");
    });
  });
}

async function loadDiscussionHub({ preserveSelection = true } = {}) {
  const listNode = $("#discussionHubList");
  if (listNode && (!state.discussionHub.items || !state.discussionHub.items.length)) {
    listNode.innerHTML = renderEmptyCard("Loading discussions", "Fetching latest student discussion posts.");
  }

  try {
    const payload = await fetchJson(`${API_BASE_URL}/discussions`);
    state.discussionHub.items = Array.isArray(payload.data) ? payload.data : [];

    if (!preserveSelection) {
      state.discussionHub.activeDiscussionId = null;
    } else if (
      state.discussionHub.activeDiscussionId &&
      !state.discussionHub.items.some((item) => Number(item.discussion_id) === Number(state.discussionHub.activeDiscussionId))
    ) {
      state.discussionHub.activeDiscussionId = null;
    }

    renderDiscussionHubList();

    if (state.discussionHub.activeDiscussionId) {
      await loadDiscussionDetail(state.discussionHub.activeDiscussionId, { silent: true });
    } else {
      renderDiscussionHubDetail(null);
    }
  } catch (error) {
    state.discussionHub.items = [];
    renderDiscussionHubList();
    renderDiscussionHubDetail(null);
    throw new Error(error.message || "Could not load student discussions.");
  }
}

async function loadDiscussionDetail(discussionId, { silent = false } = {}) {
  const parsedId = Number(discussionId);
  if (!Number.isInteger(parsedId) || parsedId <= 0) return;

  try {
    if (!silent) {
      showDiscussionHubStatus("Loading discussion thread...", "info");
    }
    const payload = await fetchJson(`${API_BASE_URL}/discussions/${parsedId}`);
    state.discussionHub.activeDiscussionId = parsedId;
    renderDiscussionHubList();
    renderDiscussionHubDetail(payload.data || null);
    if (!silent) {
      showDiscussionHubStatus("Discussion thread loaded.", "success");
    }
  } catch (error) {
    if (!silent) {
      showDiscussionHubStatus(error.message || "Could not load discussion thread.", "error");
    }
  }
}

async function submitDiscussionReply() {
  const discussionId = Number(state.discussionHub.activeDiscussionId);
  if (!Number.isInteger(discussionId) || discussionId <= 0) {
    showDiscussionHubStatus("Select a discussion thread first.", "error");
    return;
  }

  const input = $("#discussionHubReplyInput");
  const content = String(input?.value || "").trim();
  if (!content) {
    showDiscussionHubStatus("Write a reply before posting.", "error");
    return;
  }

  const button = $("#discussionHubReplyBtn");
  await submitForm(button, async () => {
    showDiscussionHubStatus("Posting reply...", "info");
    await fetchJson(`${API_BASE_URL}/discussions/${discussionId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: state.instructorId,
        userRole: "instructor",
        content,
      }),
    });
    if (input) input.value = "";
    showDiscussionHubStatus("Reply posted successfully.", "success");
    await Promise.all([loadDiscussionHub(), loadDiscussionDetail(discussionId, { silent: true })]);
  });
}

function renderAll() {
  renderWorkspaceOverview();
  renderStats();
  renderCourseContent();
  renderQuestionBank();
  renderExamDraftQuestions();
  renderExams();
  renderMockTestResults();
  renderCommunications();
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
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  setInlineStatus("#courseFormStatus");
  await submitForm(submitButton, async () => {
    setInlineStatus("#courseFormStatus", "Sending content to the server...", "info");
    const payload = await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/course-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        course: String(formData.get("courseTitle") || "").trim(),
        type: String(formData.get("contentType") || "").trim(),
        audienceType: String(formData.get("courseAudienceType") || "batch").trim(),
        batchName: String(formData.get("courseBatch") || "").trim(),
        title: String(formData.get("contentTitle") || "").trim(),
        summary: String(formData.get("contentSummary") || "").trim(),
        link: String(formData.get("contentLink") || "").trim(),
      }),
    });
    form.reset();
    $("#linkField").style.display = "block";
    $("#contentLink").required = true;
    $("#courseAudienceType")?.dispatchEvent(new Event("change"));
    await loadWorkspace();
    const successMessage = payload?.message || "Course content uploaded and sent to admin for approval.";
    setInlineStatus("#courseFormStatus", `${successMessage} You can review it below in your resource list.`, "success");
    showBanner(successMessage, "success");
  });
}

async function handleExamSubmit(event) {
  event.preventDefault();
  showConflict("");
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  const draftQuestions = [...state.examDraftQuestions];
  setInlineStatus("#examFormStatus");
  if (!draftQuestions.length) {
    showBanner("Add at least one draft question before submitting this mock test.", "error");
    setInlineStatus("#examFormStatus", "Add at least one draft question before submitting the exam.", "error");
    return;
  }

  const accessMode = String(formData.get("accessMode") || "open_anytime").trim();
  const subject = String(formData.get("examSubject") || "").trim();
  const perMcqMark = Number(formData.get("perMcqMark") || 0);
  const durationToSend = Number(formData.get("examDuration") || 0);
  if (!Number.isFinite(durationToSend) || durationToSend <= 0) {
    showBanner("Duration must be greater than 0.", "error");
    setInlineStatus("#examFormStatus", "Duration must be greater than 0.", "error");
    return;
  }
  if (!subject) {
    showBanner("Subject is required.", "error");
    setInlineStatus("#examFormStatus", "Subject is required before the exam can be submitted.", "error");
    return;
  }
  if (!Number.isFinite(perMcqMark) || perMcqMark <= 0) {
    showBanner("Per MCQ mark must be greater than 0.", "error");
    setInlineStatus("#examFormStatus", "Per MCQ mark must be greater than 0.", "error");
    return;
  }

  try {
    await submitForm(submitButton, async () => {
      setInlineStatus(
        "#examFormStatus",
        `Submitting the exam with ${draftQuestions.length} question${draftQuestions.length === 1 ? "" : "s"}...`,
        "info"
      );
      showBanner(
        `Submitting mock test with ${draftQuestions.length} draft question${draftQuestions.length === 1 ? "" : "s"}...`,
        "info",
        true
      );

      const payload = await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/exams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: String(formData.get("examTitle") || "").trim(),
          subject,
          audienceType: String(formData.get("examAudienceType") || "batch").trim(),
          batchName: String(formData.get("examBatch") || "").trim(),
          accessMode,
          duration: durationToSend,
          negativeMarking: String(formData.get("negativeMarking") || "").trim(),
          perMcqMark,
          shuffleMode: String(formData.get("shuffleMode") || "").trim(),
          examType: String(formData.get("examType") || "").trim(),
          state: String(formData.get("publishState") || "").trim(),
          rules: String(formData.get("examRules") || "").trim(),
          draftQuestions: draftQuestions.map((question) => ({
            subject: String(question.subject || "").trim(),
            type: "MCQ",
            audienceType: String(question.audienceType || "batch").trim(),
            batchName: String(question.batchName || "").trim(),
            text: String(question.text || "").trim(),
            options: String(question.options || "").trim(),
            mcqOptions: Array.isArray(question.mcqOptions)
              ? question.mcqOptions.map((item) => String(item || "").trim()).filter(Boolean)
              : [],
            answerKey: String(question.answerKey || "").trim().toUpperCase(),
          })),
        }),
      });
      form.reset();
      state.examDraftQuestions = [];
      const questionForm = $("#questionBankForm");
      questionForm?.reset();
      syncQuestionComposerMode();
      const successMessage = payload?.message || "Mock test submitted and published.";
      setInlineStatus("#examFormStatus", `${successMessage} The exam is now listed on the active exam board.`, "success");
      showBanner(successMessage, "success");
      loadWorkspace({ silent: true }).catch(() => {});
    });
  } catch (error) {
    throw error;
  }
}

function labelForField(field) {
  if (!field || !field.id) return "all required exam fields";
  const label = document.querySelector(`label[for="${field.id}"]`);
  return label?.textContent?.trim() || field.name || field.id || "required field";
}

async function handleQuestionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  const type = "MCQ";

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

    form.reset();
    syncQuestionComposerMode();
    renderExamDraftQuestions();
    showBanner("Question added to this mock test draft.", "success");
  });
}

async function handleCommunicationSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submitButton = form.querySelector('button[type="submit"]');
  setInlineStatus("#communicationFormStatus");

  await submitForm(submitButton, async () => {
    setInlineStatus("#communicationFormStatus", "Sending announcement to admin review...", "info");
    await fetchJson(`${API_BASE_URL}/instructor/${state.instructorId}/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: String(formData.get("messageTitle") || "").trim(),
        content: String(formData.get("messageBody") || "").trim(),
        batchName: String(formData.get("announcementBatch") || "").trim() || null,
      }),
    });
    form.reset();
    await loadWorkspace();
    setInlineStatus(
      "#communicationFormStatus",
      "Announcement posted and sent for admin approval. It will appear after approval.",
      "success"
    );
    showBanner("Announcement posted and sent for admin approval.", "success");
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
  const questionTypeSelect = $("#questionType");
  if (questionTypeSelect && questionTypeSelect.value !== "MCQ") {
    questionTypeSelect.value = "MCQ";
  }

  $("#mcqEditorGroup")?.classList.remove("is-hidden");

  ["#questionOptionA", "#questionOptionB", "#questionOptionC", "#questionOptionD"].forEach((selector) => {
    const input = $(selector);
    if (input) input.required = true;
  });

  const answerSelect = $("#questionAnswerOption");
  if (answerSelect) answerSelect.required = true;
}

function bindEvents() {
  $("#courseAudienceType")?.addEventListener("change", () => {
    syncBatchGroupVisibility("#courseAudienceType", "#courseBatchGroup", "#courseBatch");
  });
  $("#courseForm")?.addEventListener("submit", (event) => {
    handleCourseSubmit(event).catch((error) => {
      setInlineStatus("#courseFormStatus", error.message || "Could not upload content.", "error");
      showBanner(error.message, "error");
    });
  });
  const examForm = $("#examForm");
  examForm?.addEventListener(
    "invalid",
    (event) => {
      const field = event.target;
      showBanner(`Please fill a valid value for: ${labelForField(field)}.`, "error");
    },
    true
  );

  examForm?.addEventListener("submit", (event) => {
    handleExamSubmit(event).catch((error) => {
      setInlineStatus("#examFormStatus", error.message || "Could not submit the exam.", "error");
      showBanner(error.message, "error");
    });
  });
  $("#courseAudienceType")?.dispatchEvent(new Event("change"));
  syncQuestionComposerMode();
  $("#questionBankForm")?.addEventListener("submit", (event) => {
    handleQuestionSubmit(event).catch((error) => showBanner(error.message, "error"));
  });
  $("#communicationForm")?.addEventListener("submit", (event) => {
    handleCommunicationSubmit(event).catch((error) => {
      setInlineStatus("#communicationFormStatus", error.message || "Could not post announcement.", "error");
      showBanner(error.message, "error");
    });
  });
  $("#discussionHubSearch")?.addEventListener("input", (event) => {
    state.discussionHub.query = String(event.target?.value || "");
    renderDiscussionHubList();
  });
  $("#discussionHubSubjectFilter")?.addEventListener("change", (event) => {
    state.discussionHub.subject = String(event.target?.value || "all");
    renderDiscussionHubList();
  });
  $("#refreshDiscussionHubBtn")?.addEventListener("click", () => {
    loadDiscussionHub().then(() => {
      showDiscussionHubStatus("Student discussions refreshed.", "success");
    }).catch((error) => {
      showDiscussionHubStatus(error.message || "Could not refresh discussions.", "error");
    });
  });
  $("#clearDraftQuestionsBtn")?.addEventListener("click", () => {
    clearDraftQuestions();
  });
}

function bindSectionNav() {
  const sectionLinks = Array.from(document.querySelectorAll('a[href^="#"]'));
  const navItems = Array.from(document.querySelectorAll('.nav-item[href^="#"]'));
  const sections = Array.from(document.querySelectorAll(".workspace-section"));

  function activateSection(targetId, { updateHash = false } = {}) {
    if (!targetId) return false;
    const targetSection = document.getElementById(targetId);
    if (!targetSection) return false;

    sections.forEach((section) => {
      section.classList.toggle("active", section.id === targetId);
    });

    navItems.forEach((navItem) => {
      navItem.classList.toggle("active", navItem.getAttribute("href") === `#${targetId}`);
    });

    if (updateHash) {
      window.location.hash = targetId;
    }

    return true;
  }

  sectionLinks.forEach((item) => {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      const targetId = item.getAttribute("href").substring(1);
      activateSection(targetId, { updateHash: true });
    });
  });

  const initialHash = String(window.location.hash || "").replace(/^#/, "");
  if (!activateSection(initialHash)) {
    activateSection("overviewSection");
  }

  window.addEventListener("hashchange", () => {
    const nextHash = String(window.location.hash || "").replace(/^#/, "");
    if (!activateSection(nextHash) && !nextHash) {
      activateSection("overviewSection");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = requireRole("instructor");
  if (!user) return;

  setupAccountStatusGuard("instructor", { redirectTo: "index.html", intervalMs: 10000 });
  setupLogoutHandlers();
  state.instructorId = Number(user?.id || 1);
  bindEvents();
  bindSectionNav();
  renderDiscussionHubDetail(null);
  loadDiscussionHub().catch((error) => {
    showDiscussionHubStatus(error.message || "Could not load student discussions.", "error");
  });

  const startWorkspacePolling = () => {
    window.setInterval(() => {
      loadWorkspace({ silent: true }).catch(() => {});
      loadDiscussionHub().catch(() => {});
    }, 30000);
  };

  setupTabSync(() => Promise.allSettled([loadWorkspace({ silent: true }), loadDiscussionHub()]), { minIntervalMs: 1000 });

  try {
    await loadWorkspace();
    await loadDiscussionHub();
    startWorkspacePolling();
  } catch (error) {
    showBanner(`Instructor workspace could not load: ${error.message}`, "error", true);
    loadDiscussionHub().catch(() => {});
    startWorkspacePolling();
  }
});

window.toggleExamQuestionSelection = toggleExamQuestionSelection;
window.removeDraftQuestion = removeDraftQuestion;


