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
    const program = (signupForm.program?.value || "").trim();
    const password = (signupForm.password?.value || "").trim();
    const submitButton = signupForm.querySelector("button[type='submit']");
    const originalText = submitButton?.textContent || "অ্যাকাউন্ট তৈরি করুন";

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "অ্যাকাউন্ট তৈরি করা হচ্ছে...";
    }
    showSignupStatus("আপনার একাউন্ট তৈরি করা হচ্ছে...", "info");

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
          program,
          password,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        showSignupStatus(payload.message || "সাইনআপ ব্যর্থ হয়েছে। তথ্য পরীক্ষা করুন।", "error");
        return;
      }

      showSignupStatus("অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে। লগইনে নিয়ে যাওয়া হচ্ছে।", "success");
      setTimeout(() => {
        window.location.href = "index.html";
      }, 700);
    } catch (_error) {
      showSignupStatus("ব্যাকএন্ডে সংযোগ করা যাচ্ছে না। node server.js চালু করে আবার চেষ্টা করুন।", "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalText;
      }
    }
  });
}
