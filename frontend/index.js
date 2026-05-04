const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => root.querySelectorAll(selector);
const { API_BASE_URL, setStoredUser } = window.EduMateShared;

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
const loginStatus = $("#loginStatus");
function showLoginStatus(message, type = "info") {
  if (!loginStatus) return;
  loginStatus.textContent = message;
  loginStatus.className = `login-status is-visible is-${type}`;
}

function clearLoginStatus() {
  if (!loginStatus) return;
  loginStatus.textContent = "";
  loginStatus.className = "login-status";
}

if (loginToggle && loginPassword) {
  loginToggle.addEventListener("click", () => {
    const isHidden = loginPassword.type === "password";
    loginPassword.type = isHidden ? "text" : "password";
    loginToggle.textContent = isHidden ? "লুকান" : "দেখুন";
  });
}

const roleConfig = {
  student: {
    title: "স্টুডেন্ট লগইন",
    subtitle: "আপনার একাউন্টে লগইন করে প্রস্তুতিকে এগিয়ে নিন।",
    demoTitle: "ডেমো একাউন্ট",
    email: "Email: demo@edumate.com",
    password: "Password: EduMate@123",
    identifierLabel: "ইমেইল বা ফোন",
    identifierPlaceholder: "name@email.com",
    submitText: "লগইন",
    action: "student.html",
    showCreateAccount: true,
  },
  instructor: {
    title: "ইন্সট্রাক্টর লগইন",
    subtitle: "আপনার ক্লাস, রুটিন, শিক্ষার্থী এবং এক্সাম ওয়ার্কস্পেস খুলুন।",
    demoTitle: "ইন্সট্রাক্টর ডেমো একাউন্ট",
    email: "Email: instructor@edumate.com",
    password: "Password: EduMate@123",
    identifierLabel: "ইন্সট্রাক্টর ইমেইল",
    identifierPlaceholder: "instructor@edumate.com",
    submitText: "ইন্সট্রাক্টর হিসেবে লগইন",
    action: "instructor.html",
    showCreateAccount: false,
  },
  admin: {
    title: "অ্যাডমিন লগইন",
    subtitle: "ইউজার, রিপোর্ট এবং প্ল্যাটফর্মের শেয়ারড কন্ট্রোল পরিচালনা করুন।",
    demoTitle: "অ্যাডমিন ডেমো একাউন্ট",
    email: "Email: admin@edumate.com",
    password: "Password: Admin@123",
    identifierLabel: "অ্যাডমিন ইমেইল",
    identifierPlaceholder: "admin@edumate.com",
    submitText: "অ্যাডমিন হিসেবে লগইন",
    action: "admin.html",
    showCreateAccount: false,
  },
};

const roleOrder = ["student", "instructor", "admin"];
const roleLabels = {
  student: "স্টুডেন্ট",
  instructor: "ইন্সট্রাক্টর",
  admin: "অ্যাডমিন",
};

let activeRole = "student";

const getNextRole = (role) => {
  const currentIndex = roleOrder.indexOf(role);
  if (currentIndex === -1) return "student";
  return roleOrder[(currentIndex + 1) % roleOrder.length];
};

const updateRoleToggleMeta = () => {
  if (!roleToggleBtn) return;
  const nextRole = getNextRole(activeRole);
  const toggleTitle = `${roleLabels[nextRole]} লগইনে যান`;
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
  if (accountCreateRow) accountCreateRow.hidden = !config.showCreateAccount;

  clearLoginStatus();
  updateRoleToggleMeta();
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
      showLoginStatus("অনুগ্রহ করে ইমেইল/ফোন এবং পাসওয়ার্ড দুটোই লিখুন।", "error");
      return;
    }

    const originalLabel = loginSubmitBtn?.textContent || "লগইন";
    if (loginSubmitBtn) {
      loginSubmitBtn.disabled = true;
      loginSubmitBtn.textContent = "লগইন হচ্ছে...";
    }
    showLoginStatus("আপনার একাউন্ট যাচাই করে ওয়ার্কস্পেস খোলা হচ্ছে।", "info");

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
        showLoginStatus(payload.message || "লগইন ব্যর্থ হয়েছে। তথ্যগুলো যাচাই করে আবার চেষ্টা করুন।", "error");
        return;
      }

      showLoginStatus("লগইন সফল হয়েছে। আপনাকে ওয়ার্কস্পেসে নেওয়া হচ্ছে।", "success");
      setStoredUser(payload.user || {});
      window.location.href = (roleConfig[activeRole] || roleConfig.student).action;
    } catch (_error) {
      showLoginStatus("এখন ব্যাকএন্ডে সংযোগ করা যাচ্ছে না। সার্ভার চালু করে আবার চেষ্টা করুন।", "error");
    } finally {
      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = originalLabel;
      }
    }
  });
}

const quoteText = $("#quoteText");
const nextQuoteBtn = $("#nextQuote");
const quotes = [
  "\"নিয়মিত চর্চাই আত্মবিশ্বাসকে সত্যিকারের প্রাপ্য করে তোলে।\"",
  "\"ছোট অগ্রগতি সবচেয়ে বেশি মূল্য পায় যখন তা প্রতিদিনের অভ্যাস হয়।\"",
  "\"পরের ধাপ পরিষ্কার থাকলে শৃঙ্খলাও অনেক সহজ লাগে।\"",
  "\"শান্ত পরিকল্পনা অনেক সময় চাপের দৌড়কে হারিয়ে দেয়।\"",
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
  (entry, observer) => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
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
      link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
    });
  },
  { threshold: 0.4 }
);

sectionIds.forEach((id) => {
  const section = document.getElementById(id);
  if (section) sectionObserver.observe(section);
});

$$(".faq-item").forEach((item, index) => {
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
