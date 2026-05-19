const { API_BASE_URL, getStudentId, requireRole, setupLogoutHandlers, escapeHTML } = window.EduMateShared;

const state = {
  submissionId: 0,
  title: "",
  returnPage: "courses.html",
};

const demoPaymentNumbers = {
  bkash: "Demo bKash number: 01711-111111",
  nagad: "Demo Nagad number: 01822-222222",
  rocket: "Demo Rocket number: 01933-333333",
};

function $(selector) {
  return document.querySelector(selector);
}

function showStatus(message = "", type = "info") {
  const node = $("#purchaseStatus");
  if (!node) return;
  if (!message) {
    node.className = "workspace-banner";
    node.textContent = "";
    return;
  }
  node.className = `workspace-banner is-visible is-${type}`;
  node.textContent = message;
}

function parseQueryState() {
  const params = new URLSearchParams(window.location.search || "");
  state.submissionId = Number(params.get("submissionId") || 0);
  state.title = String(params.get("title") || "Paid Class").trim();
  const requestedReturn = String(params.get("return") || "courses.html").trim();
  state.returnPage = requestedReturn.endsWith(".html") && !requestedReturn.includes("://") ? requestedReturn : "courses.html";
}

function renderSelection() {
  const titleNode = $("#paidTargetTitle");
  const metaNode = $("#paidTargetMeta");
  if (titleNode) titleNode.textContent = state.title || "Paid Class";
  if (metaNode) metaNode.textContent = `Submission ID: ${state.submissionId || "-"}`;
}

function updateDemoPaymentNumber() {
  const method = String($("#paymentMethod")?.value || "bkash").trim().toLowerCase();
  const hint = $("#demoPaymentNumber");
  if (!hint) return;
  hint.textContent = demoPaymentNumbers[method] || demoPaymentNumbers.bkash;
}

async function handleSubmit(event) {
  event.preventDefault();
  const studentId = getStudentId();
  if (!studentId) {
    window.location.href = "index.html";
    return;
  }
  if (!state.submissionId) {
    showStatus("Invalid paid class target. Please go back and try again.", "error");
    return;
  }

  const form = event.currentTarget;
  const formData = new FormData(form);
  const selectedPackageInput = document.querySelector('input[name="packageCode"]:checked');
  const packageCode = String(selectedPackageInput?.value || formData.get("packageCode") || "").trim();
  const paymentMethod = String(formData.get("paymentMethod") || "bkash").trim();
  const transactionId = String(formData.get("transactionId") || "").trim();

  if (!packageCode || !transactionId) {
    showStatus("Please choose a package and enter transaction ID.", "error");
    return;
  }

  const submitBtn = $("#purchaseSubmitBtn");
  const oldText = submitBtn?.textContent || "Submit Payment";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
  }

  try {
    showStatus("Submitting payment for admin approval...", "info");
    const response = await fetch(`${API_BASE_URL}/student/${studentId}/paid-class-purchase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submissionId: state.submissionId,
        packageCode,
        paymentMethod,
        transactionId,
      }),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok || !payload?.success) {
      const fallbackMessage = response.status
        ? `Payment request failed (HTTP ${response.status}).`
        : "Could not complete payment.";
      showStatus(payload?.message || fallbackMessage, "error");
      return;
    }

    try {
      localStorage.setItem(
        "edumatePaidPurchaseNotice",
        JSON.stringify({
          type: "success",
          message: `Payment received (${escapeHTML(transactionId)}). Await admin approval to unlock "${state.title}".`,
          at: Date.now(),
        })
      );
    } catch {
      // ignore localStorage write errors
    }

    showStatus("Payment submitted. Redirecting to course content...", "success");
    window.setTimeout(() => {
      window.location.href = state.returnPage || "courses.html";
    }, 600);
  } catch (_error) {
    showStatus("Could not connect to the server.", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    }
  }
}

function initPage() {
  if (!requireRole("student")) return;
  setupLogoutHandlers();
  parseQueryState();
  renderSelection();

  if (!state.submissionId) {
    showStatus("Missing paid class information. Please return to Course Content and try again.", "error");
  }

  $("#paymentMethod")?.addEventListener("change", updateDemoPaymentNumber);
  updateDemoPaymentNumber();

  $("#paidPurchaseForm")?.addEventListener("submit", (event) => {
    handleSubmit(event).catch(() => {
      showStatus("Could not complete payment flow.", "error");
    });
  });
}

document.addEventListener("DOMContentLoaded", initPage);
