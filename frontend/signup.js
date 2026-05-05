const $ = (selector, root = document) => root.querySelector(selector);
const signupForm = $("#signupForm");
const signupToggle = $("#toggleSignupPassword");
const signupPassword = $("input[name='password']", signupForm);
const signupStatus = $("#signupStatus");
const API_BASE_URL = "http://localhost:5000/api";

function showSignupStatus(message, type = "info") {
  if (!signupStatus) return;
  signupStatus.textContent = message;
  signupStatus.className = `form-status is-visible is-${type}`;
}

if (signupToggle && signupPassword) {
  signupToggle.addEventListener("click", () => {
    const isHidden = signupPassword.type === "password";
    signupPassword.type = isHidden ? "text" : "password";
    signupToggle.textContent = isHidden ? "Hide" : "Show";
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fullName = (signupForm.fullName?.value || "").trim();
    const email = (signupForm.email?.value || "").trim();
    const phone = (signupForm.phone?.value || "").trim();
    const password = (signupForm.password?.value || "").trim();
    const submitButton = signupForm.querySelector("button[type='submit']");
    const originalText = submitButton?.textContent || "Create account";

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Creating account...";
    }
    showSignupStatus("Creating your account and preparing the login step.", "info");

    try {
      const response = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          password,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        showSignupStatus(payload.message || "Signup failed. Please check your details.", "error");
        return;
      }

      showSignupStatus("Account created successfully. Taking you to login.", "success");
      setTimeout(() => {
        window.location.href = "index.html";
      }, 700);
    } catch (_error) {
      showSignupStatus("Cannot connect to backend. Run node server.js and try again.", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
  });
}
