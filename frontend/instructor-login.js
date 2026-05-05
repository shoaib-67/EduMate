const instructorLoginForm = document.getElementById("instructorLoginForm");
const toggleInstructorPassword = document.getElementById("toggleInstructorPassword");
const instructorPassword = instructorLoginForm?.querySelector("input[name='password']");
const instructorLoginStatus = document.getElementById("instructorLoginStatus");
const API_BASE_URL = "http://localhost:5000/api";

function showInstructorStatus(message, type = "info") {
  if (!instructorLoginStatus) return;
  instructorLoginStatus.textContent = message;
  instructorLoginStatus.className = `login-status is-visible is-${type}`;
}

if (toggleInstructorPassword && instructorPassword) {
  toggleInstructorPassword.addEventListener("click", () => {
    const isHidden = instructorPassword.type === "password";
    instructorPassword.type = isHidden ? "text" : "password";
    toggleInstructorPassword.textContent = isHidden ? "Hide" : "Show";
  });
}

if (instructorLoginForm) {
  instructorLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const identifier = instructorLoginForm.email?.value?.trim() || "";
    const password = instructorPassword?.value?.trim() || "";
    const submitButton = instructorLoginForm.querySelector("button[type='submit']");
    const originalText = submitButton?.textContent || "Login as Instructor";

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Checking access...";
    }
    showInstructorStatus("Checking instructor credentials.", "info");

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier,
          password,
          role: "instructor",
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        showInstructorStatus(payload.message || "Instructor login failed. Please check your credentials.", "error");
        return;
      }

      localStorage.setItem("edumateCurrentUser", JSON.stringify(payload.user || {}));
      showInstructorStatus("Login successful. Opening your workspace.", "success");
      window.location.href = "instructor.html";
    } catch (_error) {
      showInstructorStatus("Cannot connect to backend. Run node server.js and try again.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
  });
}
