const loginToggle = document.getElementById("togglePassword");
const loginPassword = document.querySelector("#loginForm input[name='password']");
const loginForm = document.getElementById("loginForm");
const signupToggle = document.getElementById("toggleSignupPassword");
const signupPassword = document.querySelector("#signupForm input[name='password']");
const signupForm = document.getElementById("signupForm");

if (loginToggle && loginPassword) {
  loginToggle.addEventListener("click", () => {
    const isHidden = loginPassword.type === "password";
    loginPassword.type = isHidden ? "text" : "password";
    loginToggle.textContent = isHidden ? "Hide" : "Show";
  });
}

if (signupToggle && signupPassword) {
  signupToggle.addEventListener("click", () => {
    const isHidden = signupPassword.type === "password";
    signupPassword.type = isHidden ? "text" : "password";
    signupToggle.textContent = isHidden ? "Hide" : "Show";
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // Placeholder for real auth flow.
    window.location.href = "student.html";
  });
}

if (signupForm) {
  signupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // Placeholder for real signup flow.
    alert("Account created. Wire this to your backend.");
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

const navAnchors = document.querySelectorAll("a[href^='#']");
navAnchors.forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    const targetId = anchor.getAttribute("href");
    const target = targetId ? document.querySelector(targetId) : null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

const menuToggle = document.getElementById("menuToggle");
const mobileMenu = document.getElementById("mobileMenu");
if (menuToggle && mobileMenu) {
  menuToggle.addEventListener("click", () => {
    mobileMenu.classList.toggle("open");
  });
  mobileMenu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => mobileMenu.classList.remove("open"));
  });
}

const counters = document.querySelectorAll("[data-count]");
const counterObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
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
  });
}, { threshold: 0.3 });

counters.forEach((counter) => counterObserver.observe(counter));

const revealElements = document.querySelectorAll(".reveal");
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add("visible");
    }
  });
}, { threshold: 0.15 });

revealElements.forEach((item) => revealObserver.observe(item));

const sectionIds = ["home", "features", "packages", "contact"];
const allNavLinks = document.querySelectorAll(".nav-links a");
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const id = entry.target.getAttribute("id");
    allNavLinks.forEach((link) => {
      const isActive = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("active", isActive);
    });
  });
}, { threshold: 0.4 });

sectionIds.forEach((id) => {
  const section = document.getElementById(id);
  if (section) sectionObserver.observe(section);
});

const faqItems = document.querySelectorAll(".faq-item");
faqItems.forEach((item, index) => {
  const button = item.querySelector(".faq-question");
  if (!button) return;
  if (index === 0) item.classList.add("open");
  button.addEventListener("click", () => {
    item.classList.toggle("open");
  });
});

const copyEmailBtn = document.getElementById("copyEmailBtn");
const supportEmail = document.getElementById("supportEmail");
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

const backToTop = document.getElementById("backToTop");
if (backToTop) {
  window.addEventListener("scroll", () => {
    backToTop.classList.toggle("show", window.scrollY > 350);
  });
  backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}
