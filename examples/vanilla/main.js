const { install } = import.meta.env.MODE === "development"
  ? await import("/src/index.ts")
  : await import("/dist/index.js");

const endpoint = import.meta.env.VITE_CODEX_VISUAL_BRIDGE_ENDPOINT;
const capabilityToken = import.meta.env.VITE_CODEX_VISUAL_BRIDGE_TOKEN;
const review = install({
  ...(endpoint && capabilityToken ? { workerBridge: { endpoint, capabilityToken } } : {}),
});
window.visualReview = review;

document.querySelector("#demo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.title = "Submitted";
});
