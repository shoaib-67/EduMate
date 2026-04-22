const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => root.querySelectorAll(selector);

const loginForm = $("#loginForm");
const loginToggle = $("#togglePassword");
const loginPassword = $("input[name='password']", loginForm);
const roleToggleBtn = $("#roleToggleBtn");
const loginTitle = $("#loginTitle");
const loginSubtitle = $("#loginSubtitle");
const demoTitle = $("#demoTitle");
const demoEmail = $("#demoEmail");
const demoPassword = $("#demoPassword");
const loginIdentifierLabel = $("#loginIdentifierLabel");
const loginIdentifierInput = $("#loginIdentifierInput");
const loginSubmitBtn = $("#loginSubmitBtn");
const accountCreateRow = $("#accountCreateRow");
const API_BASE_URL = "http://localhost:5000/api";

if (loginToggle && loginPassword) {
  loginToggle.addEventListener("click", () => {
    const isHidden = loginPassword.type === "password";
    loginPassword.type = isHidden ? "text" : "password";
    loginToggle.textContent = isHidden ? "Hide" : "Show";
  });
}

const roleConfig = {
  student: {
    title: "Student Login",
    subtitle: "Login to your account to continue your preparation.",
    demoTitle: "Demo account",
    email: "Email: demo@edumate.com",
    password: "Password: EduMate@123",
    identifierLabel: "Email or phone",
    identifierPlaceholder: "name@email.com",
    submitText: "Login",
    action: "student.html",
    toggleTitle: "Switch to Instructor Login",
    showCreateAccount: true,
  },
  instructor: {
    title: "Instructor Login",
    subtitle: "",
    demoTitle: "Instructor demo account",
    email: "Email: instructor@edumate.com",
    password: "Password: EduMate@123",
    identifierLabel: "Instructor email",
    identifierPlaceholder: "instructor@edumate.com",
    submitText: "Login as Instructor",
    action: "instructor.html",
    toggleTitle: "Switch to Admin Login",
    showCreateAccount: false,
  },
  admin: {
    title: "Admin Login",
    subtitle: "Login to manage users, content, and reports.",
    demoTitle: "Admin demo account",
    email: "Email: admin@edumate.com",
    password: "Password: Admin@123",
    identifierLabel: "Admin email",
    identifierPlaceholder: "admin@edumate.com",
    submitText: "Login as Admin",
    action: "admin.html",
    toggleTitle: "Switch to Student Login",
    showCreateAccount: false,
  },
};

const roleOrder = ["student", "instructor", "admin"];
const roleLabels = {
  student: "Student",
  instructor: "Instructor",
  admin: "Admin",
};

let activeRole = "student";

const getNextRole = (role) => {
  const currentIndex = roleOrder.indexOf(role);
  if (currentIndex === -1) return "student";
  const nextIndex = (currentIndex + 1) % roleOrder.length;
  return roleOrder[nextIndex];
};

const updateRoleToggleMeta = () => {
  if (!roleToggleBtn) return;
  const nextRole = getNextRole(activeRole);
  const toggleTitle = `Switch to ${roleLabels[nextRole]} Login`;
  roleToggleBtn.title = toggleTitle;
  roleToggleBtn.setAttribute("aria-label", toggleTitle);
};

const applyLoginRole = (role) => {
  const resolvedRole = roleConfig[role] ? role : "student";
  const config = roleConfig[resolvedRole];
  activeRole = resolvedRole;

  if (loginTitle) loginTitle.textContent = config.title;
  if (loginSubtitle) {
    loginSubtitle.textContent = config.subtitle;
    loginSubtitle.hidden = !config.subtitle;
  }
  if (demoTitle) demoTitle.textContent = config.demoTitle;
  if (demoEmail) demoEmail.textContent = config.email;
  if (demoPassword) demoPassword.textContent = config.password;
  if (loginIdentifierLabel) loginIdentifierLabel.textContent = config.identifierLabel;
  if (loginIdentifierInput) loginIdentifierInput.placeholder = config.identifierPlaceholder;
  if (loginSubmitBtn) loginSubmitBtn.textContent = config.submitText;
  if (loginForm) loginForm.action = config.action;
  updateRoleToggleMeta();
  if (accountCreateRow) accountCreateRow.hidden = !config.showCreateAccount;
};

