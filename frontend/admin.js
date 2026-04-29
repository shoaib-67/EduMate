const API_BASE_URL = "http://localhost:5000/api";

let users = [];
let pendingContent = [];
let reports = [];
const filters = {
  users: { query: "", role: "all", status: "all" },
  content: { query: "", type: "all" },
  reports: { query: "", status: "open", priority: "all" },
};

// Create modal for user details
function createUserModal() {
  const existing = document.getElementById("userDetailModal");
  if (existing) return;
  
  const modal = document.createElement("div");
  modal.id = "userDetailModal";
  modal.style.cssText = `
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1000;
    justify-content: center;
    align-items: center;
    backdrop-filter: blur(4px);
  `;
  
  modal.innerHTML = `
    <div style="background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%); padding: 0; border-radius: 12px; max-width: 600px; width: 90%; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3); animation: slideUp 0.3s ease-out;">
      <style>
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      </style>
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px 30px; border-radius: 12px 12px 0 0; display: flex; justify-content: space-between; align-items: center;">
        <h2 id="modalTitle" style="margin: 0; font-size: 24px; color: white; font-weight: 600;">User Details</h2>
        <button id="closeModal" style="background: rgba(255,255,255,0.2); border: none; font-size: 28px; cursor: pointer; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">&times;</button>
      </div>
      <div id="modalContent" style="color: #333; line-height: 1.8; padding: 30px;"></div>
      <div style="border-top: 1px solid #e0e0e0; padding: 20px 30px; display: flex; gap: 10px; justify-content: flex-end; background: #f8f9fa; border-radius: 0 0 12px 12px;">
        <button id="editUserBtn" class="btn btn-small" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; cursor: pointer; padding: 8px 16px; border-radius: 6px; transition: all 0.2s;">Edit</button>
        <button id="closeModalBtn" class="btn btn-small" style="background: #e0e0e0; color: #333; border: none; cursor: pointer; padding: 8px 16px; border-radius: 6px; transition: all 0.2s;">Close</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeModal = document.getElementById("closeModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const editUserBtn = document.getElementById("editUserBtn");
  
  closeModal.addEventListener("click", () => {
    modal.style.display = "none";
  });
  
  closeModal.addEventListener("mouseover", function() {
    this.style.background = "rgba(255,255,255,0.3)";
  });
  
  closeModal.addEventListener("mouseout", function() {
    this.style.background = "rgba(255,255,255,0.2)";
  });
  
  closeModalBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });
  
  closeModalBtn.addEventListener("mouseover", function() {
    this.style.background = "#d0d0d0";
  });
  
  closeModalBtn.addEventListener("mouseout", function() {
    this.style.background = "#e0e0e0";
  });
  
  editUserBtn.addEventListener("mouseover", function() {
    this.style.transform = "translateY(-2px)";
    this.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.4)";
  });
  
  editUserBtn.addEventListener("mouseout", function() {
    this.style.transform = "translateY(0)";
    this.style.boxShadow = "none";
  });
  
  editUserBtn.addEventListener("click", function() {
    alert("Edit functionality coming soon!");
  });
  
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });
}

function showUserDetail(user) {
  const modal = document.getElementById("userDetailModal");
  if (!modal) return;
  
  const getRoleColor = (role) => {
    switch(role) {
      case "Student": return "#3498db";
      case "Instructor": return "#2ecc71";
      case "Admin": return "#e74c3c";
      default: return "#95a5a6";
    }
  };
  
  const getStatusColor = (status) => {
    switch(status) {
      case "Active": return "#27ae60";
      case "Pending": return "#f39c12";
      case "Inactive": return "#e74c3c";
      default: return "#95a5a6";
    }
  };
  
  const modalContent = document.getElementById("modalContent");
  modalContent.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Full Name</p>
        <p style="margin: 0; font-size: 18px; font-weight: 600; color: #333;">${user.name}</p>
      </div>
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">User ID</p>
        <p style="margin: 0; font-size: 18px; font-weight: 600; color: #667eea;">#${user.id}</p>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Email Address</p>
        <p style="margin: 0; font-size: 14px; color: #555; word-break: break-all;">${user.email}</p>
      </div>
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Role</p>
        <span style="display: inline-block; background: ${getRoleColor(user.role)}; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">${user.role}</span>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; padding: 15px; background: rgba(102, 126, 234, 0.05); border-radius: 8px; border-left: 4px solid ${getRoleColor(user.role)};">
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Account Status</p>
        <span style="display: inline-block; background: ${getStatusColor(user.status)}; color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">● ${user.status}</span>
      </div>
      <div>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Account Type</p>
        <p style="margin: 0; font-size: 14px; font-weight: 500; color: #333;">${user.role} Account</p>
      </div>
    </div>
    
    <div style="background: #f0f4ff; padding: 15px; border-radius: 8px; margin-top: 15px;">
      <p style="margin: 0; color: #667eea; font-size: 12px; font-weight: 600;">ℹ️ Last Updated: ${new Date().toLocaleTimeString()}</p>
    </div>
  `;
  
  modal.style.display = "flex";
}



