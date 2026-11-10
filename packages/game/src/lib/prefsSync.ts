/**
 * Round 9: settings and the hands-on onboarding flags ride along with the saves — one small `prefs` document in the
 * player's account (saveStore.ts), with localStorage as the cache. Called once from main.tsx.
 */
import type { SaveStore } from "../state/saveStore";
import { adoptSettings, DEFAULT_SETTINGS, getSettings, onSettingsChange, type Settings } from "./settings";
import { adoptOnboardKeys, forgetOnboardKeys, knownOnboardKeys, onOnboardMark } from "./onboardFlags";

export function attachPrefs(store: SaveStore): void {
  store.attachPrefs({
    read: () => ({ settings: { ...getSettings() }, onboard: knownOnboardKeys() }),
    adopt: (p) => {
      if (p.settings) adoptSettings(p.settings as Partial<Settings>);
      if (p.onboard) adoptOnboardKeys(p.onboard);
    },
    // Round 11 (S5): another account used this browser last: its settings and flags don't carry over.
    forget: () => { adoptSettings(DEFAULT_SETTINGS); forgetOnboardKeys(); },
  });
  onSettingsChange(() => store.prefsChanged());
  onOnboardMark(() => store.prefsChanged());
}
