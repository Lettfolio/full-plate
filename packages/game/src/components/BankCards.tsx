/**
 * Round 11 (B, U3/G2), a lazy chunk: the evening card that says what to do about the bank, the morning banner on its
 * last days, and the once-only "the bank will lend you a first wage" tip. `Bank.tsx` decides when each is due.
 */
import type { Command, GameState } from "@full-plate/sim-core";
import { bankStatus, BANK_LAST_DAYS, content, hireShortfall, MAX_PRICE_PENCE, starterLoanOffer } from "../sim";
import type { PlanningTab } from "../screens/Planning";
import { MoneyText } from "./MoneyText";
import { Icon } from "./Icon";
import { days } from "./Bank";

/** Tonight's prices × 1.1 (to 5p), the evening card's one-tap "raise prices". */
export function raisePrices(game: GameState): Command[] {
  return game.menu.filter((m) => m.active).map((m) => ({ type: "SET_MENU_ITEM", dishId: m.dishId, price: Math.min(MAX_PRICE_PENCE, Math.round((m.price * 1.1) / 5) * 5) }));
}

interface CardProps {
  game: GameState;
  send: (cmd: Command) => void;
  onGoTo?: ((tab: PlanningTab) => void) | undefined;
  onAct?: ((commands: Command[], tab: PlanningTab, done: string) => void) | undefined;
}

/** Evening: from the first night under the line, what the bank wants and what she can do tonight. */
export function BankCard({ game, send, onGoTo, onAct }: CardProps) {
  const b = bankStatus(content, game);
  if (!b.below || b.daysLeft === null || game.phase === "gameover") return null;
  const loan = starterLoanOffer(content, game);
  const prices = raisePrices(game);
  return (
    <section className="card bankcard" aria-labelledby="bankcard-h" data-testid="bank-card">
      <h3 id="bankcard-h" className="bankcard__h"><Icon name="warning" size={22} />The bank is worried: {days(b.daysLeft)} left</h3>
      <p className="small">
        You have <b><MoneyText pence={game.cash} whole tone /></b>. The bank's limit is <b><MoneyText pence={b.line} whole /></b>, so you need{" "}
        <b><MoneyText pence={b.line - game.cash} whole /></b> more. If you're still below it after {days(b.daysLeft)}, the bank will close {game.restaurantName}.
      </p>
      <ul className="bankcard__ways">
        {prices.length > 0 && (
          <li><span className="spacer">Raise your prices a little: most guests won't mind 10%.</span>
            {onAct && <button className="btn btn--sm btn--green" onClick={() => onAct(prices, "menu", "Done: prices are 10% higher.")}>Raise prices 10%</button>}</li>
        )}
        <li><span className="spacer">Buy cheaper stock, and only what tomorrow needs.</span>
          {onGoTo && <button className="btn btn--sm" onClick={() => onGoTo("stock")}>Stock →</button>}</li>
        {game.staff.length > 0 && (
          <li><span className="spacer">Fewer shifts: give someone a quiet day off.</span>
            {onGoTo && <button className="btn btn--sm" onClick={() => onGoTo("staff")}>Rota →</button>}</li>
        )}
        <li><span className="spacer">{loan ? <>The bank will lend you <MoneyText pence={loan} whole /> once, for a first wage.</> : "Don't buy anything new until you're back above the limit."}</span>
          {loan && <button className="btn btn--sm btn--green" onClick={() => send({ type: "STARTER_LOAN" })}>Borrow <MoneyText pence={loan} whole /></button>}</li>
      </ul>
    </section>
  );
}

/** Morning: a loud banner on the bank's last days. */
export function BankBanner({ game }: { game: GameState }) {
  const b = bankStatus(content, game);
  if (!b.below || b.daysLeft === null || b.daysLeft > BANK_LAST_DAYS) return null;
  return (
    <p className="callout callout--warn bankbanner" role="alert" data-testid="bank-banner">
      <b>{b.daysLeft === 1 ? "Last day with the bank!" : `${days(b.daysLeft)} left with the bank!`}</b> Tonight your cash needs to be above{" "}
      <MoneyText pence={b.line} whole /> (you have <MoneyText pence={game.cash} whole />), or the bank closes the restaurant
      {b.daysLeft === 1 ? " tonight." : ` in ${days(b.daysLeft)}.`}
    </p>
  );
}

/**
 * The staffless trap (G2): nobody hired and no chef she can afford. Normal/Hard offer the starter loan once; the card is
 * the "goal" too (it names what to do next). Hidden once she has staff or has borrowed.
 */
export function StarterLoanTip({ game, send }: { game: GameState; send: (cmd: Command) => void }) {
  const short = hireShortfall(game);
  const loan = starterLoanOffer(content, game);
  if (!loan || !short || short.short <= 0) return null;
  return (
    <section className="card tip tip--amber starterloan" aria-label="A loan for a first wage" data-testid="starter-loan">
      <span className="tip__icon" aria-hidden="true">🏦</span>
      <div className="spacer">
        <div className="advice__k">Goal</div>
        <b>The bank will lend you a first wage</b>
        <div className="small">You need <MoneyText pence={short.short} whole /> more to hire a {short.role}. The bank will lend you <MoneyText pence={loan} whole /> once, paid back a little each day with your loan.</div>
      </div>
      <button className="btn btn--sm btn--green" onClick={() => send({ type: "STARTER_LOAN" })}>Borrow <MoneyText pence={loan} whole /></button>
    </section>
  );
}

