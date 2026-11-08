import { useCallback, useEffect, useReducer, useState } from "react";
import type { Command, Difficulty } from "@full-plate/sim-core";
import { appReducer, initialAppState } from "./state/gameReducer";
import { loadGame, useAutosave } from "./state/save";
import { content } from "./sim";
import { TitleScreen } from "./screens/TitleScreen";
import { NewGame } from "./screens/NewGame";
import { Planning } from "./screens/Planning";
import { Service } from "./screens/Service";
import { Evening } from "./screens/Evening";
import { EventModal } from "./screens/EventModal";
import { GameOver } from "./screens/GameOver";
import { StatusBar } from "./components/StatusBar";
import { Toast } from "./components/Toast";

type Shell = { view: "title" } | { view: "newgame"; seed?: number } | { view: "game" };

export function randomSeed(): number {
  return Math.floor(Math.random() * 900_000) + 100_000;
}

export function App() {
  const [app, dispatch] = useReducer(appReducer, initialAppState);
  const [shell, setShell] = useState<Shell>({ view: "title" });
  const [saved, setSaved] = useState(() => loadGame());
  const game = app.game;

  useAutosave(game);

  // On event days the evening P&L is shown first; "Next day" then opens the morning post.
  const [eventOpen, setEventOpen] = useState(false);
  const phase = game?.phase;
  useEffect(() => { if (phase !== "event") setEventOpen(false); }, [phase]);

  const send = useCallback((cmd: Command) => dispatch({ type: "command", cmd }), []);
  const runTicks = useCallback((n: number) => dispatch({ type: "ticks", n }), []);
  const dismissToast = useCallback(() => dispatch({ type: "dismissToast" }), []);

  const start = (seed: number, districtId: string, restaurantName: string, difficulty: Difficulty) => {
    dispatch({ type: "new", cmd: { type: "NEW_GAME", seed, districtId, restaurantName, difficulty } });
    setShell({ view: "game" });
  };
  const quitToTitle = () => {
    setSaved(loadGame());
    dispatch({ type: "quit" });
    setShell({ view: "title" });
  };

  if (shell.view === "title" || (shell.view === "game" && !game)) {
    return (
      <TitleScreen
        saved={saved}
        onNew={() => setShell({ view: "newgame" })}
        onContinue={() => {
          const g = loadGame();
          if (!g) { setSaved(null); return; }
          dispatch({ type: "load", game: g });
          setShell({ view: "game" });
        }}
      />
    );
  }

  if (shell.view === "newgame") {
    return <NewGame content={content} initialSeed={shell.seed ?? randomSeed()} onStart={start} onBack={() => setShell({ view: "title" })} />;
  }

  if (!game) return null;

  if (game.phase === "gameover") {
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

  return (
    <div className="app">
      <StatusBar game={game} onMenu={game.phase === "service" ? undefined : quitToTitle} />
      <main className={`screen ${game.phase === "service" ? "screen--fixed" : ""}`}>
        {game.phase === "planning" && <Planning game={game} send={send} />}
        {game.phase === "service" && <Service game={game} app={app} send={send} runTicks={runTicks} />}
        {(game.phase === "evening" || game.phase === "event") && (
          <Evening
            game={game}
            result={game.history.at(-1) ?? app.lastResult}
            onNext={() => (game.phase === "event" ? setEventOpen(true) : send({ type: "END_DAY" }))}
            nextLabel={game.phase === "event" ? "Read the morning post →" : "Next day →"}
          />
        )}
      </main>
      {game.phase === "event" && eventOpen && <EventModal game={game} send={send} />}
      <Toast toast={app.toast} onDismiss={dismissToast} />
    </div>
  );
}
