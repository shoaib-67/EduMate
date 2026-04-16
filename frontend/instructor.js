const materials = [
  {
    title: "Physics - Kinematics Hand Note",
    subject: "Physics",
    type: "PDF",
    link: "https://drive.google.com/file/d/1Hb7WxD4PR1pAIL2rsvhmwZFWn9gNdV47/view",
    description: "Core formulas and solved examples for motion chapter.",
  },
  {
    title: "Chemistry - Organic Basics Lecture",
    subject: "Chemistry",
    type: "Video",
    link: "https://www.youtube.com/watch?v=TGCj62SkVQU&list=PLh191P7k4HWSpkd3sWvmjhoNQlyrMlkKJ",
    description: "Short lecture covering nomenclature and reaction basics.",
  },
];

const questions = [
  {
    subject: "Math",
    topic: "Derivative",
    text: "If f(x)=x^2, what is f'(3)?",
    options: { A: "3", B: "6", C: "9", D: "12" },
    correct: "B",
  },
  {
    subject: "Biology",
    topic: "Cell",
    text: "Which organelle is known as powerhouse of cell?",
    options: { A: "Nucleus", B: "Ribosome", C: "Mitochondria", D: "Golgi body" },
    correct: "C",
  },
];

const marksData = [
  { student: "Rahim", subject: "Physics", exam: "Weekly Mock 1", mark: 84 },
  { student: "Karim", subject: "Chemistry", exam: "Chapter Test 2", mark: 62 },
  { student: "Nadia", subject: "Math", exam: "Practice Set 4", mark: 91 },
  { student: "Sadia", subject: "Biology", exam: "Medical Prep 1", mark: 74 },
  { student: "Tanvir", subject: "Physics", exam: "Weekly Mock 2", mark: 56 },
];

let activeSubject = "all";

const materialForm = document.getElementById("materialForm");
const questionForm = document.getElementById("questionForm");
const materialList = document.getElementById("materialList");
const questionList = document.getElementById("questionList");
const marksTableBody = document.getElementById("marksTableBody");
const filterButtons = document.querySelectorAll(".filter-btn");

const materialCount = document.getElementById("materialCount");
const questionCount = document.getElementById("questionCount");
const studentCount = document.getElementById("studentCount");
const averageMark = document.getElementById("averageMark");

function getMarkStatus(mark) {
  if (mark >= 80) return ["Excellent", "chip"];
  if (mark >= 65) return ["Good", "chip blue"];
  if (mark >= 50) return ["Average", "chip amber"];
  return ["Needs Support", "chip red"];
}

function renderMaterials() {
  materialList.innerHTML = "";
  materials.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "list-item";
    wrapper.innerHTML = `
      <div>
        <h4>${item.title}</h4>
        <span>${item.subject} • ${item.type}</span>
        <span>${item.description}</span>
      </div>
      <a class="btn btn-sm" href="${item.link}" target="_blank" rel="noopener noreferrer">Open</a>
    `;
    materialList.appendChild(wrapper);
  });
}

function renderQuestions() {
  questionList.innerHTML = "";
  questions.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "list-item";
    wrapper.innerHTML = `
      <div>
        <h4>Q${index + 1}: ${item.topic} (${item.subject})</h4>
        <span>${item.text}</span>
        <span>Answer: ${item.correct}</span>
      </div>
      <span class="chip">${item.subject}</span>
    `;
    questionList.appendChild(wrapper);
  });
}

function renderMarks() {
  marksTableBody.innerHTML = "";
  const list = activeSubject === "all"
    ? marksData
    : marksData.filter((row) => row.subject === activeSubject);

  list.forEach((row) => {
    const [statusText, statusClass] = getMarkStatus(row.mark);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.student}</td>
      <td>${row.subject}</td>
      <td>${row.exam}</td>
      <td>${row.mark}%</td>
      <td><span class="${statusClass}">${statusText}</span></td>
    `;
    marksTableBody.appendChild(tr);
  });

  const avg = list.length
    ? Math.round(list.reduce((sum, row) => sum + row.mark, 0) / list.length)
    : 0;

  studentCount.textContent = String(list.length);
  averageMark.textContent = `${avg}%`;
}

function updateStats() {
  materialCount.textContent = String(materials.length);
  questionCount.textContent = String(questions.length);
}

materialForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(materialForm);
  materials.unshift({
    title: String(formData.get("materialTitle") || "").trim(),
    subject: String(formData.get("materialSubject") || "").trim(),
    type: String(formData.get("materialType") || "").trim(),
    link: String(formData.get("materialLink") || "").trim(),
    description: String(formData.get("materialDescription") || "").trim(),
  });
  materialForm.reset();
  renderMaterials();
  updateStats();
});

questionForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(questionForm);
  questions.unshift({
    subject: String(formData.get("questionSubject") || "").trim(),
    topic: String(formData.get("questionTopic") || "").trim(),
    text: String(formData.get("questionText") || "").trim(),
    options: {
      A: String(formData.get("optionA") || "").trim(),
      B: String(formData.get("optionB") || "").trim(),
      C: String(formData.get("optionC") || "").trim(),
      D: String(formData.get("optionD") || "").trim(),
    },
    correct: String(formData.get("correctOption") || "").trim(),
  });
  questionForm.reset();
  renderQuestions();
  updateStats();
});

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeSubject = button.dataset.subject || "all";
    filterButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    renderMarks();
  });
});

updateStats();
renderMaterials();
renderQuestions();
renderMarks();
