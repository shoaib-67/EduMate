const adminLoginForm = document.getElementById("adminLoginForm");
const adminTogglePassword = document.getElementById("adminTogglePassword");
const adminPasswordInput = adminLoginForm?.querySelector("input[name='password']");
const adminLoginStatus = document.getElementById("adminLoginStatus");
const API_BASE_URL = "http://localhost:5000/api";

function showAdminStatus(message, type = "info") {
  if (!adminLoginStatus) return;
  adminLoginStatus.textContent = message;
  adminLoginStatus.className = `form-status is-visible is-${type}`;
}

if (adminTogglePassword && adminPasswordInput) {
  adminTogglePassword.addEventListener("click", () => {
    const hidden = adminPasswordInput.type === "password";
    adminPasswordInput.type = hidden ? "text" : "password";
    adminTogglePassword.textContent = hidden ? "Hide" : "Show";
  });
}

if (adminLoginForm) {
  adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const identifier = adminLoginForm.email?.value?.trim() || "";
    const password = adminPasswordInput?.value?.trim() || "";
    const submitButton = adminLoginForm.querySelector("button[type='submit']");
    const originalText = submitButton?.textContent || "Continue to Admin";

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Checking access...";
    }
    showAdminStatus("Checking admin credentials.", "info");

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier,
          password,
          role: "admin",
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        showAdminStatus(payload.message || "Admin login failed. Please check your credentials.", "error");
        return;
      }

      localStorage.setItem("edumateCurrentUser", JSON.stringify(payload.user || {}));
      showAdminStatus("Login successful. Opening the admin dashboard.", "success");
      window.location.href = "admin.html";
    } catch (_error) {
      showAdminStatus("Cannot connect to backend. Run node server.js and try again.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
  });
}
