(function attachEduMateShared(windowObject) {
  const API_BASE_URL = "http://localhost:5000/api";
  const STORAGE_KEY = "edumateCurrentUser";
  const LEGACY_STORAGE_KEY = "user";

  function getStoredUser() {
    try {
      return JSON.parse(
        localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || "null"
      );
    } catch {
      return null;
    }
  }

  function setStoredUser(user) {
    const serializedUser = JSON.stringify(user || {});
    localStorage.setItem(STORAGE_KEY, serializedUser);
    localStorage.setItem(LEGACY_STORAGE_KEY, serializedUser);
  }

  function clearStoredUser() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
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
    const user = getStoredUser();

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
        clearStoredUser();
      });
    });
  }

  function getStudentId() {
    return getStoredUser()?.id || null;
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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
    escapeHTML,
  };
})(window);
