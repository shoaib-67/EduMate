import { API_BASE_URL, escapeHTML } from "../shared.js";
import { state, roleToApiParam, toSafeAdminUser } from "../state.js";
import { showToast } from "../ui/toast.js";
import { showUserDetail } from "../ui/modals.js";

export const setUserFormMessage = (message, type = "neutral") => {
  const userFormMessage = document.getElementById("userFormMessage");
  if (!userFormMessage) return;
  userFormMessage.textContent = message || "";
  userFormMessage.dataset.type = type;
};

const getInitials = (name) =>
  String(name || "U")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "U";

const summarizePendingTransactions = (transactionIdsText, maxVisible = 2) => {
  const ids = String(transactionIdsText || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!ids.length) return "";
  const latest = ids[0] || "";
  return latest.replace(/\s*\[[^\]]*]\s*/g, "").trim();
};

const summarizeRecentTransactions = (transactionIdsText, maxVisible = 1) => {
  const items = String(transactionIdsText || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!items.length) return "";
  const latest = items[0] || "";
  return latest.replace(/\s*\[[^\]]*]\s*/g, "").trim();
};

export async function loadUsers() {
  const response = await fetch(`${API_BASE_URL}/admin/users`);
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "Could not load users.");
  }
  state.users = (payload.data || []).map(toSafeAdminUser);
  return state.users;
}

