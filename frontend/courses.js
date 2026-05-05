const courseCards = Array.from(document.querySelectorAll(".course-card"));
const courseFilters = Array.from(document.querySelectorAll(".filters .filter-btn"));
const courseSearchInput = document.querySelector(".search-box input");

let activeCourseFilter = "all";
let courseSearchTerm = "";

const normalize = (value) => String(value || "").trim().toLowerCase();

const getCourseText = (card) => normalize(card.textContent);

const applyCourseFilters = () => {
  courseCards.forEach((card) => {
    const text = getCourseText(card);
    const matchesSearch = !courseSearchTerm || text.includes(courseSearchTerm);
    const filterTerms = activeCourseFilter.split("+").filter(Boolean);
    const matchesFilter =
      activeCourseFilter === "all" || filterTerms.every((term) => text.includes(term));
    card.hidden = !matchesSearch || !matchesFilter;
  });
};

courseFilters.forEach((button) => {
  button.addEventListener("click", () => {
    activeCourseFilter = normalize(button.textContent);
    applyCourseFilters();
  });
});

if (courseSearchInput) {
  courseSearchInput.addEventListener("input", () => {
    courseSearchTerm = normalize(courseSearchInput.value);
    applyCourseFilters();
  });
}
