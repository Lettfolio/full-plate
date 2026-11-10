/**
 * Round 11 (B, U2): never spend into a hole without being asked. A purchase that would leave less than three days of
 * running costs (sim-core `spendCheck`: rent, wages, bills, the loan and a typical day's stock) asks first:
 * "This leaves you with £25 — are you sure?". Anything safer goes straight through.
 */
import { useState, type ReactNode } from "react";
import type { GameState } from "@full-plate/sim-core";
import { content, runningCostPerDay, spendCheck } from "../sim";
import { ConfirmDialog } from "./Dialog";
import { formatPence } from "../lib/format";

interface Ask { cost: number; what: string; run: () => void }

export function useSpendGuard(game: GameState): { guard: (cost: number, what: string, run: () => void) => void; dialog: ReactNode } {
  const [ask, setAsk] = useState<Ask | null>(null);
  const guard = (cost: number, what: string, run: () => void) => {
    if (spendCheck(content, game, cost).risky) setAsk({ cost, what, run });
    else run();
  };
  let dialog: ReactNode = null;
  if (ask) {
    const after = game.cash - ask.cost;
    const day = runningCostPerDay(content, game);
    dialog = (
      <ConfirmDialog
        title={`This leaves you with ${formatPence(after, { whole: true })} — are you sure?`}
        body={
          <p data-testid="spend-confirm">
            {ask.what} costs <b>{formatPence(ask.cost, { whole: true })}</b>. A normal day costs about <b>{formatPence(day, { whole: true })}</b> to run
            (rent, wages, bills and stock), so that's less than three days of it. If the money runs out, the bank starts to worry.
          </p>
        }
        confirmLabel="Yes, buy it"
        cancelLabel="Keep my money"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => { const a = ask; setAsk(null); a.run(); }}
      />
    );
  }
  return { guard, dialog };
}
