const USER_ROLE_CONFIG = {
  student: {
    table: "students",
    idColumn: "student_id",
    displayRole: "Student",
    canManage: true,
  },
  instructor: {
    table: "instructors",
    idColumn: "instructor_id",
    displayRole: "Instructor",
    canManage: true,
  },
  admin: {
    table: "admins",
    idColumn: "admin_id",
    displayRole: "Admin",
    canManage: false,
  },
};

function getManageableUserConfig(role) {
  const cleanRole = String(role || "").trim().toLowerCase();
  const config = USER_ROLE_CONFIG[cleanRole];
  return config?.canManage ? config : null;
}

function formatAccountStatus(accountStatus) {
  return String(accountStatus || "active").toLowerCase() === "frozen" ? "Frozen" : "Active";
}

function sanitizeAdminUserPayload(user = {}) {
  return {
    id: Number(user.id) || 0,
    name: user.name || "",
    email: user.email || "",
    phoneNumber: user.phoneNumber || "",
    role: user.role || "",
    accountStatus: user.accountStatus || "active",
    createdAt: user.createdAt || null,
    status: formatAccountStatus(user.accountStatus),
  };
}

function validateAccountPayload(body) {
  const cleanFullName = String(body?.fullName || body?.name || "").trim();
  const cleanEmail = String(body?.email || "").trim().toLowerCase();
  const cleanPhone = String(body?.phone || body?.phoneNumber || "").trim();
  const cleanPassword = String(body?.password || "");
  const cleanRole = String(body?.role || "").trim().toLowerCase();

  if (!cleanFullName || !cleanEmail || !cleanPassword || !cleanRole) {
    return { error: "Name, email, password, and role are required." };
  }

  if (!getManageableUserConfig(cleanRole)) {
    return { error: "Only student and instructor accounts can be managed here." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { error: "Please provide a valid email address." };
  }

  if (cleanPassword.length < 8) {
    return { error: "Password must be at least 8 characters long." };
  }

  return {
    value: {
      fullName: cleanFullName,
      email: cleanEmail,
      phone: cleanPhone || null,
      password: cleanPassword,
      role: cleanRole,
    },
  };
}

async function logAdminActivity(pool, { action, targetType, targetId, targetLabel, details }) {
  await pool.query(
    `
    INSERT INTO admin_activity_logs (action, target_type, target_id, target_label, details)
    VALUES (?, ?, ?, ?, ?)
    `,
    [action, targetType, targetId || null, targetLabel || null, details ? JSON.stringify(details) : null]
  );
}

module.exports = {
  USER_ROLE_CONFIG,
  getManageableUserConfig,
  formatAccountStatus,
  sanitizeAdminUserPayload,
  validateAccountPayload,
  logAdminActivity,
};

