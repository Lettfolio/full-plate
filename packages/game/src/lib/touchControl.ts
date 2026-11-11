/**
 * Round 7: touch (and mouse) play on the hands-on canvas, as one more HandsOnInput the shift merges with the keyboard
 * and gamepad (handson `InputSource.setTouch`).
 *
 * - Tap a station: she walks there (handson `steerToward`, the bot's own path finder) and turns to face it.
 * - Press the station she is standing at (or anywhere while a verb is running): that is the USE button — held while the
 *   finger is down, so a tap chops/grabs and a hold cooks or pours.
 * - Tap a slip on the rail: a chef walks to the fridge to fetch it.
 * - The big USE and Drop buttons do the same as E and Q.
 * - Round 13 (C): drag to steer. A finger that moves on the canvas (or on the upright stick pad) is a stick: she
 *   walks the way it points, at a speed set by how far it has gone (`stick`), until it lifts.
 *
 * Every press is latched for one read, so a tap shorter than a frame still registers.
 */
import { railTarget, steerToward, type HandsOnInput, type HandsOnSession, type Hit } from "@full-plate/handson";

export interface TouchControl {
  /**
   * A pointer went down on the canvas at `hit` (undefined: bare floor). Round 13: says what the press became — the
   * USE button ("use"), a walk to a station ("walk") or nothing yet (bare floor: it may still become a drag).
   */
  press(session: HandsOnSession, hit: Hit | undefined): "use" | "walk" | undefined;
  /** Round 13 (C): a drag stick, each axis -1..1 (null: lifted). Overrides tap-to-walk while it is down. */
  stick(v: { x: number; y: number } | null): void;
  /** USE button / Drop button. */
  use(down: boolean): void;
  drop(down: boolean): void;
  /** Every pointer is up. */
  release(): void;
  /** This frame's input (call once per frame). */
  read(session: HandsOnSession): Partial<HandsOnInput> | null;
  /** Where she is walking to (for tests and the canvas). */
  readonly target: string | undefined;
}

const nudge = (face: string | undefined, n = 0.3) =>
  face === "up" ? { moveX: 0, moveY: -n } : face === "down" ? { moveX: 0, moveY: n } : face === "left" ? { moveX: -n, moveY: 0 } : { moveX: n, moveY: 0 };

export function createTouchControl(): TouchControl {
  let target: string | undefined;
  let held = false, latched = false;
  let dropHeld = false, dropLatched = false;
  let stick: { x: number; y: number } | null = null;
  return {
    get target() { return target; },
    press(session, hit) {
      const at = session.prompt?.stationId;
      // While a verb runs, the whole canvas is the USE button (tap on the chop marks, hold to cook).
      if (session.activeAction || (hit?.kind === "station" && hit.stationId === at && session.prompt?.enabled)) {
        target = undefined; held = true; latched = true; return "use";
      }
      if (!hit) return undefined;
      target = hit.kind === "rail" ? railTarget(session) : hit.stationId;
      return target ? "walk" : undefined;
    },
    stick(v) { stick = v && (v.x || v.y) ? v : null; if (stick) target = undefined; },
    use(down) { held = down; if (down) { latched = true; target = undefined; } },
    drop(down) { dropHeld = down; if (down) dropLatched = true; },
    release() { held = false; dropHeld = false; stick = null; },
    read(session) {
      const interact = held || latched;
      const cancel = dropHeld || dropLatched;
      latched = false; dropLatched = false;
      let move: { moveX: number; moveY: number } | undefined;
      if (stick && !session.activeAction) move = { moveX: stick.x, moveY: stick.y };
      else if (target && !session.activeAction) {
        if (session.prompt?.stationId === target) target = undefined; // arrived and facing it
        else {
          const s = steerToward(session, target);
          if (s.arrived) move = nudge(s.face);
          else if (s.moveX || s.moveY) move = { moveX: s.moveX, moveY: s.moveY };
          else target = undefined; // no route
        }
      }
      if (!interact && !cancel && !move) return null;
      return { ...(interact ? { interact: true } : {}), ...(cancel ? { cancel: true } : {}), ...(move ?? {}) };
    },
  };
}


/**
 * Round 13 (C): a drag (CSS px from where the finger went down) as a stick. Under `dead` px it is still a tap; at
 * `full` px it is full speed (from a quarter, the session's 0.2 dead zone, at the threshold); the direction is kept.
 */
export function dragStick(dx: number, dy: number, dead = 14, full = 56): { x: number; y: number } | null {
  const d = Math.hypot(dx, dy);
  if (d < dead) return null;
  const k = (0.25 + 0.75 * Math.min(1, (d - dead) / (full - dead))) / d;
  return { x: dx * k, y: dy * k };
}

export { prefersTouch } from "./device";
