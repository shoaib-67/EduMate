const $ = (selector, root = document) => root.querySelector(selector);
const signupForm = $("#signupForm");
const signupToggle = $("#toggleSignupPassword");
const signupPassword = $("input[name='password']", signupForm);
const API_BASE_URL = "http://localhost:5000/api";

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
        alert(payload.message || "Signup failed.");
        return;
      }

      alert("Account created successfully. Please login.");
      window.location.href = "index.html";
    } catch (_error) {
      alert("Cannot connect to backend. Run node server.js and try again.");
    }
  });
}
