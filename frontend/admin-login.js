const adminLoginForm = document.getElementById("adminLoginForm");
const adminTogglePassword = document.getElementById("adminTogglePassword");
const adminPasswordInput = adminLoginForm?.querySelector("input[name='password']");
const API_BASE_URL = "http://localhost:5000/api";

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
        alert(payload.message || "Admin login failed.");
        return;
      }

      localStorage.setItem("edumateCurrentUser", JSON.stringify(payload.user || {}));
      window.location.href = "admin.html";
    } catch (_error) {
      alert("Cannot connect to backend. Run node server.js and try again.");
    }
  });
}