const renderUsers = () => {
  const userTableBody = document.getElementById("userTableBody");
  if (!userTableBody) return;
  const query = filters.users.query.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    const matchQuery =
      !query ||
      user.name?.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query);
    const matchRole = filters.users.role === "all" || user.role === filters.users.role;
    const matchStatus = filters.users.status === "all" || user.status === filters.users.status;
    return matchQuery && matchRole && matchStatus;
  });

  if (!filteredUsers.length) {
    userTableBody.innerHTML = `
      <tr>
        <td colspan="4"><div class="empty-state">No users match your filters.</div></td>
      </tr>
    `;
    return;
  }

  userTableBody.innerHTML = filteredUsers
    .map(
      (user) => `
      <tr>
        <td data-label="Name">${user.name}</td>
        <td data-label="Role">${user.role}</td>
        <td data-label="Status">${user.status}</td>
        <td data-label="Actions"><button class="btn btn-small btn-secondary user-view-btn" data-user-id="${user.id}" data-user-role="${user.role}">View</button></td>
      </tr>`
    )
    .join("");
  
  // Add event listeners for view buttons
  userTableBody?.querySelectorAll(".user-view-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-user-id"));
      const role = btn.getAttribute("data-user-role");
      const user = users.find((item) => item.id === id && item.role === role);
      if (user) showUserDetail(user);
    });
  });
};

