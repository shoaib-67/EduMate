const userTableBody = document.getElementById("userTableBody");
const contentList = document.getElementById("contentList");
const reportCards = document.getElementById("reportCards");
const userCount = document.getElementById("userCount");
const newSignupCount = document.getElementById("newSignupCount");
const reportCount = document.getElementById("reportCount");
const contentCount = document.getElementById("contentCount");
const reportBadge = document.getElementById("reportBadge");
const refreshUsers = document.getElementById("refreshUsers");
const approveAll = document.getElementById("approveAll");
const adminNavLinks = document.querySelectorAll(".sidebar .nav-item");

const setActiveAdminNav = (activeLink) => {
  adminNavLinks.forEach((link) => link.classList.toggle("active", link === activeLink));
};

adminNavLinks.forEach((link) => {
  link.addEventListener("click", () => {
    setActiveAdminNav(link);
  });
});

const currentPage = window.location.pathname.split("/").pop() || "admin.html";
const currentPageLink = Array.from(adminNavLinks).find((link) => {
  try {
    return new URL(link.href).pathname.split("/").pop() === currentPage;
  } catch {
    return link.getAttribute("href") === currentPage;
  }
});
if (currentPageLink) {
  setActiveAdminNav(currentPageLink);
}

const users = [
  { name: "Rifat Ahmed", role: "Student", status: "Active" },
  { name: "Tania Karim", role: "Instructor", status: "Active" },
  { name: "Shahin Khan", role: "Student", status: "Pending" },
  { name: "Mamun Hasan", role: "Student", status: "Active" },
];

const pendingContent = [
  { title: "Physics: Work & Energy", type: "PDF" },
  { title: "Math Quiz Set - Algebra", type: "Quiz" },
  { title: "Chemistry lab worksheet", type: "Assignment" },
];

const reports = [
  { title: "Login spike review", status: "Completed", value: "18k" },
  { title: "Content approval delay", status: "Open", value: "3 pending" },
  { title: "System warning alert", status: "High", value: "2 issues" },
];

const renderUsers = () => {
  if (!userTableBody) return;
  userTableBody.innerHTML = users
    .map(
      (user) => `
      <tr>
        <td>${user.name}</td>
        <td>${user.role}</td>
        <td>${user.status}</td>
        <td><button class="btn btn-small">View</button></td>
      </tr>`
    )
    .join("");
};

const renderContent = () => {
  if (!contentList) return;
  contentList.innerHTML = pendingContent
    .map(
      (item) => `
      <li>
        <div>
          <h3>${item.title}</h3>
          <p>${item.type} submission awaiting review</p>
        </div>
        <button class="btn btn-small">Approve</button>
      </li>`
    )
    .join("");
};

const renderReports = () => {
  if (!reportCards) return;
  reportCards.innerHTML = reports
    .map(
      (item) => `
      <article class="report-card">
        <strong>${item.value}</strong>
        <h3>${item.title}</h3>
        <span>${item.status}</span>
      </article>`
    )
    .join("");
};

const updateStats = () => {
  if (userCount) userCount.textContent = "4.2k";
  if (newSignupCount) newSignupCount.textContent = "128";
  if (reportCount) reportCount.textContent = "5";
  if (contentCount) contentCount.textContent = "12";
  if (reportBadge) reportBadge.textContent = "5 open";
};

refreshUsers?.addEventListener("click", () => {
  if (refreshUsers) refreshUsers.textContent = "Refreshing...";
  setTimeout(() => {
    renderUsers();
    if (refreshUsers) refreshUsers.textContent = "Refresh";
  }, 400);
});

approveAll?.addEventListener("click", () => {
  if (approveAll) approveAll.textContent = "Approved";
  setTimeout(() => {
    if (approveAll) approveAll.textContent = "Approve all";
  }, 900);
});

renderUsers();
renderContent();
renderReports();
updateStats();
