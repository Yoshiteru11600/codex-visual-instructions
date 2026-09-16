const { install } = import.meta.env.MODE === "development"
  ? await import("/src/index.ts")
  : await import("/dist/index.js");

const review = install();
window.visualReview = review;

document.querySelector("#demo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.title = "Submitted";
});
