/**
 * Round 3: incident and goal text can come from the content pack (`ContentPack.incidentText` / `goalText`, which the
 * content package exports from its JSON). Anything the pack leaves out falls back to the built-in text in
 * incidents/text.ts and goals/text.ts, key by key, so a partial or older pack can never break an incident or a goal.
 * Merged results are cached per content pack (packs are immutable).
 */
import { GOAL_LADDER, GOAL_LINES, type GoalDef } from "./goals/text";
import { INCIDENT_LINES, INCIDENT_TEXT, type IncidentText } from "./incidents/text";
import type { ContentPack, GoalKind, IncidentKind } from "./types";

export type IncidentLines = { [K in keyof typeof INCIDENT_LINES]: string };
export type GoalLines = { [K in keyof typeof GOAL_LINES]: string };

interface Resolved {
  incidents: Record<IncidentKind, IncidentText>;
  lines: IncidentLines;
  ladder: readonly GoalDef[];
  goalLines: GoalLines;
}

const GOAL_KINDS: ReadonlySet<GoalKind> = new Set<GoalKind>([
  "add_dishes", "hire_role", "order_stock", "open_first_day", "serve_covers", "earn_rating",
  "profit_day", "profit_week", "buy_table", "survive_days", "resolve_incident", "reach_popularity",
]);

const isStr = (x: unknown): x is string => typeof x === "string";

/** String values of `over` for keys `base` has; everything else from `base`. */
function mergeLines<T extends Record<string, string>>(base: T, over: Record<string, unknown> | undefined): T {
  if (!over) return base;
  const out: Record<string, string> = { ...base };
  for (const k of Object.keys(base)) if (isStr(over[k])) out[k] = over[k];
  return out as T;
}

function mergeIncident(base: IncidentText, over: unknown): IncidentText {
  if (!over || typeof over !== "object") return base;
  const o = over as Partial<IncidentText>;
  const options: IncidentText["options"] = {};
  for (const [id, b] of Object.entries(base.options)) {
    const x = o.options?.[id];
    options[id] = x && isStr(x.label) && isStr(x.description) && isStr(x.outcome) ? { label: x.label, description: x.description, outcome: x.outcome } : b;
  }
  return {
    title: isStr(o.title) ? o.title : base.title,
    body: isStr(o.body) ? o.body : base.body,
    ignored: isStr(o.ignored) ? o.ignored : base.ignored,
    options,
  };
}

function ladderFrom(pack: ContentPack): readonly GoalDef[] {
  const raw = pack.goalText?.GOAL_LADDER;
  if (!Array.isArray(raw) || raw.length === 0) return GOAL_LADDER;
  const ok = raw.filter(
    (d) => d && isStr(d.id) && GOAL_KINDS.has(d.kind as GoalKind) && Number.isInteger(d.tier) && isStr(d.title) && isStr(d.hint)
      && (d.target === "tablesPlus2" || typeof d.target === "number"),
  ) as GoalDef[];
  return ok.length ? ok : GOAL_LADDER;
}

const cache = new WeakMap<ContentPack, Resolved>();
const BUILT_IN: Resolved = { incidents: INCIDENT_TEXT, lines: INCIDENT_LINES, ladder: GOAL_LADDER, goalLines: GOAL_LINES };

function resolve(content: ContentPack | undefined): Resolved {
  if (!content || (!content.incidentText && !content.goalText)) return BUILT_IN;
  let r = cache.get(content);
  if (!r) {
    const src = content.incidentText?.INCIDENT_TEXT;
    const incidents = {} as Record<IncidentKind, IncidentText>;
    for (const kind of Object.keys(INCIDENT_TEXT) as IncidentKind[]) incidents[kind] = mergeIncident(INCIDENT_TEXT[kind], src?.[kind]);
    r = {
      incidents,
      lines: mergeLines(INCIDENT_LINES as IncidentLines, content.incidentText?.INCIDENT_LINES),
      ladder: ladderFrom(content),
      goalLines: mergeLines(GOAL_LINES as GoalLines, content.goalText?.GOAL_LINES),
    };
    cache.set(content, r);
  }
  return r;
}

/** Incident title/body/options/ignored text for each kind (pack text where given, built-in otherwise). */
export const incidentTextOf = (content: ContentPack | undefined): Record<IncidentKind, IncidentText> => resolve(content).incidents;
/** Incident one-liners (INCIDENT_LINES). */
export const incidentLinesOf = (content: ContentPack | undefined): IncidentLines => resolve(content).lines;
/** The goal ladder (GOAL_LADDER). */
export const goalLadderOf = (content: ContentPack | undefined): readonly GoalDef[] => resolve(content).ladder;
/** Goal log lines (GOAL_LINES). */
export const goalLinesOf = (content: ContentPack | undefined): GoalLines => resolve(content).goalLines;