const renderContent = () => {
  const contentList = document.getElementById("contentList");
  if (!contentList) return;
  
  // Filter to show only pending content
  const pendingItems = pendingContent.filter((item) => item.status === "pending");
  const query = filters.content.query.trim().toLowerCase();
  const typeFilter = filters.content.type;
  const filteredItems = pendingItems.filter((item) => {
    const matchQuery = !query || item.title?.toLowerCase().includes(query);
    const matchType = typeFilter === "all" || (item.type || "").toLowerCase() === typeFilter;
    return matchQuery && matchType;
  });

  const contentTypeFilter = document.getElementById("contentTypeFilter");
  if (contentTypeFilter) {
    const availableTypes = [...new Set(pendingItems.map((item) => (item.type || "").trim()).filter(Boolean))];
    const current = filters.content.type;
    contentTypeFilter.innerHTML =
      '<option value="all">All types</option>' +
      availableTypes.map((type) => `<option value="${type.toLowerCase()}">${type}</option>`).join("");
    contentTypeFilter.value = availableTypes.some((t) => t.toLowerCase() === current) ? current : "all";
  }
  
  if (filteredItems.length === 0) {
    contentList.innerHTML = '<li><div class="empty-state">No pending content matches your filters.</div></li>';
    return;
  }
  
  contentList.innerHTML = filteredItems
    .map(
      (item) => `
      <li>
        <div class="content-item-body">
          <h3>${item.title}</h3>
          <p>${item.type} submission awaiting review</p>
        </div>
        <div class="content-item-actions">
          <button class="btn btn-small btn-approve approve-btn" data-id="${item.id}">Approve</button>
          <button class="btn btn-small btn-muted deny-btn" data-id="${item.id}">Deny</button>
        </div>
      </li>`
    )
    .join("");
  
  // Add event listeners for approve buttons
  contentList?.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      btn.textContent = "Approving...";
      btn.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/admin/content/${id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (response.ok) {
          // Reload content after approval
          await loadContent();
          await updateStats();
        } else {
          alert("Failed to approve content");
          btn.textContent = "Approve";
          btn.disabled = false;
        }
      } catch (_error) {
        alert("Failed to approve content: " + _error.message);
        btn.textContent = "Approve";
        btn.disabled = false;
      }
    });
  });
  
  // Add event listeners for deny buttons
  contentList?.querySelectorAll(".deny-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      btn.textContent = "Denying...";
      btn.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/admin/content/${id}/deny`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (response.ok) {
          // Reload content after denial
          await loadContent();
          await updateStats();
        } else {
          alert("Failed to deny content");
          btn.textContent = "Deny";
          btn.disabled = false;
        }
      } catch (_error) {
        alert("Failed to deny content: " + _error.message);
        btn.textContent = "Deny";
        btn.disabled = false;
      }
    });
  });
};

const renderReports = () => {
  const reportCards = document.getElementById("reportCards");
  if (!reportCards) return;
  
  const query = filters.reports.query.trim().toLowerCase();
  const statusFilter = filters.reports.status;
  const priorityFilter = filters.reports.priority;
  const filteredReports = reports.filter((item) => {
    const matchQuery = !query || item.title?.toLowerCase().includes(query);
    const matchStatus = statusFilter === "all" || (item.status || "").toLowerCase() === statusFilter;
    const matchPriority = priorityFilter === "all" || (item.priority || "").toLowerCase() === priorityFilter;
    return matchQuery && matchStatus && matchPriority;
  });
  
  const getStatusColor = (status) => {
    switch(status?.toLowerCase()) {
      case "open": return "#e74c3c";
      case "completed": return "#27ae60";
      case "denied": return "#95a5a6";
      case "pending": return "#f39c12";
      default: return "#95a5a6";
    }
  };
  
  const getPriorityIcon = (priority) => {
    switch(priority?.toLowerCase()) {
      case "high": return "🔴";
      case "medium": return "🟡";
      case "low": return "🟢";
      default: return "⚪";
    }
  };
  
  if (filteredReports.length === 0) {
    reportCards.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No reports match your filters.</div>';
    return;
  }
  
  reportCards.innerHTML = filteredReports
    .map(
      (item) => `
      <article class="report-card" style="background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%); border-left: 4px solid ${getStatusColor(item.status)}; cursor: pointer; transition: all 0.3s; padding: 16px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
          <strong style="color: #333; font-size: 16px;">${item.title}</strong>
          <span style="font-size: 18px;">${getPriorityIcon(item.priority)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex: 1;">
          <span style="background: ${getStatusColor(item.status)}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase;">● ${item.status}</span>
          <span style="color: #667eea; font-weight: 700; font-size: 14px;">${item.value}</span>
        </div>
        <div class="report-actions">
          <button class="btn btn-small btn-approve report-resolve-btn" data-id="${item.id}">Resolve</button>
          <button class="btn btn-small btn-muted report-deny-btn" data-id="${item.id}">Dismiss</button>
        </div>
      </article>`
    )
    .join("");
  
  // Add hover effects
  reportCards.querySelectorAll(".report-card").forEach((card) => {
    card.addEventListener("mouseover", function() {
      this.style.transform = "translateY(-4px)";
      this.style.boxShadow = "0 8px 20px rgba(0,0,0,0.12)";
    });
    
    card.addEventListener("mouseout", function() {
      this.style.transform = "translateY(0)";
      this.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
    });
  });
  
  // Add event listeners for resolve buttons
  reportCards?.querySelectorAll(".report-resolve-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      btn.textContent = "Resolving...";
      btn.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/admin/reports/${id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (response.ok) {
          await loadReports();
          await updateStats();
        } else {
          alert("Failed to resolve report");
          btn.textContent = "Resolve";
          btn.disabled = false;
        }
      } catch (_error) {
        alert("Failed to resolve report: " + _error.message);
        btn.textContent = "Resolve";
        btn.disabled = false;
      }
    });
  });
  
  // Add event listeners for deny buttons
  reportCards?.querySelectorAll(".report-deny-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      btn.textContent = "Dismissing...";
      btn.disabled = true;
      try {
        const response = await fetch(`${API_BASE_URL}/admin/reports/${id}/deny`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (response.ok) {
          await loadReports();
          await updateStats();
        } else {
          alert("Failed to dismiss report");
          btn.textContent = "Dismiss";
          btn.disabled = false;
        }
      } catch (_error) {
        alert("Failed to dismiss report: " + _error.message);
        btn.textContent = "Dismiss";
        btn.disabled = false;
      }
    });
  });
};

const loadUsers = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/users`);
    const payload = await response.json();
    if (payload.success) {
      users = payload.data || [];
      renderUsers();
    }
  } catch (_error) {
    console.error("Failed to load users");
  }
};

