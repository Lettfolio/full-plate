/**
 * Device input → HandsOnInput. The session never sees devices: the game (or demo) owns one InputSource and calls
 * `read()` once per frame. Keyboard: WASD / arrows to move, E or Space to interact, Q / Escape / Backspace to cancel.
 * Gamepad (standard mapping): left stick or d-pad to move, A to interact, B to cancel. Touch is optional: call
 * `setTouch` from an on-screen joystick/button.
 */
import type { HandsOnInput } from "./types";

const KEYMAP: Record<string, keyof Omit<HandsOnInput, "moveX" | "moveY">> = {
  KeyW: "up", ArrowUp: "up",
  KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  KeyE: "interact", Space: "interact", Enter: "interact",
  KeyQ: "cancel", Escape: "cancel", Backspace: "cancel",
};

export interface InputSource {
  read(): HandsOnInput;
  setTouch(t: Partial<HandsOnInput> | null): void;
  dispose(): void;
}

/** Combine several inputs (any button held counts; the strongest analogue axis wins). */
export function mergeInputs(...inputs: HandsOnInput[]): HandsOnInput {
  const out: HandsOnInput = { up: false, down: false, left: false, right: false, interact: false, cancel: false };
  let ax = 0, ay = 0;
  for (const i of inputs) {
    out.up ||= i.up; out.down ||= i.down; out.left ||= i.left; out.right ||= i.right;
    out.interact ||= i.interact; out.cancel ||= i.cancel;
    if (i.moveX !== undefined && Math.abs(i.moveX) > Math.abs(ax)) ax = i.moveX;
    if (i.moveY !== undefined && Math.abs(i.moveY) > Math.abs(ay)) ay = i.moveY;
  }
  if (ax !== 0 || ay !== 0) {
    // digital presses still count when the stick is idle on that axis
    const dx = (out.right ? 1 : 0) - (out.left ? 1 : 0);
    const dy = (out.down ? 1 : 0) - (out.up ? 1 : 0);
    out.moveX = ax !== 0 ? ax : dx;
    out.moveY = ay !== 0 ? ay : dy;
  }
  return out;
}

/** Reads a standard-mapping gamepad into a HandsOnInput (pure, so it can be tested with a fake pad). */
export function gamepadInput(pad: { axes: readonly number[]; buttons: readonly { pressed: boolean }[] } | null | undefined, dead = 0.22): HandsOnInput {
  const none: HandsOnInput = { up: false, down: false, left: false, right: false, interact: false, cancel: false };
  if (!pad) return none;
  const b = (i: number) => !!pad.buttons[i]?.pressed;
  const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
  const live = Math.hypot(ax, ay) > dead;
  return {
    up: b(12), down: b(13), left: b(14), right: b(15),
    interact: b(0), cancel: b(1),
    ...(live ? { moveX: ax, moveY: ay } : {}),
  };
}

/**
 * Round 7: keys typed on a button or a form field belong to it (Enter/Space press the onboarding's Next, Pause, Skip),
 * not to the cook — and must not be swallowed by preventDefault.
 */
export function onControl(e: Pick<KeyboardEvent, "target">): boolean {
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = el?.tagName?.toUpperCase();
  return tag === "BUTTON" || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "A" || !!el?.isContentEditable;
}

export function createInputSource(target: Window = window): InputSource {
  const held = new Set<string>();
  let touch: Partial<HandsOnInput> | null = null;
  const down = (e: KeyboardEvent) => {
    if (!(e.code in KEYMAP) || onControl(e)) return;
    e.preventDefault();
    held.add(KEYMAP[e.code]!);
  };
  const up = (e: KeyboardEvent) => {
    if (!(e.code in KEYMAP)) return;
    // only release if no other key bound to the same action is still down
    const action = KEYMAP[e.code]!;
    pressedCodes.delete(e.code);
    if (![...pressedCodes].some((c) => KEYMAP[c] === action)) held.delete(action);
  };
  const pressedCodes = new Set<string>();
  const trackDown = (e: KeyboardEvent) => { if (e.code in KEYMAP && !onControl(e)) pressedCodes.add(e.code); down(e); };
  const blur = () => { held.clear(); pressedCodes.clear(); };
  target.addEventListener("keydown", trackDown);
  target.addEventListener("keyup", up);
  target.addEventListener("blur", blur);
  return {
    read() {
      const kb: HandsOnInput = {
        up: held.has("up"), down: held.has("down"), left: held.has("left"), right: held.has("right"),
        interact: held.has("interact"), cancel: held.has("cancel"),
      };
      const pads = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()] : [];
      const pad = pads.find((p) => p && p.connected) ?? null;
      const t: HandsOnInput = { up: false, down: false, left: false, right: false, interact: false, cancel: false, ...(touch ?? {}) };
      return mergeInputs(kb, gamepadInput(pad), t);
    },
    setTouch(t) { touch = t; },
    dispose() {
      target.removeEventListener("keydown", trackDown);
      target.removeEventListener("keyup", up);
      target.removeEventListener("blur", blur);
    },
  };
}
