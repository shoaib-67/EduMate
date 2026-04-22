const instructorLoginForm = document.getElementById("instructorLoginForm");
const toggleInstructorPassword = document.getElementById("toggleInstructorPassword");
const instructorPassword = instructorLoginForm?.querySelector("input[name='password']");
const API_BASE_URL = "http://localhost:5000/api";

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
        alert(payload.message || "Instructor login failed.");
        return;
      }

      localStorage.setItem("edumateCurrentUser", JSON.stringify(payload.user || {}));
      window.location.href = "instructor.html";
    } catch (_error) {
      alert("Cannot connect to backend. Run node server.js and try again.");
    }
  });
}
