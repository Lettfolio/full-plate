import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Command, Difficulty } from "@full-plate/sim-core";
import { playerAvatar } from "@full-plate/sim-core";
import type { CareerCommand } from "@full-plate/sim-career";
import type { EmpireCommand } from "@full-plate/sim-empire";
import type { StarsCommand } from "@full-plate/sim-stars";
import type { HandsOnResult, HandsOnRole, ShiftSummary } from "@full-plate/handson";
import { appReducer, initialAppState } from "./state/gameReducer";
import { getSaveStore, type SlotSummary } from "./state/saveStore";
import { saveNote, useSaves, useSlotAutosave } from "./state/useSaves";
import { SaveIndicator } from "./components/SaveIndicator";
import { content, HOOKS } from "./sim";
import { TitleScreen } from "./screens/TitleScreen";
import { NewGame } from "./screens/NewGame";
import { StartPicker, type CareerStartOptions } from "./screens/StartPicker";
import { Planning, type PlanningTab } from "./screens/Planning";
import { Service } from "./screens/Service";
import { Evening } from "./screens/Evening";
import { EventModal } from "./screens/EventModal";
import { GameOver } from "./screens/GameOver";
import { ForkCard } from "./screens/paths/ForkCard";
import { StatusBar } from "./components/StatusBar";

// Round 3 review: the path and career screens (and the hands-on canvas, which pulls in @full-plate/handson) load on
// first use. The path *sims* stay in the main bundle: the reducer and the save envelope run them synchronously.
import { Skeleton } from "./components/Skeleton";
const HandsOnShift = lazy(() => import("./screens/HandsOnShift").then((m) => ({ default: m.HandsOnShift })));
const WinScreen = lazy(() => import("./screens/WinScreen").then((m) => ({ default: m.WinScreen })));
const GuideEnvelope = lazy(() => import("./screens/paths/GuideEnvelope").then((m) => ({ default: m.GuideEnvelope })));
const HandoverModal = lazy(() => import("./screens/career/HandoverModal").then((m) => ({ default: m.HandoverModal })));
const CareerEvening = lazy(() => import("./screens/career/CareerEvening").then((m) => ({ default: m.CareerEvening })));
const MyShift = lazy(() => import("./screens/career/MyShift").then((m) => ({ default: m.MyShift })));
const BoardMeeting = lazy(() => import("./screens/paths/BoardMeeting").then((m) => ({ default: m.BoardMeeting })));
// Round 11 (G1, G8): the Empire's bankruptcy screen and the bust-shop card.
const EmpireEnd = lazy(() => import("./screens/paths/EmpireEnd").then((m) => ({ default: m.EmpireEnd })));
// Round 9: "Your games" (the slot picker) and the two-copies question.
const SlotPicker = lazy(() => import("./screens/SlotPicker").then((m) => ({ default: m.SlotPicker })));
const ConflictDialog = lazy(() => import("./screens/SlotPicker").then((m) => ({ default: m.ConflictDialog })));
// Round 7 (A): lazy chunks show a page-shaped skeleton, not a bare line.
const Loading = () => <Skeleton />;
import { Toast } from "./components/Toast";
import { noteSlot } from "./components/CrashGuard";
import { handsOnRoleFor } from "./state/paths";
import { weekdayIndex } from "./lib/calendar";
import { PLAYER_ID } from "@full-plate/sim-career";

/**
 * Shell views. "pick" = the round-3 start picker ("Start as…"); "newgame" = the owner's lease screen.
 * Exported for the routing test.
 */
export type Shell =
  | { view: "title" }
  | { view: "pick" }
  | { view: "newgame"; seed?: number; districtId?: string; difficulty?: Difficulty }
  | { view: "game" };

/**
 * Round 11 (G2): new owner games *could* open with a starter chef (sim-core NEW_GAME.starterChef). Off: the balancer
 * (SIM-NOTES "Round 11 — B") showed typical −2.0 and cheap −3.0 points with it; the starter loan and the bank's warnings
 * do the job instead. Flip this and `STARTER_CHEF_DEFAULT` (sim-core headless.ts) together.
 */
