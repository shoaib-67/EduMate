const {
  API_BASE_URL,
  getStoredUser,
  getStudentId,
  requireRole,
  setupLogoutHandlers,
  setStoredUser,
} = window.EduMateShared;

function setStatus(elementId, message, type = "info") {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message || "";
  el.className = message ? `profile-status is-visible is-${type}` : "profile-status";
}

function updateHeading(name) {
  const heading = document.getElementById("profileHeading");
  if (heading && name) {
    heading.textContent = `My Profile - ${name}`;
  }
}

async function loadProfile() {
  const studentId = getStudentId();
  if (!studentId) return;

  try {
    const response = await fetch(`${API_BASE_URL}/student/${studentId}/profile`);
    const payload = await response.json();

    if (!response.ok || !payload.success || !payload.data) {
      setStatus("profileStatus", payload.message || "Could not load profile.", "error");
      return;
    }

    const profile = payload.data;
    const fullNameInput = document.getElementById("profileFullName");
    const emailInput = document.getElementById("profileEmail");
    const phoneInput = document.getElementById("profilePhone");
    const programInput = document.getElementById("profileProgram");

    if (fullNameInput) fullNameInput.value = profile.fullName || "";
    if (emailInput) emailInput.value = profile.email || "";
    if (phoneInput) phoneInput.value = profile.phoneNumber || "";
    if (programInput) programInput.value = profile.program || "Engineering";

    updateHeading(profile.fullName || "");
  } catch (error) {
    setStatus("profileStatus", `Could not load profile: ${error.message}`, "error");
  }
}

function setupProfileForm() {
  const form = document.getElementById("profileForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const studentId = getStudentId();
    if (!studentId) return;

    const fullName = String(form.fullName?.value || "").trim();
    const phone = String(form.phone?.value || "").trim();
    const program = String(form.program?.value || "").trim();
    const saveButton = document.getElementById("profileSaveBtn");

    if (!fullName) {
      setStatus("profileStatus", "Full name is required.", "error");
      return;
    }
    if (!["Engineering", "Varsity", "Medical"].includes(program)) {
      setStatus("profileStatus", "Please choose a valid program.", "error");
      return;
    }

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
    }
    setStatus("profileStatus", "Saving profile changes...", "info");

    try {
      const response = await fetch(`${API_BASE_URL}/student/${studentId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, program }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        setStatus("profileStatus", payload.message || "Could not update profile.", "error");
        return;
      }

      const stored = getStoredUser() || {};
      setStoredUser({
        ...stored,
        fullName,
        program,
      });

      setStatus("profileStatus", payload.message || "Profile updated.", "success");
      updateHeading(fullName);
    } catch (error) {
      setStatus("profileStatus", `Could not update profile: ${error.message}`, "error");
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Save Profile";
      }
    }
  });
}

function setupPasswordForm() {
  const form = document.getElementById("passwordForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const studentId = getStudentId();
    if (!studentId) return;

    const currentPassword = String(form.currentPassword?.value || "");
    const newPassword = String(form.newPassword?.value || "");
    const confirmPassword = String(form.confirmPassword?.value || "");
    const saveButton = document.getElementById("passwordSaveBtn");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setStatus("passwordStatus", "Please fill in all password fields.", "error");
      return;
    }

    if (newPassword.length < 8) {
      setStatus("passwordStatus", "New password must be at least 8 characters.", "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus("passwordStatus", "New password and confirm password do not match.", "error");
      return;
    }

    if (currentPassword === newPassword) {
      setStatus("passwordStatus", "New password must be different from current password.", "error");
      return;
    }

    if (saveButton) {
      saveButton.disabled = true;
      saveButton.textContent = "Resetting...";
    }
    setStatus("passwordStatus", "Resetting your password...", "info");

    try {
      const response = await fetch(`${API_BASE_URL}/student/${studentId}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        setStatus("passwordStatus", payload.message || "Could not reset password.", "error");
        return;
      }

      form.reset();
      setStatus("passwordStatus", payload.message || "Password reset successful.", "success");
    } catch (error) {
      setStatus("passwordStatus", `Could not reset password: ${error.message}`, "error");
    } finally {
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = "Reset Password";
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!requireRole("student")) return;
  setupLogoutHandlers();
  setupProfileForm();
  setupPasswordForm();
  loadProfile();
});
