/** The little people on the owner's canvas: sprite records and staff looks (split out of RestaurantView.ts in round 11). */
import type { Customer, CustomerId, Staff } from "@full-plate/sim-core";
import { avatarFor } from "@full-plate/sim-core";
import type { Facing, Look } from "@full-plate/handson/sprites";
import { C } from "./frame";
import type { Pt } from "./layout";

// ───────────────────────── sprites ─────────────────────────
export interface Sprite {
  key: string;
  customerId: CustomerId;
  segment: string;
  member: number;
  x: number; y: number;
  path: Pt[];
  target: Pt | null;
  leaving: boolean;
  walkedOut: boolean;
  phase: number;
  facing: Facing;
  /** Round 12 (A): queue shuffle — don't start the step up before this time (performance.now ms). */
  wait?: number;
}
export interface StaffSprite { id: string; x: number; y: number; path: Pt[]; target: Pt | null; task?: string; until: number; facing: Facing; via?: Pt; moving: boolean }
export interface Floaty { x: number; y: number; text: string; colour: string; born: number; life: number }


export const SEATED = new Set<Customer["stage"]>(["seated", "ordered", "eating", "paying"]);

/** Staff sprites are a touch bigger than guests (they're the ones you watch). */
export const L_PERSON_STAFF = 1.15;

export function staffLook(s: Staff, mine?: { skin: string; hair: string }): Look {
  // Round 10 review: skin and hair come from sim-core's avatarFor, the one rule the staff-room portraits use too (the
  // career player: the look they picked).
  const { skin, hair } = mine ?? avatarFor(s);
  switch (s.role) {
    case "chef": return { body: "#fbfaf6", skin, hair, hat: "toque", hatColour: "#fffdf8", trim: C.tomato, apron: "#ece7dc" };
    case "server": return { body: "#2f3a33", skin, hair, hat: "cap", hatColour: C.basil, shirt: true, trim: C.tomato, apron: "#1f2622" };
    case "bar": return { body: C.plum, skin, hair, hat: "cap", hatColour: C.outline, shirt: true, trim: C.ink };
    case "porter": return { body: C.sky, skin, hair, apron: "#3a7398" };
    default: return { body: C.inkSoft, skin, hair, shirt: true, trim: C.gold };
  }
}
