const { API_BASE_URL, getStudentId, escapeHTML, requireRole, setupLogoutHandlers } = window.EduMateShared;
let allDiscussions = [];
const discussionFilter = { query: "", subject: "all" };

function showDiscussionStatus(message, type = "info") {
  const status = document.getElementById("discussionStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `discussion-status is-visible is-${type}`;
}

function getTagChipClass(tag) {
  const cleanTag = String(tag || "").toLowerCase();
  if (cleanTag === "trending") return "blue";
  if (cleanTag === "hot") return "amber";
  return "";
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

async function showDiscussionDetail(discussionId) {
  const detail = document.getElementById("discussionDetail");
  if (!detail) return;

  try {
    const response = await fetch(`${API_BASE_URL}/discussions/${discussionId}`);
    const result = await response.json();
    if (!result.success || !result.data) return;

    const data = result.data;
    const replies = data.replies || [];

    detail.innerHTML = `
      <h4>${escapeHTML(data.title)}</h4>
      <p>${escapeHTML(data.content || "No details available.")}</p>
      <p>${escapeHTML(String(replies.length))} replies - by ${escapeHTML(data.author_name || "Unknown")}</p>
    `;
  } catch {
    detail.innerHTML = "<h4>Unable to load thread details</h4>";
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
    const matchSubject =
      discussionFilter.subject === "all" ||
      String(discussion.subject || "").toLowerCase() === discussionFilter.subject;
    return matchQuery && matchSubject;
  });

  discussionList.innerHTML = "";
  if (!filtered.length) {
    discussionList.innerHTML = '<div class="thread"><h4>No threads found</h4><span>Try another search or filter.</span></div>';
    return;
  }

  filtered.forEach((discussion) => {
    const thread = document.createElement("div");
    thread.className = "thread clickable";
    thread.innerHTML = `
      <div class="u-flex u-space-between u-gap-8">
        <h4>${escapeHTML(discussion.title)}</h4>
        <span class="chip ${getTagChipClass(discussion.tag)}">${escapeHTML(discussion.tag || discussion.subject || "new")}</span>
      </div>
      <span>${escapeHTML(String(discussion.reply_count || 0))} replies - Last by ${escapeHTML(discussion.author_name || "Unknown")} - ${escapeHTML(getTimeAgo(discussion.created_at))}</span>
    `;
    thread.addEventListener("click", () => showDiscussionDetail(discussion.discussion_id));
    discussionList.appendChild(thread);
  });
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

async function handlePostDiscussion() {
  try {
    const titleInput = document.querySelector(".discussion-input");
    const contentTextarea = document.querySelector(".input-row textarea");
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

async function loadStudyCircles() {
  try {
    const response = await fetch(`${API_BASE_URL}/study-circles`);
    const result = await response.json();
    const circlesList = document.querySelector(".section-spacer .list");
    if (!circlesList) return;

    circlesList.innerHTML = "";
    const circles = result.success ? result.data || [] : [];
    if (!circles.length) {
      circlesList.innerHTML = '<div class="thread"><h4>No study circles available</h4><span>Create or join a circle later.</span></div>';
      return;
    }

    circles.forEach((circle) => {
      const thread = document.createElement("div");
      thread.className = "thread";

      let chipClass = "";
      if (Number(circle.member_count) > 45) chipClass = "amber";
      else if (Number(circle.member_count) > 40) chipClass = "blue";

      thread.innerHTML = `
        <div class="u-flex u-space-between u-gap-8">
          <h4>${escapeHTML(circle.name)}</h4>
          <span class="chip ${chipClass}">${escapeHTML(String(circle.member_count || 0))} members</span>
        </div>
        <span>${escapeHTML(circle.description)}</span>
      `;
      circlesList.appendChild(thread);
    });
  } catch (error) {
    console.error("Error loading study circles:", error);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const user = requireRole("student", { allowAnonymous: true });
  if (user) {
    setupLogoutHandlers();
  } else {
    document.querySelectorAll(".logout-btn").forEach((link) => {
      link.textContent = "Login";
      link.setAttribute("aria-label", "Login");
    });
  }
  loadDiscussions();
  loadStudyCircles();

  document.querySelector(".input-row .btn-primary")?.addEventListener("click", handlePostDiscussion);

  document.getElementById("discussionSearch")?.addEventListener("input", (event) => {
    discussionFilter.query = event.target.value || "";
    renderDiscussions();
  });

  document.getElementById("discussionSubjectFilter")?.addEventListener("change", (event) => {
    discussionFilter.subject = event.target.value || "all";
    renderDiscussions();
  });
});
