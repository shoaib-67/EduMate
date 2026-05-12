import { API_BASE_URL } from "../shared.js";
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
  const roleFilter = state.filters.users.role;
  const statusFilter = state.filters.users.status;

  const filteredUsers = state.users.filter((user) => {
    const matchesQuery =
      !query ||
      `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(query);
    const matchesRole = roleFilter === "all" || String(user.role).toLowerCase() === roleFilter;
    const matchesStatus =
      statusFilter === "all" || String(user.accountStatus || "").toLowerCase() === statusFilter;
    return matchesQuery && matchesRole && matchesStatus;
  });

  if (!filteredUsers.length) {
    tableBody.innerHTML = "";
    if (emptyState) emptyState.classList.remove("is-hidden");
    return;
  }
  if (emptyState) emptyState.classList.add("is-hidden");

  tableBody.innerHTML = filteredUsers
    .map(
      (user) => `
      <tr data-user-id="${user.id}" data-user-role="${String(user.role || "")}">
        <td>
          <div class="user-cell">
            <div class="avatar-circle">${getInitials(user.name)}</div>
            <div>
              <strong>${user.name}</strong>
              <span>${user.email}</span>
            </div>
          </div>
        </td>
        <td>${user.role}</td>
        <td><span class="status-chip status-${String(user.accountStatus || "").toLowerCase()}">${user.status || user.accountStatus}</span></td>
        <td>${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn-small btn-light" data-action="details">Details</button>
            ${
              state.manageableRoles.has(user.role)
                ? `<button class="btn btn-small" data-action="toggle-freeze">${
                    String(user.accountStatus || "").toLowerCase() === "frozen" ? "Unfreeze" : "Freeze"
                  }</button>
                   <button class="btn btn-small btn-danger" data-action="delete">Delete</button>`
                : `<span class="chip blue">Protected</span>`
            }
          </div>
        </td>
      </tr>
    `
    )
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