export const STARTER_CHEF = false;

export function randomSeed(): number {
  return Math.floor(Math.random() * 900_000) + 100_000;
}

export function App() {
  const [app, dispatch] = useReducer(appReducer, initialAppState);
  const [shell, setShell] = useState<Shell>({ view: "title" });
  const game = app.game;
  const meta = app.meta;

  // Round 9: save slots (state/saveStore.ts). The account is reached after the title has painted: its first call may
  // ask the player for consent, and nothing waits on it.
  const store = getSaveStore();
  const { slots, status } = useSaves(store);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [newSlot, setNewSlot] = useState<string | null>(null);
  const [picker, setPicker] = useState<"browse" | "new" | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [titleNote, setTitleNote] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ local: SlotSummary; cloud: SlotSummary; resolve: (w: "local" | "cloud") => void } | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const raf = requestAnimationFrame(() => { t = setTimeout(() => void store.connect(), 0); });
    return () => { cancelAnimationFrame(raf); if (t) clearTimeout(t); };
  }, [store]);
  useSlotAutosave(store, slotId, game, meta);
  const slotRef = useRef(slotId);
  slotRef.current = slotId;

  // On event days the evening P&L is shown first; "Next day" then opens the morning post.
  const [eventOpen, setEventOpen] = useState(false);
  const phase = game?.phase;
  useEffect(() => { if (phase !== "event") setEventOpen(false); }, [phase]);

  const send = useCallback((cmd: Command) => dispatch({ type: "command", cmd }), []);
  const sendCareer = useCallback((cmd: CareerCommand) => dispatch({ type: "career", cmd }), []);
  const sendEmpire = useCallback((cmd: EmpireCommand) => dispatch({ type: "empire", cmd }), []);
  const sendStars = useCallback((cmd: StarsCommand) => dispatch({ type: "stars", cmd }), []);
  const runTicks = useCallback((n: number) => dispatch({ type: "ticks", n }), []);
  const sendResults = useCallback((results: HandsOnResult[]) => dispatch({ type: "handsOnResults", results }), []);
  const dismissToast = useCallback(() => dispatch({ type: "dismissToast" }), []);
  const reportScore = useCallback((summary: ShiftSummary) => dispatch({ type: "handsOnScore", summary }), []);
  const notify = useCallback((text: string) => dispatch({ type: "toast", text, tone: "info" }), []);
  const [planTab, setPlanTab] = useState<PlanningTab>("menu");
  const [lastShift, setLastShift] = useState<ShiftSummary | null>(null);

  /** The slot a new game goes in: the one picked, else this game's (retry), else a free one. */
  const claimSlot = (into?: string) => {
    const id = into ?? newSlot ?? slotRef.current ?? store.freeSlotId() ?? slots.at(-1)?.slotId ?? "s1";
    store.beginNew(id);
    noteSlot(id);
    setSlotId(id); setNewSlot(null);
  };
  const start = (seed: number, districtId: string, restaurantName: string, difficulty: Difficulty, into?: string) => {
    claimSlot(into);
    setPlanTab("menu");
    // Round 11 (G2): the starter chef is wired but off (STARTER_CHEF above).
    dispatch({ type: "new", cmd: { type: "NEW_GAME", seed, districtId, restaurantName, difficulty, ...(STARTER_CHEF ? { starterChef: true } : {}) } });
    setShell({ view: "game" });
  };
  /** Round 11 (U3): a lost game in Your games starts over with the same restaurant (seed, street, name, difficulty), in its slot. */
  const restartSlot = async (id: string) => {
    setOpening(id); setTitleNote(null);
    const r = await store.load(id).catch(() => null);
    setOpening(null);
    if (!r) { setTitleNote("Sorry, that game couldn't be opened. Try again, or load it from a save file."); return; }
    setPicker(null);
    const g = r.loaded.game;
    start(g.seed, g.districtId, g.restaurantName, g.difficulty, id);
  };
  const startCareer = (o: CareerStartOptions) => {
    claimSlot();
    setPlanTab("menu");
    dispatch({ type: "newCareer", seed: randomSeed(), track: o.track, strategy: o.strategy, playerName: o.playerName, difficulty: o.difficulty, districtId: o.districtId, look: o.look });
    setShell({ view: "game" });
  };
  const quitToTitle = () => {
    noteSlot(null);
    if (slotId) void store.flush(slotId);
    setSlotId(null);
    dispatch({ type: "quit" });
    setShell({ view: "title" });
  };
  const newGame = () => {
    setTitleNote(null);
    if (slots.length === 0) { setNewSlot(store.freeSlotId()); setShell({ view: "pick" }); return; }
    setPicker("new");
  };
  const continueSlot = async (id: string) => {
    setOpening(id); setTitleNote(null);
    noteSlot(id); // Round 11: if opening or playing it crashes, the error page offers "Delete this game"
    const r = await store.load(id, { choose: (local, cloud) => new Promise((resolve) => setConflict({ local, cloud, resolve })) }).catch(() => null);
    setConflict(null); setOpening(null);
    if (!r) { noteSlot(null); setTitleNote("Sorry, that game couldn't be opened. Try again, or load it from a save file."); return; }
    setPicker(null);
    setSlotId(id);
    dispatch({ type: "load", game: r.loaded.game, meta: r.loaded.meta });
    setShell({ view: "game" });
    if (r.backupSlotId) dispatch({ type: "toast", text: `The other copy is kept in Your games as “Backup of ${r.summary.name}”.`, tone: "info" });
  };
  const saveFile = async () => {
    if (!slotId) return "Nothing to save yet.";
    const r = await store.saveToFile(slotId);
    return r === "saved" ? "Saved to a file ✓" : r === "declined" ? "No file was saved." : "Sorry, the file couldn't be made.";
  };

  const career = meta.mode === "career" && meta.career && !meta.career.handover ? meta.career : undefined;

  // Evening → tomorrow morning (via the morning post on event days). Tomorrow opens on the Menu tab
  // unless a shortcut ("Hire", "Buy a table") picked another.
  const nextDay = () => {
    // Round 6: the month doesn't move on until the board meeting is answered or skipped (the reducer says so).
    if (meta.empire?.boardMeeting) { dispatch({ type: "nextDay" }); return; }
    setLastShift(null);
    if (!career && game?.phase === "event") setEventOpen(true);
    else dispatch({ type: "nextDay" });
  };

  if (shell.view === "title" || (shell.view === "game" && !game)) {
    return (
      <>
        <TitleScreen
          saved={null}
          slots={slots}
          busy={!!opening && !picker}
          note={titleNote}
          {...(slots.length || status.cloud !== "waiting" ? { saveNote: saveNote(status) } : {})}
          onNew={newGame}
          onYourGames={() => { setTitleNote(null); setPicker("browse"); }}
          onContinue={() => { const s0 = slots.find((x) => !x.archived); if (s0) void continueSlot(s0.slotId); }}
        />
        <Suspense fallback={null}>
          {picker && !conflict && (
            <SlotPicker
              mode={picker}
              store={store}
              busy={opening}
              onClose={() => setPicker(null)}
              onContinue={(id) => void continueSlot(id)}
              onNewIn={(id) => { setPicker(null); setNewSlot(id ?? store.freeSlotId()); setShell({ view: "pick" }); }}
              onRestart={(id) => void restartSlot(id)}
            />
          )}
          {conflict && <ConflictDialog local={conflict.local} cloud={conflict.cloud} onPick={(w) => conflict.resolve(w)} />}
        </Suspense>
      </>
    );
  }

  if (shell.view === "pick") {
    return (
      <StartPicker
        content={content}
        onBack={() => setShell({ view: "title" })}
        onOwner={(difficulty, districtId) => setShell({ view: "newgame", difficulty, districtId })}
        onCareer={startCareer}
      />
    );
  }

  if (shell.view === "newgame") {
    return (
      <NewGame
        content={content}
        initialSeed={shell.seed ?? randomSeed()}
        {...(shell.districtId ? { initialDistrictId: shell.districtId } : {})}
        {...(shell.difficulty ? { initialDifficulty: shell.difficulty } : {})}
        onStart={start}
        onBack={() => setShell({ view: "pick" })}
      />
    );
  }

  if (!game) return null;

  if (meta.win && !meta.win.dismissed) {
    return <Suspense fallback={<Loading />}><WinScreen game={game} meta={meta} win={meta.win} onKeepPlaying={() => dispatch({ type: "dismissWin" })} onTitle={quitToTitle} /></Suspense>;
  }

  // Round 11 (G8): a bankrupt Empire ends on its own screen; (G1) a running Empire never shows the shop's GameOver.
  if (meta.empire && !career && (meta.empire.status === "bankrupt" || game.phase === "gameover")) {
    const bankrupt = meta.empire.status === "bankrupt";
    const cp = app.checkpoint;
    return (
      <Suspense fallback={<Loading />}>
        <EmpireEnd
          game={game}
          empire={meta.empire}
          kind={bankrupt ? "bankrupt" : "shopBust"}
          {...(bankrupt && cp ? { checkpointDay: cp.day, onRetry: () => dispatch({ type: "retryCheckpoint" }) } : {})}
          onMoveOn={() => dispatch({ type: "moveOn" })}
          onNewGame={() => { quitToTitle(); setPicker("new"); }}
          onTitle={quitToTitle}
        />
      </Suspense>
    );
  }

  if (game.phase === "gameover" && !career) {
    return (
      <GameOver
        game={game}
        reason={game.gameOverReason ?? null}
        onRetrySameSeed={() => start(game.seed, game.districtId, game.restaurantName, game.difficulty)}
        onNewSeed={() => setShell({ view: "newgame", seed: randomSeed() })}
        onTitle={quitToTitle}
      />
    );
  }

  const path = meta.fork.chosen;
  const handsOnRole: HandsOnRole | undefined = career ? handsOnRoleFor(career.role) : undefined;
  const playerOn = career ? !!game.staff.find((s) => s.id === PLAYER_ID)?.rota[weekdayIndex(game.day)] && career.trainingSimDay !== game.day : false;
  const inService = game.phase === "service";
  const employerOut = career && career.employer.status !== "employed";
  const isEvening = game.phase === "evening" || game.phase === "event" || (career && game.phase === "gameover");

  return (
    <div className="app">
      <StatusBar
        game={game}
        meta={meta}
        onQuit={inService ? undefined : quitToTitle}
        onNewGame={inService ? undefined : () => { quitToTitle(); setPicker("new"); }}
        onSave={slotId ? async () => { await store.save(slotId, game, meta); return store.flush(slotId); } : undefined}
        onSaveFile={slotId ? saveFile : undefined}
        saveMark={slotId ? <SaveIndicator slotId={slotId} store={store} /> : undefined}
      />
      <main className={`screen ${inService ? "screen--fixed" : ""}`}>
        <Suspense fallback={<Loading />}>
        {game.phase === "planning" && career && !employerOut && <div className="page"><MyShift game={game} meta={meta} career={career} sendCareer={sendCareer} send={send} /></div>}
        {(employerOut && !inService) && (
          <div className="page">
            <MyShift game={game} meta={meta} career={career!} sendCareer={sendCareer} send={send} />
            <div className="openbar"><span className="spacer" /><button className="btn btn--primary btn--xl" onClick={nextDay}>Next day →</button></div>
          </div>
        )}
        {game.phase === "planning" && !career && (
          <Planning
            game={game}
            send={send}
            tab={planTab}
            onTab={setPlanTab}
            goalsJustDone={app.goalsJustDone}
            path={path}
            meta={meta}
            sendEmpire={sendEmpire}
            sendStars={sendStars}
            onFocusSite={(siteId) => dispatch({ type: "focusSite", siteId })}
            onTastingMenu={(menuId) => dispatch({ type: "tastingMenu", menuId })}
          />
        )}
        {inService && meta.handsOn && (
          <HandsOnShift
            key={`${game.day}-${meta.handsOn.role}`}
            game={game}
            role={meta.handsOn.role}
            {...(career ? { playerStaffId: PLAYER_ID } : {})}
            {...(meta.handsOn.station ? { station: meta.handsOn.station } : {})}
            jumpIn={meta.handsOn.jumpIn}
            {...(career ? { look: (({ skin, hair }) => ({ skin, hair }))(playerAvatar(career.look ?? 0, career.role)) } : {})}
            tutorial={!career || career.shiftsWorked < 10}
            runTicks={runTicks}
            sendResults={sendResults}
            onLeave={() => dispatch({ type: "handsOnStop" })}
            onSkip={() => dispatch({ type: "skipShift" })}
            onDone={setLastShift}
            onScore={reportScore}
          />
        )}
        {inService && !meta.handsOn && (
          <Service
            game={game}
            app={app}
            send={send}
            runTicks={runTicks}
            notify={notify}
            {...(career
              ? {
                  watch: {
                    title: !playerOn ? "Day off — the team runs it without you" : handsOnRole ? "Watch your shift" : "You're running the floor",
                    note: !playerOn
                      ? "Skip ahead whenever you like."
                      : handsOnRole && !HOOKS.player
                        ? "Hands-on play is in practice mode until the sim takes your results — you can still play it."
                        : handsOnRole ? undefined : "Managers watch the room and the numbers. The boss answers any problems.",
                    playerStaffId: PLAYER_ID,
                    ...(playerOn && handsOnRole ? { onPlay: () => dispatch({ type: "handsOnStart", meta: { role: handsOnRole, jumpIn: false } }), playLabel: "Play my shift (hands-on)" } : {}),
                  },
                  onSkip: () => dispatch({ type: "skipShift" }),
                }
              : { onJumpIn: (role: HandsOnRole) => dispatch({ type: "handsOnStart", meta: { role, jumpIn: true } }) })}
          />
        )}
        {isEvening && career && !employerOut && (
          <CareerEvening game={game} meta={{ ...meta, shiftSummary: lastShift ?? undefined }} career={career} result={game.history.at(-1) ?? app.lastResult} onNext={nextDay} />
        )}
        {isEvening && !career && (
          <Evening
            game={game}
            result={game.history.at(-1) ?? app.lastResult}
            onNext={nextDay}
            onGoTo={(tab) => { setPlanTab(tab); nextDay(); }}
            onAct={(commands, tab, done, now) => {
              // The over-stock trim changes tonight's order for tomorrow: apply it now and stay on the evening.
              if (now) { dispatch({ type: "actNow", commands, done }); return; }
              dispatch({ type: "actTomorrow", commands, done });
              setPlanTab(tab);
              nextDay();
            }}
            nextLabel={game.phase === "event" ? "Read the morning post →" : "Next day →"}
            send={send}
            meta={meta}
            sendEmpire={sendEmpire}
            shiftSummary={lastShift}
          />
        )}
        </Suspense>
      </main>
      {!career && game.phase === "event" && eventOpen && <EventModal game={game} send={send} />}
      {isEvening && !career && meta.fork.offered && !meta.fork.chosen && (
        <ForkCard game={game} onChoose={(choice, brandName) => dispatch({ type: "fork", choice, ...(brandName ? { brandName } : {}) })} />
      )}
      <Suspense fallback={null}>
        {meta.pendingGuide && <GuideEnvelope game={game} pending={meta.pendingGuide} onClose={() => dispatch({ type: "openGuide" })} />}
        {!career && meta.empire?.boardMeeting && (game.phase === "planning" || isEvening) && !meta.fork.offered && (
          <BoardMeeting empire={meta.empire} meeting={meta.empire.boardMeeting} send={sendEmpire} />
        )}
        {meta.handover && !meta.handoverSeen && <HandoverModal summary={meta.handover} onClose={() => { setPlanTab("menu"); dispatch({ type: "seenHandover" }); }} />}
      </Suspense>
      <Toast toast={app.toast} onDismiss={dismissToast} />
    </div>
  );
}
