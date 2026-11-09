import { useState } from "react";
import type { ContentPack, Difficulty } from "@full-plate/sim-core";
import type { CareerTrack, OwnerStrategy } from "@full-plate/sim-career";
import { districtIcon } from "./NewGame";
import { DifficultyPicker } from "../components/DifficultyPicker";

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
  /** Round 7: how long the road to your own place is, 0 (you start there) to 3 (longest). */
  road: 0 | 1 | 2 | 3;
  /** Round 7: what you play, in a few words. */
  play: string;
}

export const STARTS: StartDef[] = [
  { id: "owner", name: "Owner", icon: "🔑", line: "Run your very own restaurant from day one: the menu, the team and the money.", length: "You own it now", road: 0, play: "Plan the day, watch it run" },
  { id: "chef", name: "Apprentice chef", icon: "🔪", line: "Cook in someone else's kitchen and work your way up to head chef.", length: "The longest road", road: 3, play: "Cook the orders yourself" },
  { id: "bar", name: "Bar", icon: "🍸", line: "Mix the drinks, keep the bar stocked and get to know the regulars.", length: "A middle road", road: 2, play: "Pour the drinks yourself" },
  { id: "waiter", name: "Waiter", icon: "🍽️", line: "Look after the tables, carry the plates and share the tips.", length: "A middle road", road: 2, play: "Serve the tables yourself" },
  { id: "manager", name: "Restaurant manager", icon: "📋", line: "Run someone else's restaurant. Hit your targets or you're out.", length: "The shortest road", road: 1, play: "Watch the room and the numbers" },
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
          <button className="btn btn--ghost btn--tap" onClick={onBack}>← Back</button>
          <h1>Who do you want to be?</h1>
        </div>

        <div className="starts" role="radiogroup" aria-label="Start as">
          {STARTS.map((s) => (
            <button key={s.id} role="radio" aria-checked={s.id === start} className={`card start start--${s.id}`} onClick={() => setStart(s.id)}>
              <span className="start__icon" aria-hidden="true">{s.icon}</span>
              <span className="start__name">{s.name}</span>
              <span className="start__line">{s.line}</span>
              <span className="start__play"><span aria-hidden="true">🎮</span> {s.play}</span>
              <span className="start__road" aria-label={`Road to your own place: ${s.length}`}>
                {s.road > 0 && <span className="start__pips" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= s.road ? "on" : ""} />)}</span>}
                <span className="start__len">{s.road === 0 ? "🔑 " : ""}{s.length}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="startpick__opts">
          <div className="card stack">
            <div className="field">
              <span className="field__label startpick__q" id="diff-l">How tricky?</span>
              <DifficultyPicker value={difficulty} onChange={setDifficulty} labelId="diff-l" />
            </div>
          </div>

          <div className="card stack">
            <div className="field">
              <span className="field__label startpick__q" id="dist-l">{start === "owner" ? "Where will you open?" : "Where's your first job?"}</span>
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
