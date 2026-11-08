/**
 * Grid navigation: shortest walkable route to a station. Used by the demo autopilot and available to the game for
 * tap-to-walk on touch screens (feed `steerToward` into HandsOnInput.moveX/moveY). Pure and deterministic.
 */
import { isBlocked } from "./layout";
import type { HandsOnSession, Station } from "./types";

type Cell = [number, number];

/** Free tiles next to a station (where the player can stand to use it). */
export function standTiles(grid: readonly string[], st: Station): Cell[] {
  const out: Cell[] = [];
  for (let x = st.x; x < st.x + st.w; x++) out.push([x, st.y - 1], [x, st.y + st.h]);
  for (let y = st.y; y < st.y + st.h; y++) out.push([st.x - 1, y], [st.x + st.w, y]);
  return out.filter(([x, y]) => !isBlocked(grid, x, y));
}

/** BFS from the player's tile to the nearest stand tile of `stationId`. Returns tile centres, excluding the start. */
export function findPath(session: HandsOnSession, stationId: string): { x: number; y: number }[] | undefined {
  const st = session.stations.find((s) => s.id === stationId);
  if (!st) return undefined;
  const grid = session.grid;
  const goals = new Set(standTiles(grid, st).map(([x, y]) => `${x},${y}`));
  const sx = Math.floor(session.player.x), sy = Math.floor(session.player.y);
  const prev = new Map<string, string | null>([[`${sx},${sy}`, null]]);
  const q: Cell[] = [[sx, sy]];
  let found: string | undefined;
  while (q.length) {
    const [x, y] = q.shift()!;
    const k = `${x},${y}`;
    if (goals.has(k)) { found = k; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nk = `${nx},${ny}`;
      if (prev.has(nk) || isBlocked(grid, nx, ny)) continue;
      prev.set(nk, k);
      q.push([nx, ny]);
    }
  }
  if (!found) return undefined;
  const path: { x: number; y: number }[] = [];
  for (let k: string | null = found; k && k !== `${sx},${sy}`; k = prev.get(k) ?? null) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    path.unshift({ x: x + 0.5, y: y + 0.5 });
  }
  return path;
}

/**
 * Analogue steering toward a station: { moveX, moveY } in −1..1 (zero when standing at it), plus `arrived` and
 * the direction to face it once there.
 */
export function steerToward(session: HandsOnSession, stationId: string): { moveX: number; moveY: number; arrived: boolean; face?: "up" | "down" | "left" | "right" } {
  const st = session.stations.find((s) => s.id === stationId);
  const path = findPath(session, stationId);
  if (!st || !path) return { moveX: 0, moveY: 0, arrived: false };
  const { x, y } = session.player;
  const target = path[0] ?? { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
  const dx = target.x - x, dy = target.y - y;
  const close = Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12;
  if (path.length === 0 && close) {
    const cx = st.x + st.w / 2, cy = st.y + st.h / 2;
    const fx = cx - x, fy = cy - y;
    const face = Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? "right" : "left") : (fy > 0 ? "down" : "up");
    return { moveX: 0, moveY: 0, arrived: true, face };
  }
  // move one axis at a time near corners so the round body doesn't snag
  const mx = Math.abs(dx) > 0.08 ? Math.sign(dx) * Math.min(1, Math.abs(dx) * 3 + 0.35) : 0;
  const my = Math.abs(dy) > 0.08 ? Math.sign(dy) * Math.min(1, Math.abs(dy) * 3 + 0.35) : 0;
  return { moveX: Math.abs(dy) > 0.25 && Math.abs(dx) > 0.25 ? mx * 0.5 : mx, moveY: my, arrived: false };
}
