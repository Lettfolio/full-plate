import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App";
import { CrashGuard } from "./components/CrashGuard";
import { getSettings } from "./lib/settings";
import { attachPrefs } from "./lib/prefsSync";
import { getSaveStore } from "./state/saveStore";

// Round 7: apply the saved text size (data-text on <html>) before the first paint.
getSettings();
// Round 9: settings and onboarding flags ride along with the saves (the account mirror starts after the first paint).
attachPrefs(getSaveStore());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CrashGuard>
      <App />
    </CrashGuard>
  </StrictMode>,
);
