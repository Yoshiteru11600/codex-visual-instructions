import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return <main><p>React + Vite example</p><h1>Review component output without source mapping.</h1><button>Primary action</button></main>;
}

createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.DEV) {
  import("codex-visual-instructions").then(({ install }) => install());
}
