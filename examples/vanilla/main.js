import { install } from "/dist/index.js";

const review = install();
window.visualReview = review;

document.querySelector("#demo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.title = "Submitted";
});
