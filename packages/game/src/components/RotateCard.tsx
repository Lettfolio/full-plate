import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePhonePortrait } from "../lib/layout";

/**
 * Round 12 (D): the hands-on kitchen is laid out for a wide screen (stations along the back wall, the pass in front),
 * so an upright phone gets this card instead of a squashed kitchen. It is an `aria-modal` dialog, which is what
 * HandsOnShift already checks (lib/modal.ts) to hold the shift: the clock stops until the phone is turned, or until
 * the player chooses to carry on upright. Turning the phone back upright brings the card back.
 * Round 13 (C): "anyway" now gets a real upright layout (HandsOnShift's `upright`: a following camera, a drag pad and
 * USE/Drop under the kitchen), not the sideways kitchen squeezed into 390 px.
 */
/**
 * Round 14 (E, U17): whether the turn card is up, so the hands-on how-to (HandsOnHowTo, in the shift's own chunk)
 * waits for it instead of stacking under it: rotate first, then the how-to.
 */
let rotateUp = false;
const rotateSubs = new Set<() => void>();
function setRotateUp(v: boolean): void { if (v !== rotateUp) { rotateUp = v; for (const f of rotateSubs) f(); } }
export function useRotateCardUp(): boolean {
  return useSyncExternalStore((f) => { rotateSubs.add(f); return () => { rotateSubs.delete(f); }; }, () => rotateUp, () => false);
}

export function RotateCard() {
  const portrait = usePhonePortrait();
  const [anyway, setAnyway] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!portrait) setAnyway(false); }, [portrait]);
  useEffect(() => { if (portrait && !anyway) btn.current?.focus(); }, [portrait, anyway]);
  const up = portrait && !anyway;
  useEffect(() => { setRotateUp(up); return () => setRotateUp(false); }, [up]);
  if (!up) return null;
  return (
    <div className="modal-back turncard-back">
      <div className="modal turncard" role="dialog" aria-modal="true" aria-labelledby="rotate-t" aria-describedby="rotate-d">
        <div className="modal__body">
          <svg className="turncard__art" viewBox="0 0 96 64" width="96" height="64" aria-hidden="true" focusable="false">
            <rect x="8" y="10" width="26" height="44" rx="5" fill="none" stroke="currentColor" strokeWidth="3" />
            <rect x="50" y="22" width="40" height="26" rx="5" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M30 6 C44 0 56 4 62 14" fill="none" stroke="var(--tomato)" strokeWidth="3" strokeLinecap="round" />
            <path d="M62 14 l-1 -8 M62 14 l-8 -2" fill="none" stroke="var(--tomato)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <h2 id="rotate-t">Turn your phone sideways</h2>
          <p id="rotate-d">The kitchen fits best sideways: stations along the back, the pass along the front. Upright works too: the kitchen slides along with you and the controls sit underneath. The shift is on hold until you choose.</p>
          <button ref={btn} className="btn btn--ghost btn--tap" onClick={() => setAnyway(true)}>Play it upright anyway</button>
        </div>
      </div>
    </div>
  );
}
