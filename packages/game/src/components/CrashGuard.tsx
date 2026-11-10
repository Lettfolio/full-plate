/**
 * Round 11 (red-team S1): the app's error boundary, above the title screen. A crash anywhere — a damaged save that got
 * past every check, a bug — shows a friendly page instead of a white screen, with "Back to title" and, for the game
 * that was opening or playing, "Delete this game". If the title itself is what crashed, every saved game is listed
 * with its own Delete button, so a child is never stuck. Names here are plain text, coerced and cut (safeName): this
 * page must not be the next thing to crash.
 */
import { Component, Fragment, type ReactNode } from "react";
import { getSaveStore, safeName, type SaveStore } from "../state/saveStore";

let activeSlot: string | null = null;
/** App: the slot being opened or played (null on the title). */
export function noteSlot(slotId: string | null): void { activeSlot = slotId; }

interface Props { children: ReactNode; store?: SaveStore }
interface State { crashed: boolean; slot: string | null; done: string | null; n: number }

export class CrashGuard extends Component<Props, State> {
  state: State = { crashed: false, slot: null, done: null, n: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { crashed: true, slot: activeSlot, done: null };
  }

  private store = () => this.props.store ?? getSaveStore();

  private back = () => { activeSlot = null; this.setState((s) => ({ crashed: false, slot: null, done: null, n: s.n + 1 })); };

  private del = (slotId: string, name: string) => {
    void this.store().remove(slotId).catch(() => {});
    if (activeSlot === slotId) activeSlot = null;
    this.setState({ slot: null, done: `${name || "That game"} was deleted.` });
  };

  render() {
    if (!this.state.crashed) return <Fragment key={this.state.n}>{this.props.children}</Fragment>;
    let games: { id: string; name: string }[] = [];
    try { games = this.store().list().map((s) => ({ id: String(s.slotId), name: safeName(s.name) || "A game" })); } catch { /* listing failed too */ }
    const slot = this.state.slot ? games.find((g) => g.id === this.state.slot) ?? { id: this.state.slot, name: "This game" } : null;
    return (
      <main className="crash" role="alert" style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px" }}>
        <h1>Something went wrong.</h1>
        <p>{slot ? "This game couldn't be opened. It may be damaged." : "The game hit a problem it couldn't fix by itself."} It isn't your fault.</p>
        {this.state.done && <p role="status">{this.state.done}</p>}
        <div className="row row--wrap" style={{ gap: 12, margin: "16px 0" }}>
          <button className="btn btn--primary btn--tap" onClick={this.back}>Back to title</button>
          {slot && <button className="btn btn--danger btn--tap" onClick={() => this.del(slot.id, slot.name)}>Delete this game</button>}
        </div>
        {!slot && games.length > 0 && (
          <>
            <p>If it keeps happening, one of your saved games may be damaged. You can delete it here:</p>
            <ul className="crash__games" style={{ listStyle: "none", padding: 0 }}>
              {games.map((g) => (
                <li key={g.id} className="row" style={{ gap: 12, alignItems: "center", margin: "8px 0" }}>
                  <span>{g.name}</span>
                  <button className="btn btn--ghost btn--tap" onClick={() => this.del(g.id, g.name)} aria-label={`Delete ${g.name}`}>Delete</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    );
  }
}
