import { useCallback, useReducer, useState } from "react";
import type { Command, Difficulty } from "@full-plate/sim-core";
import { appReducer, initialAppState } from "./state/gameReducer";
import { loadGame, useAutosave } from "./state/save";
import { content, USING_STUBS } from "./sim";
import { TitleScreen } from "./screens/TitleScreen";
import { NewGame } from "./screens/NewGame";
import { Planning } from "./screens/Planning";
import { Service } from "./screens/Service";
import { Evening } from "./screens/Evening";
import { EventModal } from "./screens/EventModal";
import { GameOver } from "./screens/GameOver";
import { StatusBar } from "./components/StatusBar";

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

  const send = useCallback((cmd: Command) => dispatch({ type: "command", cmd }), []);
  const runTicks = useCallback((n: number) => dispatch({ type: "ticks", n }), []);

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
        stub={USING_STUBS}
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
        reason={game.gameOverReason ?? app.gameOverReason}
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
        {(game.phase === "planning" || game.phase === "event") && <Planning game={game} send={send} />}
        {game.phase === "service" && <Service game={game} app={app} send={send} runTicks={runTicks} />}
        {game.phase === "evening" && <Evening game={game} result={app.lastResult ?? game.history.at(-1) ?? null} send={send} />}
      </main>
      {game.phase === "event" && <EventModal game={game} send={send} />}
    </div>
  );
}