const loadContent = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/content`);
    const payload = await response.json();
    if (payload.success) {
      pendingContent = payload.data || [];
      renderContent();
    }
  } catch (_error) {
    console.error("Failed to load content");
  }
};

const loadReports = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/reports`);
    const payload = await response.json();
    if (payload.success) {
      reports = payload.data || [];
      renderReports();
      
      // Update report stats dynamically
      const openReports = reports.filter(r => r.status === 'open').length;
      const reportCountElement = document.getElementById("reportCount");
      const reportBadgeElement = document.getElementById("reportBadge");
      
      if (reportCountElement) {
        const oldValue = parseInt(reportCountElement.textContent) || 0;
        if (oldValue !== openReports) {
          reportCountElement.textContent = openReports;
          reportCountElement.closest(".stat-card").style.animation = "none";
          setTimeout(() => {
            reportCountElement.closest(".stat-card").style.animation = "pulse 0.6s ease-in-out";
          }, 10);
        }
      }
      if (reportBadgeElement) {
        reportBadgeElement.textContent = `${openReports} open`;
      }
    }
  } catch (_error) {
    console.error("Failed to load reports");
  }
};

const updateStats = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/admin/overview`);
    const payload = await response.json();
    if (payload.success) {
      const data = payload.data;
      
      // Animate stat updates with visual feedback
      const animateValue = (element, newValue, parent) => {
        if (!element) return;
        const oldValue = parseInt(element.textContent) || 0;
        
        // Add pulse animation when value changes
        if (oldValue !== newValue) {
          if (parent) {
            parent.style.animation = "none";
            setTimeout(() => {
              parent.style.animation = "pulse 0.6s ease-in-out";
            }, 10);
          }
        }
        
        const increment = (newValue - oldValue) / 15;
        let current = oldValue;
        
        const counter = setInterval(() => {
          current += increment;
          if ((increment > 0 && current >= newValue) || (increment < 0 && current <= newValue)) {
            element.textContent = newValue;
            clearInterval(counter);
          } else {
            element.textContent = Math.round(current);
          }
        }, 40);
      };
      
      // Create animation styles if not present
      if (!document.getElementById("adminAnimationStyles")) {
        const style = document.createElement("style");
        style.id = "adminAnimationStyles";
        style.textContent = `
          @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
          }
          @keyframes glow {
            0%, 100% { box-shadow: 0 0 5px rgba(102, 126, 234, 0.3); }
            50% { box-shadow: 0 0 15px rgba(102, 126, 234, 0.6); }
          }
          .stat-card:hover {
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
          }
        `;
        document.head.appendChild(style);
      }
      
      const userCountElement = document.getElementById("userCount");
      const newSignupCountElement = document.getElementById("newSignupCount");
      const reportCountElement = document.getElementById("reportCount");
      const contentCountElement = document.getElementById("contentCount");
      const reportBadgeElement = document.getElementById("reportBadge");
      
      const userCountParent = userCountElement?.closest(".stat-card");
      const newSignupParent = newSignupCountElement?.closest(".stat-card");
      const reportParent = reportCountElement?.closest(".stat-card");
      const contentParent = contentCountElement?.closest(".stat-card");
      
      if (userCountElement) {
        animateValue(userCountElement, data.activeUsers || 0, userCountParent);
      }
      if (newSignupCountElement) {
        animateValue(newSignupCountElement, data.newSignups || 0, newSignupParent);
      }
      if (reportCountElement) {
        animateValue(reportCountElement, data.pendingReports || 0, reportParent);
      }
      if (contentCountElement) {
        animateValue(contentCountElement, data.contentUpdates || 0, contentParent);
      }
      if (reportBadgeElement) {
        reportBadgeElement.textContent = `${data.pendingReports || 0} open`;
      }
    }
  } catch (_error) {
    console.error("Failed to load stats");
  }
};

// Auto-refresh stats every 10 seconds
let statsRefreshInterval;

const startStatsAutoRefresh = () => {
  // Initial load
  updateStats();
  
  // Set up periodic refresh
  statsRefreshInterval = setInterval(() => {
    updateStats();
  }, 10000); // Refresh every 10 seconds
};

const stopStatsAutoRefresh = () => {
  if (statsRefreshInterval) {
    clearInterval(statsRefreshInterval);
  }
};

const setupFilters = () => {
  const userSearch = document.getElementById("userSearch");
  const userRoleFilter = document.getElementById("userRoleFilter");
  const userStatusFilter = document.getElementById("userStatusFilter");
  const contentSearch = document.getElementById("contentSearch");
  const contentTypeFilter = document.getElementById("contentTypeFilter");
  const reportSearch = document.getElementById("reportSearch");
  const reportStatusFilter = document.getElementById("reportStatusFilter");
  const reportPriorityFilter = document.getElementById("reportPriorityFilter");

  if (userSearch) {
    userSearch.addEventListener("input", (event) => {
      filters.users.query = event.target.value || "";
      renderUsers();
    });
  }
  if (userRoleFilter) {
    userRoleFilter.addEventListener("change", (event) => {
      filters.users.role = event.target.value || "all";
      renderUsers();
    });
  }
  if (userStatusFilter) {
    userStatusFilter.addEventListener("change", (event) => {
      filters.users.status = event.target.value || "all";
      renderUsers();
    });
  }

  if (contentSearch) {
    contentSearch.addEventListener("input", (event) => {
      filters.content.query = event.target.value || "";
      renderContent();
    });
  }
  if (contentTypeFilter) {
    contentTypeFilter.addEventListener("change", (event) => {
      filters.content.type = event.target.value || "all";
      renderContent();
    });
  }

  if (reportSearch) {
    reportSearch.addEventListener("input", (event) => {
      filters.reports.query = event.target.value || "";
      renderReports();
    });
  }
  if (reportStatusFilter) {
    reportStatusFilter.addEventListener("change", (event) => {
      filters.reports.status = event.target.value || "open";
      renderReports();
    });
  }
  if (reportPriorityFilter) {
    reportPriorityFilter.addEventListener("change", (event) => {
      filters.reports.priority = event.target.value || "all";
      renderReports();
    });
  }
};

// Load all data on page load
async function initAdminDashboard() {
  // Get element references after DOM is ready
  const userTableBody = document.getElementById("userTableBody");
  const contentList = document.getElementById("contentList");
  const reportCards = document.getElementById("reportCards");
  const userCount = document.getElementById("userCount");
  const newSignupCount = document.getElementById("newSignupCount");
  const reportCount = document.getElementById("reportCount");
  const contentCount = document.getElementById("contentCount");
  const reportBadge = document.getElementById("reportBadge");
  const refreshUsers = document.getElementById("refreshUsers");
  const refreshContent = document.getElementById("refreshContent");
  const refreshReports = document.getElementById("refreshReports");
  const approveAll = document.getElementById("approveAll");
  const adminNavLinks = document.querySelectorAll(".sidebar .nav-item");
  
  // Setup nav links
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
  
  createUserModal();
  
  // Add update indicator
  const addUpdateIndicator = () => {
    if (!document.getElementById("updateIndicator")) {
      const topbar = document.querySelector(".topbar");
      if (topbar) {
        const indicator = document.createElement("span");
        indicator.id = "updateIndicator";
        indicator.style.cssText = `
          position: absolute;
          right: 150px;
          font-size: 12px;
          color: #999;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 5px;
        `;
        indicator.innerHTML = `
          <span style="width: 8px; height: 8px; background: #4CAF50; border-radius: 50%; display: inline-block; animation: pulse 2s infinite;"></span>
          <span>Live</span>
        `;
        topbar.style.position = "relative";
        topbar.appendChild(indicator);
      }
    }
  };
  
  addUpdateIndicator();
  setupFilters();
  
  // Attach event listeners to refresh buttons
  if (refreshUsers) {
    refreshUsers.addEventListener("click", async () => {
      refreshUsers.textContent = "Refreshing...";
      refreshUsers.disabled = true;
      try {
        await loadUsers();
        await updateStats();
      } catch (error) {
        console.error("Error refreshing users:", error);
        alert("Failed to refresh users");
      } finally {
        refreshUsers.textContent = "Refresh";
        refreshUsers.disabled = false;
      }
    });
  }

  if (refreshContent) {
    refreshContent.addEventListener("click", async () => {
      refreshContent.textContent = "Refreshing...";
      refreshContent.disabled = true;
      try {
        await loadContent();
        await updateStats();
      } catch (error) {
        console.error("Error refreshing content:", error);
        alert("Failed to refresh content");
      } finally {
        refreshContent.textContent = "Refresh";
        refreshContent.disabled = false;
      }
    });
  }

  if (refreshReports) {
    refreshReports.addEventListener("click", async () => {
      refreshReports.textContent = "Refreshing...";
      refreshReports.disabled = true;
      try {
        await loadReports();
        await updateStats();
      } catch (error) {
        console.error("Error refreshing reports:", error);
        alert("Failed to refresh reports");
      } finally {
        refreshReports.textContent = "Refresh";
        refreshReports.disabled = false;
      }
    });
  }

  if (approveAll) {
    approveAll.addEventListener("click", async () => {
      approveAll.textContent = "Approving...";
      approveAll.disabled = true;
      try {
        // Approve all pending content
        const pendingItems = pendingContent.filter((item) => item.status === "pending");
        for (const item of pendingItems) {
          try {
            await fetch(`${API_BASE_URL}/admin/content/${item.id}/approve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            });
          } catch (_error) {
            console.error("Failed to approve content");
          }
        }
        await loadContent();
        await updateStats();
      } catch (error) {
        console.error("Error approving content:", error);
        alert("Failed to approve content");
      } finally {
        approveAll.textContent = "Approve all";
        approveAll.disabled = false;
      }
    });
  }
  
  await loadUsers();
  await loadContent();
  await loadReports();
  startStatsAutoRefresh();
  
  // Handle page visibility changes
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopStatsAutoRefresh();
    } else {
      startStatsAutoRefresh();
    }
  });
  
  // Clean up when leaving the page
  window.addEventListener("beforeunload", () => {
    stopStatsAutoRefresh();
  });
}

initAdminDashboard();
