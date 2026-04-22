const adminLoginForm = document.getElementById("adminLoginForm");
const adminTogglePassword = document.getElementById("adminTogglePassword");
const adminPasswordInput = adminLoginForm?.querySelector("input[name='password']");

if (adminTogglePassword && adminPasswordInput) {
  adminTogglePassword.addEventListener("click", () => {
    const hidden = adminPasswordInput.type === "password";
    adminPasswordInput.type = hidden ? "text" : "password";
    adminTogglePassword.textContent = hidden ? "Hide" : "Show";
  });
}

if (adminLoginForm) {
  adminLoginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = "admin.html";
  });
}
