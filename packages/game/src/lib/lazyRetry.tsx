/**
 * Round 14 (C, red-team U2/S14-4): a lazy chunk that can't load is a connection problem, never a damaged save.
 *
 * - `lazyRetry(load)` is the only way the game makes a `React.lazy` component (a test fails on a bare `lazy(` anywhere
 *   else). The import is tried three times (now, after 0.4 s, after 1.5 s); then it throws a `ChunkLoadError`.
 * - Every component it makes sits inside its own `ChunkBoundary`: a chunk that still won't come shows "Couldn't load
 *   this part. Check your connection." with **Try again** (a fresh import) and, where the screen gives one (`ChunkBack`),
 *   **Back**. The rest of the game stays up and the save is never touched. Any other error goes on up to CrashGuard.
 * - After a deploy the old hashed chunks are gone (404) for a page left open: before giving up, the page fetches
 *   index.html and compares its script names with its own. New names mean "A new version is ready — Reload", which
 *   saves the game first (`setSaveBeforeReload`, App).
 * The boundary is in the main chunk on purpose: the thing that explains a missing chunk can't be one.
 */
import { Component, createContext, lazy, useContext, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";

export class ChunkLoadError extends Error {
  /** True when the server has a newer build than this page (its chunks were replaced). */
  readonly stale: boolean;
  constructor(message: string, stale = false) { super(message); this.name = "ChunkLoadError"; this.stale = stale; }
}

/** Chrome, Safari, Firefox and Vite's CSS preload, word for word. */
const CHUNK_RE = /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|ChunkLoadError/i;
export function isChunkError(e: unknown): boolean {
  return e instanceof ChunkLoadError || (e instanceof Error && (e.name === "ChunkLoadError" || CHUNK_RE.test(e.message)));
}
export const isStale = (e: unknown): boolean => e instanceof ChunkLoadError && e.stale;

/** The waits between tries (ms): three tries in all. Tests shorten them. */
export const retrySettings: { delays: readonly number[] } = { delays: [400, 1500] };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The basenames of the page's own module scripts (`index-AbC123.js`). */
const scriptNames = (srcs: Iterable<string>): string[] => [...srcs].map((s) => s.split(/[?#]/)[0]!.split("/").pop() ?? "").filter(Boolean);

/**
 * Has the server got a different build from this page? Fetches the page's index.html (no cache) and compares the
 * module script names. False when it can't tell (offline, an error, a dev server).
 */
export async function newVersionReady(doc: Document = document, get: typeof fetch = fetch): Promise<boolean> {
  try {
    const mine = scriptNames([...doc.querySelectorAll<HTMLScriptElement>("script[type=module][src]")].map((s) => s.getAttribute("src") ?? ""));
    if (!mine.length) return false;
    const base = /^https?:/.test(doc.baseURI) ? doc.baseURI : window.location.href;
    const r = await get(new URL("./", base).href, { cache: "no-store" });
    if (!r.ok) return false;
    const html = await r.text();
    const theirs = scriptNames([...html.matchAll(/<script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!));
    return theirs.length > 0 && mine.some((n) => !theirs.includes(n));
  } catch { return false; }
}

/** `load()`, tried again after each of `delays`; then a ChunkLoadError (stale when the server has a newer build). */
export async function retryImport<T>(load: () => Promise<T>, delays: readonly number[] = retrySettings.delays, wait: (ms: number) => Promise<void> = sleep): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await load(); } catch (e) {
      if (i < delays.length) { await wait(delays[i]!); continue; }
      if (e instanceof ChunkLoadError || (!isChunkError(e) && !(e instanceof TypeError))) throw e; // (a bug in the module: not the network)
      throw new ChunkLoadError(e instanceof Error ? e.message : "A part of the game couldn't load", await newVersionReady().catch(() => false));
    }
  }
}

// ── saving before a reload (App registers how) ──
let saveFirst: (() => Promise<unknown>) | null = null;
/** App: how to save the game being played before the page reloads (null on the title). */
export function setSaveBeforeReload(fn: (() => Promise<unknown>) | null): void { saveFirst = fn; }
/** Saves (at most 2 s), then reloads the page. */
export async function reloadSaved(reload: () => void = () => window.location.reload()): Promise<void> {
  try { await Promise.race([saveFirst?.(), sleep(2000)]); } catch { /* reload anyway: the last autosave is on the device */ }
  reload();
}

/** Where "Back" goes when a part of this screen can't load (a tab → the Menu tab, a screen → the title). */
export interface BackTo { label: string; go: () => void }
const BackCtx = createContext<BackTo | null>(null);
export function ChunkBack({ to, children }: { to: BackTo | null; children: ReactNode }) {
  return <BackCtx.Provider value={to}>{children}</BackCtx.Provider>;
}

interface BoundaryProps { children: ReactNode; retry: () => void; back: BackTo | null }
interface BoundaryState { error: unknown; busy: boolean }

/** Catches a chunk that won't load; anything else is thrown on to the next boundary (CrashGuard). */
export class ChunkBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, busy: false };
  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> { return { error, busy: false }; }
  private again = () => { this.props.retry(); this.setState({ error: null }); };
  private reload = () => { this.setState({ busy: true }); void reloadSaved(); };
  render() {
    const { error, busy } = this.state;
    if (error === null) return this.props.children;
    if (!isChunkError(error)) throw error;
    const stale = isStale(error), back = this.props.back;
    return (
      <div className="callout callout--warn chunkfail" role="alert" data-chunkfail={stale ? "stale" : "offline"} style={{ margin: 12 }}>
        <p><b>{stale ? "A new version of Full Plate is ready." : "Couldn't load this part."}</b>{" "}
          {stale ? "Reload to get it: your game is saved first." : "Check your connection, then try again. Your game is safe."}</p>
        <div className="row row--wrap" style={{ gap: 12, marginTop: 8 }}>
          {stale
            ? <button type="button" className="btn btn--primary btn--tap" disabled={busy} onClick={this.reload}>{busy ? "Saving…" : "Reload"}</button>
            : <button type="button" className="btn btn--primary btn--tap" onClick={this.again}>Try again</button>}
          {back && <button type="button" className="btn btn--tap" onClick={back.go}>{back.label}</button>}
        </div>
      </div>
    );
  }
}

type AnyComponent = ComponentType<any>;
export type Retrying<T extends AnyComponent> = ComponentType<ComponentProps<T>> & { preload(): Promise<void> };

/**
 * `React.lazy` with retries and its own ChunkBoundary. React keeps a lazy component's failed import for good, so
 * "Try again" swaps in a fresh `lazy` (only after a failure; a loaded one is kept).
 */
export function lazyRetry<T extends AnyComponent>(load: () => Promise<{ default: T }>): Retrying<T> {
  let failed = false;
  const make = () => lazy(() => retryImport(load).catch((e: unknown) => { failed = true; throw e; }));
  let Inner = make();
  function Retrying(props: ComponentProps<T>) {
    const [, force] = useState(0);
    const back = useContext(BackCtx);
    const retry = () => { if (failed) { failed = false; Inner = make(); } force((n) => n + 1); };
    const C = Inner as AnyComponent;
    return <ChunkBoundary retry={retry} back={back}><C {...props} /></ChunkBoundary>;
  }
  Retrying.preload = () => retryImport(load).then(() => undefined, () => undefined);
  return Retrying;
}
