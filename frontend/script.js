const loginToggle = document.getElementById("togglePassword");
const loginPassword = document.querySelector("#loginForm input[name='password']");
const loginForm = document.getElementById("loginForm");
const signupToggle = document.getElementById("toggleSignupPassword");
const signupPassword = document.querySelector("#signupForm input[name='password']");
const signupForm = document.getElementById("signupForm");

if (loginToggle && loginPassword) {
  loginToggle.addEventListener("click", () => {
    const isHidden = loginPassword.type === "password";
    loginPassword.type = isHidden ? "text" : "password";
    loginToggle.textContent = isHidden ? "Hide" : "Show";
  });
}

if (signupToggle && signupPassword) {
  signupToggle.addEventListener("click", () => {
    const isHidden = signupPassword.type === "password";
    signupPassword.type = isHidden ? "text" : "password";
    signupToggle.textContent = isHidden ? "Hide" : "Show";
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // Placeholder for real auth flow.
    window.location.href = "student.html";
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // Placeholder for real signup flow.
    alert("Account created. Wire this to your backend.");
  });
}
