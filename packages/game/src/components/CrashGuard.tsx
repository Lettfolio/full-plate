/**
 * Round 11 (red-team S1): the app's error boundary, above the title screen. A crash anywhere — a damaged save that got
 * past every check, a bug — shows a friendly page instead of a white screen, with "Back to title" and, for the game
 * that was opening or playing, "Delete this game". If the title itself is what crashed, every saved game is listed
 * with its own Delete button, so a child is never stuck. Names here are plain text, coerced and cut (safeName): this
 * page must not be the next thing to crash.
 *
 * Round 14 (C, red-team U2/S14-4): a part of the game that couldn't load (offline, or a new version replaced it) is not
 * damage: that page says so and offers Reload (the game is saved first) and Back to title — never Delete. Each lazy
 * part has its own boundary (lib/lazyRetry.tsx), so this page only sees a chunk error that got past one. Delete now
 * asks first, names the game, and offers "Save a copy to a file" (the raw save, unchecked) before it goes.
 */
import { Component, Fragment, type ReactNode } from "react";
import { getSaveStore, safeName, type SaveStore } from "../state/saveStore";
import { isChunkError, isStale, reloadSaved } from "../lib/lazyRetry";

let activeSlot: string | null = null;
/** App: the slot being opened or played (null on the title). */
export function noteSlot(slotId: string | null): void { activeSlot = slotId; }

interface Props { children: ReactNode; store?: SaveStore; reload?: () => void }
type Game = { id: string; name: string };
interface State { crashed: boolean; chunk: boolean; stale: boolean; slot: string | null; done: string | null; n: number; ask: Game | null; file: string | null; busy: boolean }

export class CrashGuard extends Component<Props, State> {
  state: State = { crashed: false, chunk: false, stale: false, slot: null, done: null, n: 0, ask: null, file: null, busy: false };

  static getDerivedStateFromError(e: unknown): Partial<State> {
    return { crashed: true, chunk: isChunkError(e), stale: isStale(e), slot: activeSlot, done: null, ask: null, file: null, busy: false };
  }

  private store = () => this.props.store ?? getSaveStore();

  private back = () => { activeSlot = null; this.setState((s) => ({ crashed: false, chunk: false, stale: false, slot: null, done: null, ask: null, file: null, n: s.n + 1 })); };

  private reload = () => { this.setState({ busy: true }); void reloadSaved(this.props.reload); };

  private toFile = async (g: Game) => {
    this.setState({ file: "Getting the file ready…" });
    const r = await this.store().saveToFile(g.id).catch(() => "failed" as const);
    this.setState({ file: r === "saved" ? "Saved a copy to a file ✓" : r === "declined" ? "No file was saved." : "Sorry, the file couldn't be made." });
  };

  private del = (g: Game) => {
    void this.store().remove(g.id).catch(() => {});
    if (activeSlot === g.id) activeSlot = null;
    this.setState((s) => ({ slot: s.slot === g.id ? null : s.slot, ask: null, file: null, done: `${g.name} was deleted.` }));
  };

  render() {
    if (!this.state.crashed) return <Fragment key={this.state.n}>{this.props.children}</Fragment>;
    const { chunk, stale, ask, file, done, busy } = this.state;
    const btn = (label: string, on: () => void, tone = "", aria?: string) => <button className={`btn btn--tap ${tone}`} disabled={busy} onClick={on} aria-label={aria}>{label}</button>;
    const page = (h: string, p: ReactNode, note: string | null, buttons: ReactNode, more?: ReactNode) => (
      <main className="crash" role="alert" style={{ maxWidth: 560, margin: "48px auto", padding: "0 16px" }}>
        <h1>{h}</h1><p>{p}</p>
        {note && <p role="status">{note}</p>}
        <div className="row row--wrap" style={{ gap: 12, margin: "16px 0" }}>{buttons}</div>
        {more}
      </main>
    );
    if (chunk) {
      return page(stale ? "A new version of Full Plate is ready." : "Couldn't load the next part of the game.",
        `${stale ? "This page is from the old version, so a part of it is missing." : "Check your connection, then reload."} Your game is fine: it's saved before the page reloads.`, null,
        <>{btn(busy ? "Saving…" : "Reload", this.reload, "btn--primary")}{btn("Back to title", this.back)}</>);
    }
    if (ask) {
      return page(`Delete ${ask.name}?`, "It goes for good, on this device and your account. If you might want it back, save a copy to a file first: it keeps the save exactly as it is.", file,
        <>{btn("Save a copy to a file", () => void this.toFile(ask), "btn--primary")}{btn(`Delete ${ask.name}`, () => this.del(ask), "btn--danger")}{btn("Keep it", () => this.setState({ ask: null, file: null }))}</>);
    }
    let games: Game[] = [];
    try { games = this.store().list().map((s) => ({ id: String(s.slotId), name: safeName(s.name) || "A game" })); } catch { /* listing failed too */ }
    const slot = this.state.slot ? games.find((g) => g.id === this.state.slot) ?? { id: this.state.slot, name: "This game" } : null;
    return page("Something went wrong.", `${slot ? "This game couldn't be opened. It may be damaged." : "The game hit a problem it couldn't fix by itself."} It isn't your fault.`, done,
      <>{btn("Back to title", this.back, "btn--primary")}{slot && btn("Delete this game…", () => this.setState({ ask: slot, file: null }), "btn--danger")}</>,
      !slot && games.length > 0 && (
        <>
          <p>If it keeps happening, one of your saved games may be damaged. You can delete it here:</p>
          <ul className="crash__games" style={{ listStyle: "none", padding: 0 }}>
            {games.map((g) => (
              <li key={g.id} className="row" style={{ gap: 12, alignItems: "center", margin: "8px 0" }}>
                <span>{g.name}</span>{btn("Delete…", () => this.setState({ ask: g, file: null }), "btn--ghost", `Delete ${g.name}`)}
              </li>
            ))}
          </ul>
        </>
      ));
  }
}
