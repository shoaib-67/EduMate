(function attachEduMateShared(windowObject) {
  const API_BASE_URL = "http://localhost:5000/api";
  const STORAGE_KEY = "edumateCurrentUser";
  const LEGACY_STORAGE_KEY = "user";
  const ROLE_STORAGE_KEYS = {
    student: "edumateCurrentUser_student",
    instructor: "edumateCurrentUser_instructor",
    admin: "edumateCurrentUser_admin",
  };
  const IS_FILE_ORIGIN = window.location.protocol === "file:" || window.location.origin === "null";

  function readStorageItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeStorageItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage failures (e.g., file:// origin or privacy mode).
    }
  }

  function removeStorageItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  }

  function readWindowNameUser() {
    try {
      return JSON.parse(window.name || "null");
    } catch {
      return null;
    }
  }

  function writeWindowNameUser(user) {
    try {
      window.name = JSON.stringify(user || {});
    } catch {
      // Ignore write failures.
    }
  }

  function clearWindowNameUser() {
    try {
      window.name = "";
    } catch {
      // Ignore clear failures.
    }
  }

  function getStoredUser() {
    return getStoredUserByRole();
  }

  function normalizeRoleValue(value) {
    return String(value || "").trim().toLowerCase();
  }

  function getRoleStorageKey(role) {
    const normalizedRole = normalizeRoleValue(role);
    return ROLE_STORAGE_KEYS[normalizedRole] || null;
  }

  function parseStoredUser(serialized) {
    if (!serialized) return null;
    try {
      const parsed = JSON.parse(serialized);
      if (parsed && typeof parsed === "object") return parsed;
      return null;
    } catch {
      return null;
    }
  }

  function getStoredUserByRole(expectedRole = null) {
    const allowedRoles = Array.isArray(expectedRole)
      ? expectedRole.map((role) => normalizeRoleValue(role)).filter(Boolean)
      : expectedRole
        ? [normalizeRoleValue(expectedRole)]
        : [];

    try {
      for (const role of allowedRoles) {
        const roleKey = getRoleStorageKey(role);
        if (!roleKey) continue;
        const roleUser = parseStoredUser(readStorageItem(roleKey));
        if (roleUser) return roleUser;
      }

      const genericUser = parseStoredUser(readStorageItem(STORAGE_KEY)) || parseStoredUser(readStorageItem(LEGACY_STORAGE_KEY));
      if (genericUser) {
        if (!allowedRoles.length) return genericUser;
        if (allowedRoles.includes(normalizeRoleValue(genericUser.role))) return genericUser;
      }

      if (IS_FILE_ORIGIN) {
        const windowUser = readWindowNameUser();
        if (!allowedRoles.length) return windowUser;
        if (allowedRoles.includes(normalizeRoleValue(windowUser?.role))) return windowUser;
      }

      return null;
    } catch {
      if (!IS_FILE_ORIGIN) return null;
      const windowUser = readWindowNameUser();
      if (!allowedRoles.length) return windowUser;
      return allowedRoles.includes(normalizeRoleValue(windowUser?.role)) ? windowUser : null;
    }
  }

  function setStoredUser(user) {
    const serializedUser = JSON.stringify(user || {});
    const roleKey = getRoleStorageKey(user?.role);
    writeStorageItem(STORAGE_KEY, serializedUser);
    writeStorageItem(LEGACY_STORAGE_KEY, serializedUser);
    if (roleKey) {
      writeStorageItem(roleKey, serializedUser);
    }
    if (IS_FILE_ORIGIN) {
      writeWindowNameUser(user);
    }
  }

  function clearStoredUser(role = null) {
    const roleKey = getRoleStorageKey(role);
    if (roleKey) {
      removeStorageItem(roleKey);

      const genericUser = parseStoredUser(readStorageItem(STORAGE_KEY)) || parseStoredUser(readStorageItem(LEGACY_STORAGE_KEY));
      if (normalizeRoleValue(genericUser?.role) === normalizeRoleValue(role)) {
        removeStorageItem(STORAGE_KEY);
        removeStorageItem(LEGACY_STORAGE_KEY);
      }
    } else {
      removeStorageItem(STORAGE_KEY);
      removeStorageItem(LEGACY_STORAGE_KEY);
      Object.values(ROLE_STORAGE_KEYS).forEach((key) => removeStorageItem(key));
    }

    if (IS_FILE_ORIGIN) {
      clearWindowNameUser();
    }
  }

  function getUserRole(user = getStoredUser()) {
    return String(user?.role || "").trim().toLowerCase();
  }

  function hasRole(expectedRole, user = getStoredUser()) {
    const allowedRoles = Array.isArray(expectedRole) ? expectedRole : [expectedRole];
    const currentRole = getUserRole(user);
    return allowedRoles.map((role) => String(role || "").trim().toLowerCase()).includes(currentRole);
  }

  function requireRole(expectedRole, options = {}) {
    const { redirectTo = "index.html", allowAnonymous = false } = options;
    const user = getStoredUserByRole(expectedRole);

    if (!user) {
      if (allowAnonymous) {
        return null;
      }
      window.location.href = redirectTo;
      return null;
    }

    if (!hasRole(expectedRole, user)) {
      window.location.href = redirectTo;
      return null;
    }

    return user;
  }

  function setupLogoutHandlers(selector = ".logout-btn") {
    document.querySelectorAll(selector).forEach((button) => {
      if (button.dataset.logoutReady === "true") return;
      button.dataset.logoutReady = "true";
      button.addEventListener("click", () => {
        const currentRole = getStoredUser()?.role;
        clearStoredUser(currentRole || null);
      });
    });
  }

  function getStudentId() {
    return getStoredUserByRole("student")?.id || null;
  }

  function getInstructorId() {
    return getStoredUserByRole("instructor")?.id || null;
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function enhanceResponsiveTables(root = document) {
    root.querySelectorAll("table").forEach((table) => {
      const headers = Array.from(table.querySelectorAll("thead th")).map((header) =>
        header.textContent.trim()
      );
      if (!headers.length) return;
      table.querySelectorAll("tbody tr").forEach((row) => {
        Array.from(row.children).forEach((cell, index) => {
          if (!cell.hasAttribute("data-label") && headers[index]) {
            cell.setAttribute("data-label", headers[index]);
          }
        });
      });
    });
  }

  function setupFilterButtonGroups(root = document) {
    root.querySelectorAll(".filters").forEach((group) => {
      const buttons = Array.from(group.querySelectorAll(".filter-btn"));
      buttons.forEach((button) => {
        if (button.dataset.filterReady === "true") return;
        button.dataset.filterReady = "true";
        button.addEventListener("click", () => {
          buttons.forEach((item) => item.classList.toggle("active", item === button));
        });
      });
    });
  }

  function setupCommonUiEnhancements(root = document) {
    enhanceResponsiveTables(root);
    setupFilterButtonGroups(root);
  }

  function setupTabSync(onRefresh, options = {}) {
    if (typeof onRefresh !== "function") return () => {};

    const minIntervalMs = Number(options.minIntervalMs || 1500);
    let lastRunAt = 0;
    let refreshTimer = null;

    const runRefresh = (force = false) => {
      const now = Date.now();
      if (!force && now - lastRunAt < minIntervalMs) return;
      lastRunAt = now;
      windowObject.clearTimeout(refreshTimer);
      refreshTimer = null;
      Promise.resolve()
        .then(() => onRefresh())
        .catch(() => {});
    };

    const scheduleRefresh = (force = false) => {
      windowObject.clearTimeout(refreshTimer);
      refreshTimer = windowObject.setTimeout(() => runRefresh(force), 120);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        scheduleRefresh();
      }
    };

    const handleFocus = () => {
      scheduleRefresh();
    };

    const handlePageShow = () => {
      scheduleRefresh(true);
    };

    const handleStorage = () => {
      scheduleRefresh(true);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    windowObject.addEventListener("focus", handleFocus);
    windowObject.addEventListener("pageshow", handlePageShow);
    windowObject.addEventListener("storage", handleStorage);

    return () => {
      windowObject.clearTimeout(refreshTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      windowObject.removeEventListener("focus", handleFocus);
      windowObject.removeEventListener("pageshow", handlePageShow);
      windowObject.removeEventListener("storage", handleStorage);
    };
  }

  function setupAccountStatusGuard(expectedRole, options = {}) {
    const role = normalizeRoleValue(expectedRole);
    if (!role) return () => {};

    const redirectTo = String(
      options.redirectTo ||
        (role === "admin" ? "admin-login.html" : "index.html")
    ).trim();
    const intervalMs = Number(options.intervalMs || 15000);
    let running = false;
    let timerId = null;

    async function fetchAccountState(user) {
      if (!user?.id) return { valid: false, reason: "missing_user" };

      if (role === "student") {
        const response = await fetch(`${API_BASE_URL}/student/${user.id}/profile`);
        if (!response.ok) return { valid: false, reason: "not_found" };
        const payload = await response.json().catch(() => ({}));
        if (!payload?.success || !payload?.data) return { valid: false, reason: "invalid_payload" };
        const status = String(payload.data.accountStatus || "").trim().toLowerCase();
        if (status === "frozen") return { valid: false, reason: "frozen" };
        return { valid: true };
      }

      if (role === "instructor") {
        const response = await fetch(`${API_BASE_URL}/instructor/${user.id}/profile`);
        if (!response.ok) return { valid: false, reason: "not_found" };
        const payload = await response.json().catch(() => ({}));
        if (!payload?.success || !payload?.data) return { valid: false, reason: "invalid_payload" };
        const status = String(payload.data.accountStatus || "").trim().toLowerCase();
        if (status === "frozen") return { valid: false, reason: "frozen" };
        return { valid: true };
      }

      if (role === "admin") {
        const response = await fetch(`${API_BASE_URL}/admin/users`);
        if (!response.ok) return { valid: false, reason: "not_found" };
        const payload = await response.json().catch(() => ({}));
        if (!payload?.success || !Array.isArray(payload?.data)) return { valid: false, reason: "invalid_payload" };
        const matched = payload.data.find(
          (item) =>
            Number(item?.id || 0) === Number(user.id) &&
            normalizeRoleValue(item?.role) === "admin"
        );
        if (!matched) return { valid: false, reason: "deleted" };
        const status = String(matched.accountStatus || matched.status || "").trim().toLowerCase();
        if (status === "frozen") return { valid: false, reason: "frozen" };
        return { valid: true };
      }

      return { valid: true };
    }

    function forceLogout(reason = "session_invalid") {
      try {
        clearStoredUser(role);
      } finally {
        const target = `${redirectTo}?reason=${encodeURIComponent(reason)}`;
        if (window.location.href !== target) {
          window.location.href = target;
        }
      }
    }

    async function runCheck() {
      if (running) return;
      running = true;
      try {
        const user = getStoredUserByRole(role);
        if (!user) return;
        const state = await fetchAccountState(user);
        if (!state.valid) {
          forceLogout(state.reason || "session_invalid");
        }
      } catch {
        // Ignore transient network failures.
      } finally {
        running = false;
      }
    }

    runCheck();
    timerId = windowObject.setInterval(runCheck, Math.max(5000, intervalMs));

    const handleVisibility = () => {
      if (!document.hidden) runCheck();
    };
    const handleFocus = () => runCheck();

    document.addEventListener("visibilitychange", handleVisibility);
    windowObject.addEventListener("focus", handleFocus);

    return () => {
      if (timerId) {
        windowObject.clearInterval(timerId);
        timerId = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      windowObject.removeEventListener("focus", handleFocus);
    };
  }

  function observeTableChanges() {
    if (!windowObject.MutationObserver) return;
    const observer = new MutationObserver((mutations) => {
      if (
        mutations.some((mutation) =>
          Array.from(mutation.addedNodes).some(
            (node) => node.nodeType === 1 && (node.matches?.("tr, td, table") || node.querySelector?.("tr, td, table"))
          )
        )
      ) {
        enhanceResponsiveTables();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setupCommonUiEnhancements();
      observeTableChanges();
    });
  } else {
    setupCommonUiEnhancements();
    observeTableChanges();
  }

  windowObject.EduMateShared = {
    API_BASE_URL,
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    getStoredUser,
    setStoredUser,
    clearStoredUser,
    getUserRole,
    hasRole,
    requireRole,
    setupLogoutHandlers,
    getStudentId,
    getInstructorId,
    escapeHTML,
    enhanceResponsiveTables,
    setupCommonUiEnhancements,
    setupTabSync,
    setupAccountStatusGuard,
  };
})(window);
