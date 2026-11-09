/**
 * @full-plate/handson — the playable shift (Roblox-style hands-on layer).
 *
 * The player walks one character around a top-down kitchen + dining room and performs short, discrete verbs
 * (grab, chop, cook, plate, carry, serve, clear, pour, take payment). Everything here is plain serialisable data:
 * a session is JSON, the core (`updateSession`) is a pure function of (session, state, input, dt), and rendering
 * (`render`) only reads. World coordinates are in tiles (1 tile ≈ a person's stride); the renderer scales them.
 */
import type { CustomerId, DishId, Pence, TableId } from "@full-plate/sim-core";
import type { StationPlan } from "./station";

/** Roles that can be played hands-on. (Porter/manager have no floor verbs of their own yet.) */
export type HandsOnRole = "chef" | "server" | "bar";

/**
 * One frame of player intent, already abstracted from the device. Booleans are "held this frame"; the session
 * does its own edge detection for presses. `moveX/moveY` (−1..1) override the d-pad booleans when present
 * (analogue stick or touch joystick).
 */
export interface HandsOnInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  interact: boolean;
  cancel: boolean;
  moveX?: number;
  moveY?: number;
}

export type StationKind =
  | "fridge" | "prep" | "stove" | "oven" | "fryer" | "pass" // kitchen
  | "table" | "bar" | "till" | "dishReturn";                // floor

export interface Station {
  id: string;
  kind: StationKind;
  /** Top-left tile and size in tiles. Stations block movement; you use them from an adjacent tile. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  tableId?: TableId;
  /** Table number as the player sees it (1-based, state.tables order — matches RestaurantView). */
  number?: number;
}

/** A non-interactive blocking prop (sink, shelves) the renderer draws. */
export interface Prop { kind: "sink" | "shelves" | "plant"; x: number; y: number; w: number; h: number }

export type CookMethod = "stove" | "oven" | "fryer" | "none" | "pour";

export interface DishProfile {
  name: string;
  /** ≤ 14 characters for ticket slips. */
  short: string;
  method: CookMethod;
  /** Food cost of one plate (pence): what a drop costs. */
  cost: Pence;
  /** Best quality (0-100) this dish can reach on the sim's scale (DishDef.qualityCeiling). */
  ceiling: number;
}

export interface CarriedPlate {
  ticketId: string;
  dishId: DishId;
  customerId: CustomerId;
  /** Session time the plate became ready (on the pass, or poured). Drives the server speed bonus. */
  readyAt: number;
  glass?: boolean;
}

export type Item =
  | { kind: "raw"; ticketId: string; dishId: DishId }
  | { kind: "prepped"; ticketId: string; dishId: DishId; prep: number }
  | { kind: "cooked"; ticketId: string; dishId: DishId; prep: number; cook: number; burnt?: boolean }
  | { kind: "plates"; plates: CarriedPlate[] }
  | { kind: "dirty"; tableId: TableId; count: number };

export type Verb =
  | "grab" | "chop" | "cook" | "plate" | "pickup" | "serve" | "clear" | "dropoff" | "payment" | "pour";

/**
 * The verb in progress. `t` counts up in seconds. Per-verb fields:
 * - chop: `marks` (0..1 cursor positions) and `marked` (0 pending, 1 hit, −1 miss); cursor = t / dur.
 * - cook: `band` [lo, hi] on the needle (needle = t / dur, held).
 * - pour: `line` fill level target (level = t × POUR_RATE, held).
 * - clear: `taps` so far of `need`.
 */
export interface ActiveAction {
  verb: Verb;
  stationId: string;
  t: number;
  dur: number;
  marks?: number[];
  marked?: number[];
  band?: [number, number];
  line?: number;
  taps?: number;
  need?: number;
  ticketId?: string;
  dishId?: DishId;
  customerId?: CustomerId;
  tableId?: TableId;
}

export interface HandsOnScore {
  /** Plates (and drinks) the player cooked/poured. */
  plates: number;
  qualitySum: number;
  /** Σ speed bonus (0..1 each) over plated (chef) and served (FOH) items. */
  speedBonus: number;
  speedCount: number;
  served: number;
  cleared: number;
  payments: number;
  drops: number;
  dropCost: Pence;
  // coaching stats
  chopHits: number;
  chopMarks: number;
  overcooked: number;
  undercooked: number;
  perfect: number;
  pours: number;
  pourSum: number;
  /** Seconds a paying party stood at the till with nobody taking payment (FOH roles). */
  tillWait: number;
  /** Running points total (see score.ts for the table). */
  points: number;
  /**
   * [round 4] Station tickets the sous chef covered (no points, lower quality); `idleCovers` of them while you idled.
   * Round 5: the sim covers (by ticket age in ticks, patience, or course deadline); the session counts them.
   */
  covered?: number;
  idleCovers?: number;
  /** [round 4] Plates whose ticket had waited more than COLD_PLATE_SECS ("went cold"). */
  slowPlates?: number;
}