export function renderUsers() {
  const tableBody = document.getElementById("userTableBody");
  const emptyState = document.getElementById("userEmptyState");
  if (!tableBody) return;

  const query = state.filters.users.query.trim().toLowerCase();
  const roleFilter = String(state.filters.users.role || "all").toLowerCase();
  const statusFilter = String(state.filters.users.status || "all").toLowerCase();

  const filteredUsers = state.users.filter((user) => {
    const nameTokens = String(user.name || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const email = String(user.email || "").toLowerCase();
    const [emailLocal] = email.split("@");
    const emailTokens = emailLocal.split(/[._-]+/).filter(Boolean);
    const queryTokens = query.split(/\s+/).filter(Boolean);
    const allTokens = [...nameTokens, ...emailTokens];
    const matchesQuery =
      !queryTokens.length ||
      queryTokens.every((token) => allTokens.some((value) => value.startsWith(token)));
    const matchesRole = roleFilter === "all" || String(user.role || "").toLowerCase() === roleFilter;
    const userStatus = String(user.accountStatus || user.status || "").toLowerCase();
    const matchesStatus = statusFilter === "all" || userStatus === statusFilter;
    return matchesQuery && matchesRole && matchesStatus;
  });

  if (!filteredUsers.length) {
    tableBody.innerHTML = "";
    if (emptyState) emptyState.classList.remove("is-hidden");
    return;
  }
  if (emptyState) emptyState.classList.add("is-hidden");

  tableBody.innerHTML = filteredUsers
    .map((user) => {
      const isStudent = String(user.role || "").toLowerCase() === "student";
      const pendingPaymentCount = Number(user.pendingPaymentCount || 0);
      const pendingTransactionSummary = summarizePendingTransactions(user.pendingTransactionIds);
      const recentPaymentCount = Number(user.recentPaymentCount || 0);
      const recentTransactionSummary = summarizeRecentTransactions(user.recentTransactionIds);
      const paidActionLabel =
        pendingPaymentCount > 0
          ? `Approve Payment${pendingPaymentCount > 1 ? ` (${pendingPaymentCount})` : ""}`
          : "Grant Access";
      const statusKey = String(user.accountStatus || user.status || "").toLowerCase();
      const statusClass = statusKey === "frozen" ? "status-frozen" : "status-active";

      return `
      <tr data-user-id="${user.id}" data-user-role="${String(user.role || "")}">
        <td>
          <div class="user-cell">
            <span class="user-avatar-sm">${escapeHTML(getInitials(user.name))}</span>
            <span class="user-meta">
              <strong>${escapeHTML(user.name)}</strong>
              <span class="user-email">${escapeHTML(user.email)}</span>
              ${
                isStudent && pendingPaymentCount > 0 && pendingTransactionSummary
                  ? `<span class="user-payment-note">Pending TXN: ${escapeHTML(pendingTransactionSummary)}</span>`
                  : isStudent && recentPaymentCount > 0 && recentTransactionSummary
                    ? `<span class="user-payment-note">Last TXN: ${escapeHTML(recentTransactionSummary)}</span>`
                  : ""
              }
            </span>
          </div>
        </td>
        <td><span class="role-pill role-${escapeHTML(String(user.role || "").toLowerCase())}">${escapeHTML(user.role)}</span></td>
        <td><span class="status-badge ${statusClass}">${escapeHTML(user.status || user.accountStatus)}</span></td>
        <td>${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "-"}</td>
        <td>
          <div class="user-action-group">
            <button class="btn btn-small btn-quiet" data-action="details">Details</button>
            ${
              state.manageableRoles.has(user.role)
                ? `<button class="btn btn-small btn-quiet" data-action="toggle-freeze">${
                    String(user.accountStatus || "").toLowerCase() === "frozen" ? "Unfreeze" : "Freeze"
                  }</button>
                   ${
                     isStudent
                       ? `<button class="btn btn-small btn-quiet" data-action="manage-paid-access">${escapeHTML(paidActionLabel)}</button>`
                       : ""
                   }
                   <button class="btn btn-small btn-quiet btn-text-danger" data-action="delete">Delete</button>`
                : `<span class="chip blue">Protected</span>`
            }
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  tableBody.querySelectorAll("tr").forEach((row) => {
    const userId = Number(row.dataset.userId || 0);
    const user = state.users.find((u) => Number(u.id) === userId);
    if (!user) return;

    row.querySelector('[data-action="details"]')?.addEventListener("click", () => showUserDetail(user));

    row.querySelector('[data-action="toggle-freeze"]')?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const roleParam = roleToApiParam(user.role);
      const nextStatus = String(user.accountStatus || "").toLowerCase() === "frozen" ? "active" : "frozen";
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "Saving...";
      try {
        const response = await fetch(`${API_BASE_URL}/admin/users/${roleParam}/${user.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.message || "Could not update status.");

        user.accountStatus = nextStatus;
        user.status = payload.data?.status || user.status;
        renderUsers();
        showToast(payload.message || "Account updated.", "success");
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });

    row.querySelector('[data-action="delete"]')?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!confirm(`Delete ${user.name}? This cannot be undone.`)) return;
      const roleParam = roleToApiParam(user.role);
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "Deleting...";
      try {
        const response = await fetch(`${API_BASE_URL}/admin/users/${roleParam}/${user.id}`, { method: "DELETE" });
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.message || "Could not delete account.");

        state.users = state.users.filter((u) => Number(u.id) !== Number(user.id));
        renderUsers();
        showToast(payload.message || "Account deleted.", "success");
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });

    row.querySelector('[data-action="manage-paid-access"]')?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "Loading...";
      try {
        let pendingPayments = [];
        let hasPendingEndpoint = false;
        try {
          const paymentResponse = await fetch(
            `${API_BASE_URL}/admin/students/${user.id}/paid-class-payments?status=pending`
          );
          const paymentPayload = await paymentResponse.json().catch(() => null);
          if (paymentResponse.ok && paymentPayload?.success) {
            pendingPayments = Array.isArray(paymentPayload.data) ? paymentPayload.data : [];
            hasPendingEndpoint = true;
          }
        } catch {
          hasPendingEndpoint = false;
        }

        if (hasPendingEndpoint && pendingPayments.length) {
          const optionsText = pendingPayments
            .map((payment, index) => {
              const programLabel = payment.batchName || payment.courseTitle || "Student Program";
              const txn = payment.transactionId || "N/A";
              const packageName = payment.packageName || payment.packageCode || "Package";
              const amount = Number(payment.amountBdt || 0);
              const createdAt = payment.createdAt ? new Date(payment.createdAt).toLocaleString() : "Unknown";
              return `${index + 1}. ${programLabel} | TXN ${txn} | ${packageName} (BDT ${amount}) | ${createdAt}`;
            })
            .join("\n");

          const selectedText = window.prompt(
            `Select a pending payment to approve for ${user.name}.\n\n${optionsText}\n\nEnter number:`
          );
          if (selectedText == null) return;
          const selectedIndex = Number(selectedText) - 1;
          if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= pendingPayments.length) {
            showToast("Invalid selection.", "error");
            return;
          }

          const selectedPayment = pendingPayments[selectedIndex];
          const selectedProgramLabel =
            selectedPayment.batchName || selectedPayment.courseTitle || "Student Program";
          const confirmApprove = window.confirm(
            `Approve payment ${selectedPayment.transactionId || ""} for "${selectedProgramLabel}"?`
          );
          if (!confirmApprove) return;

          const approveResponse = await fetch(
            `${API_BASE_URL}/admin/students/${user.id}/paid-class-payments/${selectedPayment.paymentId}/verify`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
          );
          const approvePayload = await approveResponse.json();
          if (!approveResponse.ok || !approvePayload.success) {
            throw new Error(approvePayload.message || "Could not approve payment.");
          }

          await loadUsers();
          renderUsers();
          showToast(approvePayload.message || "Payment approved.", "success");
          return;
        }

        const grantResponse = await fetch(`${API_BASE_URL}/admin/students/${user.id}/paid-membership`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packageCode: "manual", packageName: "Admin Grant Access" }),
        });
        const grantPayload = await grantResponse.json().catch(() => null);
        if (!grantResponse.ok || !grantPayload?.success) {
          throw new Error(grantPayload?.message || "Could not grant paid class access.");
        }

        await loadUsers();
        renderUsers();
        showToast(grantPayload.message || "Access granted.", "success");
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    });
  });
}

export function bindUserCreateForm({ onCreated }) {
  const form = document.getElementById("addUserForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setUserFormMessage("", "neutral");

    const submitButton = form.querySelector('button[type="submit"]');
    const originalLabel = submitButton?.textContent || "Create";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Creating...";
    }

    try {
      const formData = new FormData(form);
      const response = await fetch(`${API_BASE_URL}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: String(formData.get("fullName") || "").trim(),
          email: String(formData.get("email") || "").trim(),
          phone: String(formData.get("phone") || "").trim(),
          role: String(formData.get("role") || "").trim(),
          password: String(formData.get("password") || "").trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.message || "Could not create account.");

      setUserFormMessage(payload.message || "Account created.", "success");
      showToast(payload.message || "Account created.", "success");
      form.reset();
      onCreated?.();
    } catch (error) {
      setUserFormMessage(error.message, "error");
      showToast(error.message, "error");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    }
  });
}
