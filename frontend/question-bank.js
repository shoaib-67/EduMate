const bankCards = Array.from(document.querySelectorAll(".bank-card"));
const bankFilters = Array.from(document.querySelectorAll(".filters .filter-btn"));
const bankSearchInput = document.querySelector(".search-box input");

let activeBankFilter = "all";
let bankSearchTerm = "";

const normalizeBankValue = (value) => String(value || "").trim().toLowerCase();

const applyBankFilters = () => {
  bankCards.forEach((card) => {
    const text = normalizeBankValue(card.textContent);
    const matchesFilter = activeBankFilter === "all" || text.includes(activeBankFilter);
    const matchesSearch = !bankSearchTerm || text.includes(bankSearchTerm);
    card.hidden = !matchesFilter || !matchesSearch;
  });
};

bankFilters.forEach((button) => {
  button.addEventListener("click", () => {
    activeBankFilter = normalizeBankValue(button.textContent);
    applyBankFilters();
  });
});

if (bankSearchInput) {
  bankSearchInput.addEventListener("input", () => {
    bankSearchTerm = normalizeBankValue(bankSearchInput.value);
    applyBankFilters();
  });
}
