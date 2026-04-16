const instructorLoginForm = document.getElementById("instructorLoginForm");
const toggleInstructorPassword = document.getElementById("toggleInstructorPassword");
const instructorPassword = instructorLoginForm?.querySelector("input[name='password']");

if (toggleInstructorPassword && instructorPassword) {
  toggleInstructorPassword.addEventListener("click", () => {
    const isHidden = instructorPassword.type === "password";
    instructorPassword.type = isHidden ? "text" : "password";
    toggleInstructorPassword.textContent = isHidden ? "Hide" : "Show";
  });
}

if (instructorLoginForm) {
  instructorLoginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = "instructor.html";
  });
}
