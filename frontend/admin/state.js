export const state = {
  users: [],
  pendingContent: [],
  reports: [],
  activityLogs: [],
  filters: {
    users: { query: "", role: "all", status: "all" },
    content: { query: "", type: "all" },
    reports: { query: "", status: "open", priority: "all", category: "all" },
  },
  manageableRoles: new Set(["Student", "Instructor"]),
};

export const roleToApiParam = (role) => String(role || "").trim().toLowerCase();

export const toSafeAdminUser = (user = {}) => ({
  id: Number(user.id) || 0,
  name: String(user.name || "").trim(),
  email: String(user.email || "").trim(),
  phoneNumber: String(user.phoneNumber || "").trim(),
  role: String(user.role || "").trim(),
  accountStatus: String(user.accountStatus || "").trim(),
  status: String(user.status || "").trim(),
  createdAt: user.createdAt || null,
});

