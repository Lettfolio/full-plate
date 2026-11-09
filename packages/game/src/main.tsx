import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App";
import { getSettings } from "./lib/settings";

// Round 7: apply the saved text size (data-text on <html>) before the first paint.
getSettings();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
