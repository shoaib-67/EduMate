const { requireRole, setupLogoutHandlers } = window.EduMateShared;

document.addEventListener("DOMContentLoaded", () => {
  if (!requireRole("student")) return;
  setupLogoutHandlers();
});
