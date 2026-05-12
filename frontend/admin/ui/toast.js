export const showToast = (message, type = "info") => {
  let toastStack = document.getElementById("toastStack");
  if (!toastStack) {
    toastStack = document.createElement("div");
    toastStack.id = "toastStack";
    toastStack.className = "toast-stack";
    document.body.appendChild(toastStack);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastStack.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 220);
  }, 3200);
};

