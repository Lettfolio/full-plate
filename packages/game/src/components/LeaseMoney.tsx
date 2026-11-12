/**
 * Round 14 (F, U16): the lease screen's money line, as the sum that makes day 1's cash: savings + the bank loan −
 * the fit-out − the lease deposit (sim-core newGame's own numbers: the cash is read from a real opening state, and the
 * deposit is what's left of the sum, so the lines always add up).
 */
import { useMemo } from "react";
import type { Difficulty } from "@full-plate/sim-core";
import { content, newGame } from "../sim";
import { MoneyText } from "./MoneyText";

export function leaseSums(districtId: string, difficulty: Difficulty): { savings: number; loan: number; fitOut: number; deposit: number; cash: number } {
  const b = content.balance;
  const cash = newGame(content, { type: "NEW_GAME", seed: 1, districtId, restaurantName: "x", difficulty }).cash;
  return { savings: b.startingCash, loan: b.loanPrincipal, fitOut: b.fitOutCost, deposit: b.startingCash + b.loanPrincipal - b.fitOutCost - cash, cash };
}

export function LeaseMoney({ districtId, difficulty }: { districtId: string; difficulty: Difficulty }) {
  const m = useMemo(() => leaseSums(districtId, difficulty), [districtId, difficulty]);
  const years = Math.round((content.balance.loanTermDays / 365) * 10) / 10;
  return (
    <div className="small muted" data-testid="lease-money">
      <div>Where the money goes before day 1:</div>
      <table className="pnl" style={{ marginTop: 4 }}>
        <caption className="sr-only">Savings plus the loan, less the fit-out and the deposit, is your cash on day 1</caption>
        <tbody>
          <tr><td>Your savings</td><td><MoneyText pence={m.savings} whole /></td></tr>
          <tr><td>Bank loan ({years} years)</td><td><MoneyText pence={m.loan} whole /></td></tr>
          <tr className="pnl__cost"><td>Kitchen and dining room fit-out</td><td><MoneyText pence={-m.fitOut} whole /></td></tr>
          <tr className="pnl__cost"><td>Lease deposit</td><td><MoneyText pence={-m.deposit} whole /></td></tr>
          <tr className="pnl__total"><th scope="row">Cash on day 1</th><td><MoneyText pence={m.cash} whole tone /></td></tr>
        </tbody>
      </table>
    </div>
  );
}