export interface Toast { text: string; x: number; y: number; born: number; tone: "good" | "bad" | "info" | "money" }

/** What pressing interact right now would do (computed every update; the renderer shows it). */
export interface Prompt {
  stationId: string;
  verb?: Verb;
  label: string;
  enabled: boolean;
}

export interface HandsOnSession {
  version: 1;
  role: HandsOnRole;
  tutorial: boolean;
  /** Seconds since the session started (sum of dt). All timing and animation derive from this. */
  time: number;
  player: {
    x: number; y: number; vx: number; vy: number;
    facing: "up" | "down" | "left" | "right";
    /** 0..1 how badly a stack of plates is wobbling (bumping walls at speed); 1 = dropped. */
    wobble: number;
  };
  /** Session time until which a second cancel press bins what you're carrying. */
  binArmedUntil?: number;
  /** Options fixed at creation. `station`: the career commis station (round 4; see station.ts). */
  opts: { playerStaffId?: string; carryLimit: number; station?: StationPlan };
  /** [round 4] Session time of the player's last verb (start or finish): the sous chef's idle clock. */
  lastActiveAt?: number;
  /** [round 4] Session time of the last "need a hand?" nudge. */
  nudgedAt?: number;
  /** [round 4] Session times of the player's plates (newest last, ≤ 40) for the rolling plates-per-minute. */
  plateTimes?: number[];
  /** [round 4] Rail size last sent to the sim (pacing.ts railCapFor); a change emits RAIL_RESIZED. */
  railCap?: number;
  /** [round 5] Ticket ids on the player's rail (or in hand) last update: one that vanishes uncooked was covered. */
  railSeen?: { id: string; customerId: string; dishId: string }[];
  carrying?: Item;
  activeAction?: ActiveAction;
  stations: Station[];
  props: Prop[];
  /** Collision map, one string per row, '#' blocked / '.' free. */
  grid: string[];
  dishes: Record<DishId, DishProfile>;
  tableNumbers: Record<TableId, number>;
  /**
   * Acknowledgement sets: things the player has done that the sim may not have caught up with yet. Each is pruned
   * once the GameState reflects it, so the session never double-offers a ticket while results are in flight.
   */
  claimed: Record<string, true>;
  cooked: Record<string, true>;
  picked: Record<string, true>;
  served: Record<string, true>;
  cleared: Record<TableId, true>;
  paid: Record<CustomerId, true>;
  /** Session time a ticket was first seen open ("t:<id>") or first seen ready on the pass ("r:<id>"). */
  seenAt: Record<string, number>;
  score: HandsOnScore;
  /** Present in shift mode: the shift ends at `duration` seconds and the session stops taking input. */
  shift?: { duration: number; over: boolean };
  rng: number[];
  prevInteract: boolean;
  prevCancel: boolean;
  toasts: Toast[];
  message?: { text: string; until: number };
  prompt?: Prompt;
}

/**
 * What the session tells the sim. The game turns these into sim-core commands (see docs/HANDSON-NOTES.md):
 * PLATE_COOKED → PLAYER_COOKED, TABLE_SERVED → PLAYER_SERVED, TABLE_CLEARED → PLAYER_CLEARED,
 * PAYMENT_TAKEN → PLAYER_TOOK_PAYMENT, DROPPED → a small cash cost (and a re-fire of any plated tickets listed).
 */
export type HandsOnResult =
  | {
      type: "PLATE_COOKED";
      ticketId: string;
      /** Plate quality on the sim's 0-100 scale: execution × the dish's quality ceiling. */
      quality: number;
      /** The player's execution 0..1 (prep, cook or pour timing), before the ceiling. */
      execution: number;
      station: CookMethod;
      /** Chef/bar speed bonus 0..1 (ticket age when plated). */
      speedBonus: number;
    }
  | { type: "TABLE_SERVED"; customerId: CustomerId; ticketId: string; speedBonus: number }
  | { type: "TABLE_CLEARED"; tableId: TableId }
  /** The player picked a ticket up (fridge grab, or started a pour): the sim should stop an AI cook taking it. */
  | { type: "TICKET_CLAIMED"; ticketId: string }
  | { type: "PAYMENT_TAKEN"; customerId: CustomerId }
  /** [round 4] Pacing changed the station's rail size: the game re-sends SET_HANDS_ON with the new `cap`. */
  | { type: "RAIL_RESIZED"; cap: number }
  | { type: "DROPPED"; cost: Pence; item: Item["kind"]; ticketIds?: string[] };

export interface UpdateResult {
  session: HandsOnSession;
  results: HandsOnResult[];
}

export interface Hint { text: string; stationId?: string }
