(function initEduMateBugReport() {
  const { API_BASE_URL, getStoredUser } = window.EduMateShared || {};

  function setBugReportStatus(statusEl, message, type = "info") {
    if (!statusEl) return;
    const text = message || "";
    if (statusEl.classList.contains("profile-status")) {
      statusEl.textContent = text;
      statusEl.className = text ? `profile-status is-visible is-${type}` : "profile-status";
      return;
    }
    if (statusEl.classList.contains("workspace-banner")) {
      statusEl.textContent = text;
      if (!text) {
        statusEl.className = "workspace-banner";
        return;
      }
      const tone = type === "error" ? "error" : type === "success" ? "success" : "info";
      statusEl.className = `workspace-banner is-visible is-${tone}`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("[data-edumate-bug-report-form]");
    if (!form || !API_BASE_URL) return;

    const section = form.closest("section") || document.body;
    const statusEl = section.querySelector("[data-bug-report-status]");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const user = getStoredUser?.();
      const role = String(user?.role || "").toLowerCase();
      if (!user || !["student", "instructor"].includes(role)) {
        setBugReportStatus(statusEl, "You must be signed in as a student or instructor to send a report.", "error");
        return;
      }

      const title = String(form.querySelector('[name="title"]')?.value || "").trim();
      const description = String(form.querySelector('[name="description"]')?.value || "").trim();
      const priority = String(form.querySelector('[name="priority"]')?.value || "medium")
        .trim()
        .toLowerCase();

      if (!title || !description) {
        setBugReportStatus(statusEl, "Please add a title and describe the problem.", "error");
        return;
      }

      const submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.prevLabel = submitBtn.textContent;
        submitBtn.textContent = "Sending…";
      }
      setBugReportStatus(statusEl, "", "info");

      try {
        const response = await fetch(`${API_BASE_URL}/reports`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            category: "bug",
            priority: ["low", "medium", "high"].includes(priority) ? priority : "medium",
            reporterName: String(user.fullName || user.name || "").trim(),
            reporterEmail: String(user.email || "").trim().toLowerCase(),
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || "Could not send your report.");
        }
        form.reset();
        setBugReportStatus(
          statusEl,
          "Thanks — your report was sent to the admin team. They can review it under Reports.",
          "success"
        );
      } catch (err) {
        setBugReportStatus(statusEl, err.message || "Something went wrong.", "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.prevLabel || submitBtn.textContent;
        }
      }
    });
  });
})();
