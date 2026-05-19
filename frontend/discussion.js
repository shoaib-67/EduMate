const { API_BASE_URL, getStudentId, escapeHTML, requireRole, setupLogoutHandlers } = window.EduMateShared;
let allDiscussions = [];
const discussionFilter = { query: "" };
let activeDiscussionId = null;

function getDiscussionUser() {
  const currentPath = String(window.location.pathname || "").toLowerCase();
  const preferredRoles = currentPath.includes("instructor") ? ["instructor", "student"] : ["student", "instructor"];
  const user = requireRole(preferredRoles, { allowAnonymous: true });
  const role = String(user?.role || "").trim().toLowerCase();
  if (!user || !["student", "instructor"].includes(role)) return null;
  return { id: Number(user.id || 0), role, name: user.fullName || user.name || role };
}

function showDiscussionStatus(message, type = "info") {
  const status = document.getElementById("discussionStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `discussion-status is-visible is-${type}`;
}

function getTimeAgo(createdAt) {
  const date = new Date(createdAt);
  const now = new Date();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function formatPostedDateTime(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recently posted";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function showDiscussionDetail(discussionId, triggerThread = null) {
  const discussionList = document.getElementById("discussionList");
  if (!discussionList) return;
  activeDiscussionId = discussionId;

  const existingDetail = discussionList.querySelector('.thread-detail[data-inline-detail="true"]');
  if (existingDetail && Number(existingDetail.dataset.discussionId) !== Number(discussionId)) {
    existingDetail.remove();
  }

  try {
    const response = await fetch(`${API_BASE_URL}/discussions/${discussionId}`);
    const result = await response.json();
    if (!result.success || !result.data) return;

    const data = result.data;
    const replies = data.replies || [];
    const currentUser = getDiscussionUser();
    const replyItems = replies.length
      ? replies.map((reply) => `
          <div class="thread">
            <p>${escapeHTML(reply.content || "")}</p>
            <span>${escapeHTML(reply.author_name || "Unknown")} (${escapeHTML(reply.author_role || "student")}) - ${escapeHTML(getTimeAgo(reply.created_at))}</span>
          </div>
        `).join("")
      : '<div class="thread empty-state"><h4>No replies yet</h4><span>Be the first to respond to this discussion post.</span></div>';

    let detail = discussionList.querySelector('.thread-detail[data-inline-detail="true"]');
    if (!detail) {
      detail = document.createElement("div");
      detail.className = "thread-detail";
      detail.dataset.inlineDetail = "true";
    }
    detail.dataset.discussionId = String(discussionId);
    detail.innerHTML = `
      <h4>${escapeHTML(data.title)}</h4>
      <p>${escapeHTML(data.content || "No details available.")}</p>
      <p>${escapeHTML(String(replies.length))} replies - by ${escapeHTML(data.author_name || "Unknown")}</p>
      <div class="list">${replyItems}</div>
      <div class="input-row">
        <textarea id="replyContent" placeholder="${currentUser ? "Write your reply..." : "Log in as a student or instructor to reply."}"></textarea>
        <button class="btn btn-primary" type="button" id="postReplyBtn">${currentUser ? "Post reply" : "Login to reply"}</button>
      </div>
    `;
    const anchorThread =
      triggerThread || discussionList.querySelector(`.thread.clickable[data-discussion-id="${String(discussionId)}"]`);
    if (anchorThread) {
      anchorThread.insertAdjacentElement("afterend", detail);
    } else {
      discussionList.appendChild(detail);
    }
    detail.querySelector("#postReplyBtn")?.addEventListener("click", handlePostReply);
  } catch {
    showDiscussionStatus("Unable to load discussion post details.", "error");
  }
}

function renderDiscussions() {
  const discussionList = document.getElementById("discussionList");
  if (!discussionList) return;

  const query = discussionFilter.query.trim().toLowerCase();
  const filtered = allDiscussions.filter((discussion) => {
    const matchQuery =
      !query ||
      String(discussion.title || "").toLowerCase().includes(query) ||
      String(discussion.content || "").toLowerCase().includes(query);
    return matchQuery;
  });

  discussionList.innerHTML = "";
  if (!filtered.length) {
    discussionList.innerHTML = '<div class="thread"><h4>No discussion posts found</h4><span>Try another search or filter.</span></div>';
    return;
  }

  filtered.forEach((discussion) => {
    const thread = document.createElement("div");
    thread.className = "thread clickable";
    thread.dataset.discussionId = String(discussion.discussion_id);
    thread.innerHTML = `
      <div class="u-flex u-space-between u-gap-8">
        <h4>${escapeHTML(discussion.title)}</h4>
        <span class="chip">${escapeHTML("general")}</span>
      </div>
      <span>${escapeHTML(String(discussion.reply_count || 0))} replies - Last by ${escapeHTML(discussion.author_name || "Unknown")} - ${escapeHTML(getTimeAgo(discussion.created_at))}</span>
    `;
    thread.addEventListener("click", () => showDiscussionDetail(discussion.discussion_id, thread));
    discussionList.appendChild(thread);
  });

  if (activeDiscussionId) {
    const activeThread = discussionList.querySelector(
      `.thread.clickable[data-discussion-id="${String(activeDiscussionId)}"]`
    );
    if (activeThread) {
      showDiscussionDetail(activeDiscussionId, activeThread);
    }
  }
}

async function loadDiscussions() {
  try {
    const response = await fetch(`${API_BASE_URL}/discussions`);
    const result = await response.json();
    allDiscussions = result.success ? result.data || [] : [];
    renderDiscussions();
  } catch (error) {
    console.error("Error loading discussions:", error);
    allDiscussions = [];
    renderDiscussions();
  }
}

function renderAnnouncements(announcements) {
  const announcementsList = document.getElementById("announcementsList");
  if (!announcementsList) return;

  if (!announcements || announcements.length === 0) {
    announcementsList.innerHTML = '<div class="thread empty-state"><h4>No announcements yet</h4><span>Instructor announcements will appear here after admin approval.</span></div>';
    return;
  }

  announcementsList.innerHTML = "";
  announcements.forEach((announcement) => {
    const postedAt = announcement.created_at || announcement.createdAt || "";
    const thread = document.createElement("div");
    thread.className = "thread";
    thread.innerHTML = `
      <div class="u-flex u-space-between u-gap-8">
        <h4>${escapeHTML(announcement.title)}</h4>
        <span class="chip blue">📢 Announcement</span>
      </div>
      <p>${escapeHTML(announcement.content || "")}</p>
      <span>by ${escapeHTML(announcement.instructor_name || "Instructor")} - ${escapeHTML(formatPostedDateTime(postedAt))}</span>
    `;
    announcementsList.appendChild(thread);
  });
}

async function loadAnnouncements() {
  try {
    const studentId = getStudentId();
    if (!studentId) return;

    const response = await fetch(`${API_BASE_URL}/student/${studentId}/announcements`);
    const result = await response.json();
    const announcements = result.success ? result.data || [] : [];
    renderAnnouncements(announcements);
  } catch (error) {
    console.error("Error loading announcements:", error);
    renderAnnouncements([]);
  }
}

async function handlePostDiscussion() {
  try {
    const titleInput = document.getElementById("discussionTitleInput");
    const contentTextarea = document.getElementById("discussionContentInput");
    if (!titleInput || !contentTextarea) return;

    const title = titleInput.value.trim();
    const content = contentTextarea.value.trim();
    if (!title || !content) {
      showDiscussionStatus("Please enter both title and content.", "error");
      return;
    }

    const studentId = getStudentId();
    if (!studentId) {
      showDiscussionStatus("Please log in first.", "error");
      return;
    }

    showDiscussionStatus("Posting your discussion...", "info");

    const response = await fetch(`${API_BASE_URL}/discussions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId,
        title,
        content,
        subject: "general",
      }),
    });

    const result = await response.json();
    if (!result.success) {
      showDiscussionStatus(`Error posting discussion: ${result.message || "Unknown error"}`, "error");
      return;
    }

    titleInput.value = "";
    contentTextarea.value = "";
    showDiscussionStatus("Discussion posted successfully.", "success");
    await loadDiscussions();
  } catch (error) {
    console.error("Error posting discussion:", error);
    showDiscussionStatus("Could not post discussion.", "error");
  }
}

async function handlePostReply() {
  const currentUser = getDiscussionUser();
  if (!currentUser) {
    window.location.href = "index.html";
    return;
  }

  const replyInput = document.getElementById("replyContent");
  const content = String(replyInput?.value || "").trim();
  if (!activeDiscussionId || !content) {
    showDiscussionStatus("Please write a reply first.", "error");
    return;
  }

  try {
    showDiscussionStatus("Posting your reply...", "info");
    const response = await fetch(`${API_BASE_URL}/discussions/${activeDiscussionId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: currentUser.id,
        userRole: currentUser.role,
        content,
      }),
    });
    const result = await response.json();
    if (!result.success) {
      showDiscussionStatus(`Error posting reply: ${result.message || "Unknown error"}`, "error");
      return;
    }

    showDiscussionStatus("Reply posted successfully.", "success");
    await Promise.all([loadDiscussions(), showDiscussionDetail(activeDiscussionId)]);
  } catch (error) {
    console.error("Error posting reply:", error);
    showDiscussionStatus("Could not post reply.", "error");
  }
}

async function loadStudyCircles() {
  // Study circles removed as requested
  const circlesContainer = document.querySelector(".section-spacer");
  if (circlesContainer) {
    circlesContainer.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const user = getDiscussionUser();
  const postButton = document.getElementById("postDiscussionBtn");
  if (user) {
    setupLogoutHandlers();
  } else {
    document.querySelectorAll(".logout-btn").forEach((link) => {
      link.textContent = "Login";
      link.setAttribute("aria-label", "Login");
    });
    showDiscussionStatus("You can read discussion posts without logging in. Log in as a student to post or as a student/instructor to reply.", "info");
    if (postButton) {
      postButton.textContent = "Login to post";
    }
  }
  loadDiscussions();
  loadAnnouncements();
  loadStudyCircles();

  postButton?.addEventListener("click", () => {
    const currentUser = getDiscussionUser();
    if (!currentUser) {
      window.location.href = "index.html";
      return;
    }
    if (currentUser?.role !== "student") {
      showDiscussionStatus("Only students can start a new discussion post.", "info");
      return;
    }
    handlePostDiscussion();
  });

  document.getElementById("discussionSearch")?.addEventListener("input", (event) => {
    discussionFilter.query = event.target.value || "";
    renderDiscussions();
  });
});
