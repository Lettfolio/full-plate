import { useState } from "react";
import type { ContentPack, Difficulty } from "@full-plate/sim-core";
import type { CareerTrack, OwnerStrategy } from "@full-plate/sim-career";
import { DIFFICULTIES, districtIcon } from "./NewGame";

/** The five starts from BRIEF "Starting levels: the career ladder". */
export type StartKind = "owner" | CareerTrack;

export interface StartDef {
  id: StartKind;
  name: string;
  icon: string;
  /** One line from the brief's "What you actually do". */
  line: string;
  /** "Typical length to ownership". */
  length: string;
}

export const STARTS: StartDef[] = [
  { id: "owner", name: "Owner", icon: "🔑", line: "Lease, loan, menu and hiring from day one. Straight into running the place.", length: "You own it now" },
  { id: "chef", name: "Apprentice chef", icon: "🔪", line: "Commis in someone else's kitchen: prep, stations, timing. Climb to head chef.", length: "Longest road to your own place" },
  { id: "bar", name: "Bar", icon: "🍸", line: "Drinks orders, stock, regulars and late shifts. Bar back to general manager.", length: "A medium road" },
  { id: "waiter", name: "Waiter", icon: "🍽️", line: "Read tables, time courses with the kitchen, earn a share of the tips (the tronc). Up to restaurant manager.", length: "A medium road" },
  { id: "manager", name: "Restaurant manager", icon: "📋", line: "Run someone else's restaurant for a salary and a bonus. Hit targets — or be fired.", length: "The shortest road" },
];

const OWNERS: { id: OwnerStrategy; name: string; desc: string }[] = [
  { id: "balanced", name: "A fair boss", desc: "Steady hours, decent tips." },
  { id: "premium", name: "A fussy boss", desc: "High standards. You'll learn fast." },
  { id: "cheap", name: "A cheap boss", desc: "Six-day rotas, no training. Hard mode." },
];

export interface CareerStartOptions {
  track: CareerTrack;
  strategy: OwnerStrategy;
  playerName: string;
  difficulty: Difficulty;
  districtId: string;
}

interface Props {
  content: ContentPack;
  onOwner: (difficulty: Difficulty, districtId: string) => void;
  onCareer: (opts: CareerStartOptions) => void;
  onBack: () => void;
}

/** Title → "Start as…": pick a rung, a difficulty and a district. Owner continues to the lease screen. */
export function StartPicker({ content, onOwner, onCareer, onBack }: Props) {
  const [start, setStart] = useState<StartKind>("owner");
  const [difficulty, setDifficulty] = useState<Difficulty>("cosy");
  const [districtId, setDistrictId] = useState(content.districts[0]?.id ?? "");
  const [strategy, setStrategy] = useState<OwnerStrategy>("balanced");
  const [name, setName] = useState("");
  const def = STARTS.find((s) => s.id === start)!;
  const go = () => (start === "owner" ? onOwner(difficulty, districtId) : onCareer({ track: start, strategy, playerName: name.trim() || "You", difficulty, districtId }));

  return (
    <div className="page">
      <div className="startpick">
        <div className="newgame__head">
          <button className="btn btn--ghost btn--sm" onClick={onBack}>← Back</button>
          <h1>Start as…</h1>
        </div>

        <div className="starts" role="radiogroup" aria-label="Start as">
          {STARTS.map((s) => (
            <button key={s.id} role="radio" aria-checked={s.id === start} className={`card start start--${s.id}`} onClick={() => setStart(s.id)}>
              <span className="start__icon" aria-hidden="true">{s.icon}</span>
              <span className="start__name">{s.name}</span>
              <span className="start__line">{s.line}</span>
              <span className="start__len">{s.length}</span>
            </button>
          ))}
        </div>

        <div className="startpick__opts">
          <div className="card stack">
            <div className="field">
              <span className="field__label" id="diff-l">Difficulty</span>
              <div className="difficulty" role="radiogroup" aria-labelledby="diff-l">
                {DIFFICULTIES.map((d) => (
                  <button key={d.id} role="radio" aria-checked={difficulty === d.id} className="diff" onClick={() => setDifficulty(d.id)}>
                    <span className="diff__dot" aria-hidden="true" />
                    <span>
                      <span className="diff__name">{d.name}</span>
                      <span className="diff__desc" style={{ display: "block" }}>{d.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card stack">
            <div className="field">
              <span className="field__label" id="dist-l">{start === "owner" ? "Where will you open?" : "Where's your first job?"}</span>
              <div className="districtpick" role="radiogroup" aria-labelledby="dist-l">
                {content.districts.map((d) => (
                  <button key={d.id} role="radio" aria-checked={districtId === d.id} className="diff" onClick={() => setDistrictId(d.id)}>
                    <span className="district__icon" aria-hidden="true">{districtIcon(d)}</span>
                    <span>
                      <span className="diff__name">{d.name}</span>
                      <span className="diff__desc" style={{ display: "block" }}>{d.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card stack">
            {start === "owner" ? (
              <p className="small muted">Next you'll name your restaurant and sign the lease.</p>
            ) : (
              <>
                <label className="field">
                  <span className="field__label">Your name</span>
                  <input className="input" value={name} maxLength={24} placeholder="Alex" onChange={(e) => setName(e.target.value)} />
                </label>
                <div className="field">
                  <span className="field__label" id="boss-l">Your first boss</span>
                  <div className="difficulty" role="radiogroup" aria-labelledby="boss-l">
                    {OWNERS.map((o) => (
                      <button key={o.id} role="radio" aria-checked={strategy === o.id} className="diff" onClick={() => setStrategy(o.id)}>
                        <span className="diff__dot" aria-hidden="true" />
                        <span>
                          <span className="diff__name">{o.name}</span>
                          <span className="diff__desc" style={{ display: "block" }}>{o.desc}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <button className="btn btn--primary btn--xl" disabled={!districtId} onClick={go}>
              {start === "owner" ? "Choose a name →" : `Start as ${def.name.toLowerCase()} →`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
