const $ = (selector, root = document) => root.querySelector(selector);
const signupForm = $("#signupForm");
const signupToggle = $("#toggleSignupPassword");
const signupPassword = $("input[name='password']", signupForm);

if (signupToggle && signupPassword) {
  signupToggle.addEventListener("click", () => {
    const isHidden = signupPassword.type === "password";
    signupPassword.type = isHidden ? "text" : "password";
    signupToggle.textContent = isHidden ? "Hide" : "Show";
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // Placeholder for real signup flow.
    alert("Account created. Wire this to your backend.");
  });
}
