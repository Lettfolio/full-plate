import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import "./phone.css"; // Round 12 — D: phone layout (all rules behind phone-sized media queries)
import { App } from "./App";
import { CrashGuard } from "./components/CrashGuard";
import { getSettings } from "./lib/settings";
import { attachPrefs } from "./lib/prefsSync";
import { getSaveStore } from "./state/saveStore";
import { installTermTap } from "./lib/termTap";

// Round 7: apply the saved text size (data-text on <html>) before the first paint.
getSettings();
// Round 9: settings and onboarding flags ride along with the saves (the account mirror starts after the first paint).
attachPrefs(getSaveStore());
// Round 13 (E): a tap in the gap between two glossary words goes to the nearer one (lib/termTap.ts).
installTermTap();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CrashGuard>
      <App />
    </CrashGuard>
  </StrictMode>,
);
