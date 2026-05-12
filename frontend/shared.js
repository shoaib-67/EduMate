(function attachEduMateShared(windowObject) {
  const API_BASE_URL = "http://localhost:5000/api";
  const STORAGE_KEY = "edumateCurrentUser";
  const LEGACY_STORAGE_KEY = "user";
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
    try {
      const serialized = readStorageItem(STORAGE_KEY) || readStorageItem(LEGACY_STORAGE_KEY);
      if (serialized) {
        return JSON.parse(serialized);
      }

      if (IS_FILE_ORIGIN) {
        return readWindowNameUser();
      }

      return null;
    } catch {
      return IS_FILE_ORIGIN ? readWindowNameUser() : null;
    }
  }

  function setStoredUser(user) {
    const serializedUser = JSON.stringify(user || {});
    writeStorageItem(STORAGE_KEY, serializedUser);
    writeStorageItem(LEGACY_STORAGE_KEY, serializedUser);
    if (IS_FILE_ORIGIN) {
      writeWindowNameUser(user);
    }
  }

  function clearStoredUser() {
    removeStorageItem(STORAGE_KEY);
    removeStorageItem(LEGACY_STORAGE_KEY);
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

  function getInstructorId() {
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
  };
})(window);
