/**
 * Round 11 (B, U3/G2): losing is never quiet. This main-bundle part: the header chip ("Bank: 9 days left"), the words
 * on "Hire →" prompts, and the cheap checks that decide whether the cards in `BankCards.tsx` (a lazy chunk, fetched only
 * when one is due) show at all. Everything reads sim-core's `bankStatus` / `starterLoanOffer` / `hireNeed`.
 */
import { lazy } from "react";
import type { GameState } from "@full-plate/sim-core";
import { bankStatus, BANK_LAST_DAYS, BANK_RED_DAYS, content, hireShortfall, starterLoanOffer } from "../sim";
import { Icon } from "./Icon";

export const BankCard = lazy(() => import("./BankCards").then((m) => ({ default: m.BankCard })));
export const BankBanner = lazy(() => import("./BankCards").then((m) => ({ default: m.BankBanner })));
export const StarterLoanTip = lazy(() => import("./BankCards").then((m) => ({ default: m.StarterLoanTip })));

/** Under the bank's line (the evening card is due). */
export const bankDue = (game: GameState): boolean => game.phase !== "gameover" && bankStatus(content, game).below;
/** The bank's last days (the morning banner is due). */
export const bankLastDays = (game: GameState): boolean => {
  const b = bankStatus(content, game);
  return b.below && b.daysLeft !== null && b.daysLeft <= BANK_LAST_DAYS;
};
/** Staffless, can't afford a chef, and the bank would lend (the starter-loan tip is due). */
export const loanDue = (game: GameState): boolean => { const s = hireShortfall(game); return !!s && s.short > 0 && starterLoanOffer(content, game) !== null; };

export const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** The countdown while cash is under the bank's overdraft line (absent otherwise, and on Cosy). */
export function BankChip({ game }: { game: GameState }) {
  const b = bankStatus(content, game);
  if (!b.below || b.daysLeft === null || game.phase === "gameover") return null;
  return (
    <span className={`bankchip ${b.daysLeft <= BANK_RED_DAYS ? "bankchip--red" : ""}`} data-testid="bank-chip">
      <Icon name="warning" size={16} />Bank: {days(b.daysLeft)} left
    </span>
  );
}

/**
 * The words on a "Hire →" prompt: "Hire →" when she can, "Save £X to hire a chef" when she can't (U2: never point her at
 * a door that's shut).
 */
export function hirePromptText(game: GameState): { can: boolean; text: string } {
  const s = hireShortfall(game);
  if (!s || s.short <= 0) return { can: true, text: "Hire →" };
  return { can: false, text: `Save £${Math.ceil(s.short / 100).toLocaleString("en-GB")} to hire a ${s.role}` };
}