if (roleToggleBtn) {
  roleToggleBtn.addEventListener("click", () => {
    applyLoginRole(getNextRole(activeRole));
  });
}

applyLoginRole("student");

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const identifier = (loginIdentifierInput?.value || "").trim();
    const password = (loginPassword?.value || "").trim();

    if (!identifier || !password) {
      alert("Please enter both identifier and password.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          identifier,
          password,
          role: activeRole,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        alert(payload.message || "Login failed.");
        return;
      }

      localStorage.setItem("edumateCurrentUser", JSON.stringify(payload.user || {}));
      window.location.href = (roleConfig[activeRole] || roleConfig.student).action;
    } catch (_error) {
      alert("Cannot connect to backend. Run node server.js and try again.");
    }
  });
}

const quoteText = document.getElementById("quoteText");
const nextQuoteBtn = document.getElementById("nextQuote");
const quotes = [
  "\"অধ্যবসায়ের কোন বিকল্প নেই।\"",
  "\"প্রতিদিনের ছোট উন্নতিই বড় সাফল্য আনে।\"",
  "\"প্রস্তুতি যত নিয়মিত, আত্মবিশ্বাস তত শক্তিশালী।\"",
];

if (quoteText && nextQuoteBtn) {
  let quoteIndex = 0;
  const setQuote = () => {
    quoteIndex = (quoteIndex + 1) % quotes.length;
    quoteText.textContent = quotes[quoteIndex];
  };
  nextQuoteBtn.addEventListener("click", setQuote);
  setInterval(setQuote, 5000);
}

$$("a[href^='#']").forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    const targetId = anchor.getAttribute("href");
    const target = targetId ? document.querySelector(targetId) : null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

const menuToggle = $("#menuToggle");
const mobileMenu = $("#mobileMenu");
if (menuToggle && mobileMenu) {
  menuToggle.addEventListener("click", () => {
    mobileMenu.classList.toggle("open");
  });
  $$("a", mobileMenu).forEach((link) => {
    link.addEventListener("click", () => mobileMenu.classList.remove("open"));
  });
}

const createObserver = (callback, options) =>
  new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => callback(entry, observer));
  }, options);

const counters = $$("[data-count]");
const counterObserver = createObserver(
  (entries, observer) => {
    if (!entries.isIntersecting) return;
    const el = entries.target;
    const target = Number(el.getAttribute("data-count")) || 0;
    const duration = 1200;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      el.textContent = Math.floor(progress * target).toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    observer.unobserve(el);
  },
  { threshold: 0.3 }
);

counters.forEach((counter) => counterObserver.observe(counter));

const revealElements = $$(".reveal");
const revealObserver = createObserver(
  (entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
    }
  },
  { threshold: 0.15 }
);

revealElements.forEach((item) => revealObserver.observe(item));

const sectionIds = ["home", "features", "packages", "contact"];
const allNavLinks = $$(".nav-links a");
const sectionObserver = createObserver(
  (entry) => {
    if (!entry.isIntersecting) return;
    const id = entry.target.getAttribute("id");
    allNavLinks.forEach((link) => {
      const isActive = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("active", isActive);
    });
  },
  { threshold: 0.4 }
);

sectionIds.forEach((id) => {
  const section = document.getElementById(id);
  if (section) sectionObserver.observe(section);
});

const faqItems = $$(".faq-item");
faqItems.forEach((item, index) => {
  const button = item.querySelector(".faq-question");
  if (!button) return;
  if (index === 0) item.classList.add("open");
  button.addEventListener("click", () => {
    item.classList.toggle("open");
  });
});

const copyEmailBtn = $("#copyEmailBtn");
const supportEmail = $("#supportEmail");
if (copyEmailBtn && supportEmail && navigator.clipboard) {
  copyEmailBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(supportEmail.textContent || "");
      copyEmailBtn.textContent = "কপি হয়েছে";
      setTimeout(() => {
        copyEmailBtn.textContent = "ইমেইল কপি করুন";
      }, 1500);
    } catch (_error) {
      copyEmailBtn.textContent = "আবার চেষ্টা করুন";
    }
  });
}

const backToTop = $("#backToTop");
if (backToTop) {
  window.addEventListener("scroll", () => {
    backToTop.classList.toggle("show", window.scrollY > 350);
  });
  backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
