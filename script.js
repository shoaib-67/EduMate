const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.querySelector("input[name='password']");
const loginForm = document.getElementById("loginForm");

togglePassword.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  togglePassword.textContent = isHidden ? "Hide" : "Show";
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  // Placeholder for real auth flow.
  alert("Login submitted. Wire this to your backend.");
});
