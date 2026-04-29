// Discussion page script

const API_BASE_URL = "http://localhost:5000/api";
let allDiscussions = [];
const discussionFilter = { query: "", subject: "all" };

// Get student ID from localStorage
function getStudentId() {
  const user = JSON.parse(localStorage.getItem("edumateCurrentUser") || localStorage.getItem("user") || "{}");
  return user.id;
}

// Get student name from localStorage
function getStudentName() {
  const user = JSON.parse(localStorage.getItem("edumateCurrentUser") || localStorage.getItem("user") || "{}");
  return user.fullName || "User";
}

// Get tag chip class
function getTagChipClass(tag) {
  const tag_lower = String(tag || "").toLowerCase();
  if (tag_lower === "trending") return "blue";
  if (tag_lower === "hot") return "amber";
  if (tag_lower === "pinned") return "";
  if (tag_lower === "new") return "";
  return "";
}

// Format time difference
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
      <h4>${data.title}</h4>
      <p>${data.content || "No details available."}</p>
      <p>${replies.length} replies · by ${data.author_name || "Unknown"}</p>
    `;
  } catch (_error) {
    detail.innerHTML = "<h4>Unable to load thread details</h4>";
  }
}

function renderDiscussions() {
  const discussionList = document.getElementById("discussionList");
  if (!discussionList) return;
  const q = discussionFilter.query.trim().toLowerCase();
  const filtered = allDiscussions.filter((discussion) => {
    const matchQuery = !q || discussion.title?.toLowerCase().includes(q) || discussion.content?.toLowerCase().includes(q);
    const matchSubject = discussionFilter.subject === "all" || (discussion.subject || "").toLowerCase() === discussionFilter.subject;
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
    const chipClass = getTagChipClass(discussion.tag);
    const timeAgo = getTimeAgo(discussion.created_at);
    thread.innerHTML = `
      <div class="u-flex u-space-between u-gap-8">
        <h4>${discussion.title}</h4>
        <span class="chip ${chipClass}">${discussion.tag || (discussion.subject || "new")}</span>
      </div>
      <span>${discussion.reply_count} replies · Last by ${discussion.author_name} · ${timeAgo}</span>
    `;
    thread.addEventListener("click", () => showDiscussionDetail(discussion.discussion_id));
    discussionList.appendChild(thread);
  });
}

// Fetch and display discussions
async function loadDiscussions() {
  try {
    const response = await fetch(`${API_BASE_URL}/discussions`);
    const result = await response.json();
    if (result.success && result.data && result.data.length > 0) {
      allDiscussions = result.data;
      renderDiscussions();
      return;
    }
    allDiscussions = [];
    renderDiscussions();
  } catch (error) {
    console.error("Error loading discussions:", error);
  }
}

// Handle post discussion button
async function handlePostDiscussion() {
  try {
    const titleInput = document.querySelector(".discussion-input");
    const contentTextarea = document.querySelector(".input-row textarea");
    
    if (!titleInput || !contentTextarea) return;

    const title = titleInput.value.trim();
    const content = contentTextarea.value.trim();

    if (!title || !content) {
      alert("Please enter both title and content.");
      return;
    }

    const studentId = getStudentId();
    if (!studentId) {
      alert("Please log in first.");
      return;
    }

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

    if (result.success) {
      titleInput.value = "";
      contentTextarea.value = "";
      alert("Discussion posted successfully!");
      loadDiscussions();
    } else {
      alert("Error posting discussion: " + result.message);
    }
  } catch (error) {
    console.error("Error posting discussion:", error);
    alert("Could not post discussion.");
  }
}

// Fetch and display study circles
async function loadStudyCircles() {
  try {
    const response = await fetch(`${API_BASE_URL}/study-circles`);
    const result = await response.json();
    const circlesList = document.querySelector(".section-spacer .list");
    if (!circlesList) return;
    circlesList.innerHTML = "";

    if (result.success && result.data && result.data.length > 0) {
      result.data.forEach((circle) => {
        const thread = document.createElement("div");
        thread.className = "thread";
        
        let chipClass = "";
        if (circle.member_count > 40) chipClass = "blue";
        else if (circle.member_count > 45) chipClass = "amber";
        
        thread.innerHTML = `
          <div class="u-flex u-space-between u-gap-8">
            <h4>${circle.name}</h4>
            <span class="chip ${chipClass}">${circle.member_count} members</span>
          </div>
          <span>${circle.description}</span>
        `;
        circlesList.appendChild(thread);
      });
    } else {
      circlesList.innerHTML = '<div class="thread"><h4>No study circles available</h4><span>Create or join a circle later.</span></div>';
    }
  } catch (error) {
    console.error("Error loading study circles:", error);
  }
}

// Initialize discussion page
document.addEventListener("DOMContentLoaded", () => {
  loadDiscussions();
  loadStudyCircles();

  // Add event listener to post discussion button
  const postButton = document.querySelector(".input-row .btn-primary");
  if (postButton) {
    postButton.addEventListener("click", handlePostDiscussion);
  }

  const discussionSearch = document.getElementById("discussionSearch");
  const discussionSubjectFilter = document.getElementById("discussionSubjectFilter");
  if (discussionSearch) {
    discussionSearch.addEventListener("input", (event) => {
      discussionFilter.query = event.target.value || "";
      renderDiscussions();
    });
  }
  if (discussionSubjectFilter) {
    discussionSubjectFilter.addEventListener("change", (event) => {
      discussionFilter.subject = event.target.value || "all";
      renderDiscussions();
    });
  }
});
