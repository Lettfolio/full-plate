import { lazy, Suspense, useCallback, useEffect, useReducer, useState } from "react";
import type { Command, Difficulty } from "@full-plate/sim-core";
import type { CareerCommand } from "@full-plate/sim-career";
import type { EmpireCommand } from "@full-plate/sim-empire";
import type { StarsCommand } from "@full-plate/sim-stars";
import type { HandsOnResult, HandsOnRole, ShiftSummary } from "@full-plate/handson";
import { appReducer, initialAppState } from "./state/gameReducer";
import { CAREER_SAVE_KEY, loadGame, loadSave, SAVE_KEY, useAutosave } from "./state/save";
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
const HandsOnShift = lazy(() => import("./screens/HandsOnShift").then((m) => ({ default: m.HandsOnShift })));
const WinScreen = lazy(() => import("./screens/WinScreen").then((m) => ({ default: m.WinScreen })));
const GuideEnvelope = lazy(() => import("./screens/paths/GuideEnvelope").then((m) => ({ default: m.GuideEnvelope })));
const HandoverModal = lazy(() => import("./screens/career/HandoverModal").then((m) => ({ default: m.HandoverModal })));
const CareerEvening = lazy(() => import("./screens/career/CareerEvening").then((m) => ({ default: m.CareerEvening })));
const MyShift = lazy(() => import("./screens/career/MyShift").then((m) => ({ default: m.MyShift })));
const Loading = () => <div className="page"><div className="empty small muted">Loading…</div></div>;
import { Toast } from "./components/Toast";
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

export function randomSeed(): number {
  return Math.floor(Math.random() * 900_000) + 100_000;
}

export function App() {
  const [app, dispatch] = useReducer(appReducer, initialAppState);
  const [shell, setShell] = useState<Shell>({ view: "title" });
  const [saved, setSaved] = useState(() => loadGame());
  const [careerSaved, setCareerSaved] = useState(() => loadSave(CAREER_SAVE_KEY));
  const game = app.game;
  const meta = app.meta;

  useAutosave(game, undefined, meta);

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

  const start = (seed: number, districtId: string, restaurantName: string, difficulty: Difficulty) => {
    setPlanTab("menu");
    dispatch({ type: "new", cmd: { type: "NEW_GAME", seed, districtId, restaurantName, difficulty } });
    setShell({ view: "game" });
  };
  const startCareer = (o: CareerStartOptions) => {
    setPlanTab("menu");
    dispatch({ type: "newCareer", seed: randomSeed(), track: o.track, strategy: o.strategy, playerName: o.playerName, difficulty: o.difficulty, districtId: o.districtId });
    setShell({ view: "game" });
  };
  const quitToTitle = () => {
    setSaved(loadGame());
    setCareerSaved(loadSave(CAREER_SAVE_KEY));
    dispatch({ type: "quit" });
    setShell({ view: "title" });
  };

  const career = meta.mode === "career" && meta.career && !meta.career.handover ? meta.career : undefined;

  // Evening → tomorrow morning (via the morning post on event days). Tomorrow opens on the Menu tab
  // unless a shortcut ("Hire", "Buy a table") picked another.
  const nextDay = () => {
    setLastShift(null);
    if (!career && game?.phase === "event") setEventOpen(true);
    else dispatch({ type: "nextDay" });
  };

  if (shell.view === "title" || (shell.view === "game" && !game)) {
    return (
      <TitleScreen
        saved={saved}
        career={careerSaved}
        onNew={() => setShell({ view: "pick" })}
        onContinue={() => {
          const l = loadSave(SAVE_KEY);
          if (!l) { setSaved(null); return; }
          dispatch({ type: "load", game: l.game, meta: l.meta });
          setShell({ view: "game" });
        }}
        onContinueCareer={() => {
          const l = loadSave(CAREER_SAVE_KEY);
          if (!l) { setCareerSaved(null); return; }
          dispatch({ type: "load", game: l.game, meta: l.meta });
          setShell({ view: "game" });
        }}
      />
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
      <StatusBar game={game} meta={meta} onMenu={inService ? undefined : quitToTitle} />
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
            jumpIn={meta.handsOn.jumpIn}
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
        {meta.handover && !meta.handoverSeen && <HandoverModal summary={meta.handover} onClose={() => { setPlanTab("menu"); dispatch({ type: "seenHandover" }); }} />}
      </Suspense>
      <Toast toast={app.toast} onDismiss={dismissToast} />
    </div>
  );
}
