import { useMemo, useState } from "react";
import type { ContentPack, Difficulty, DistrictDef } from "@full-plate/sim-core";
import { Bar } from "../components/Bar";
import { MoneyText } from "../components/MoneyText";
import { segmentName } from "../lib/content";

interface Props {
  content: ContentPack;
  initialSeed: number;
  onStart: (seed: number, districtId: string, name: string, difficulty: Difficulty) => void;
  onBack: () => void;
}

const DIFFICULTIES: { id: Difficulty; name: string; desc: string }[] = [
  { id: "cosy", name: "Cosy", desc: "You can't go bust. Take your time and learn the ropes." },
  { id: "normal", name: "Normal", desc: "Real pressure: keep cash above water or the bank steps in." },
  { id: "hard", name: "Hard", desc: "Tight margins, fussy customers, and the bank is not patient." },
];

const NAME_IDEAS = ["The Hungry Fox", "Little Saucepan", "Plates & Co.", "The Golden Spoon", "Basil & Bean", "Crumbs"];
const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/** Emoji per district id/name keyword; falls back to a fork-and-knife. */
function districtIcon(d: DistrictDef): string {
  const k = `${d.id} ${d.name}`.toLowerCase();
  if (k.includes("student")) return "🎒";
  if (k.includes("business") || k.includes("office")) return "💼";
  if (k.includes("sea") || k.includes("beach")) return "🏖️";
  if (k.includes("high")) return "🛍️";
  return "🍴";
}

export function NewGame({ content, initialSeed, onStart, onBack }: Props) {
  const [districtId, setDistrictId] = useState(content.districts[0]?.id ?? "");
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("cosy");
  const [seedText, setSeedText] = useState(String(initialSeed));
  const placeholder = useMemo(() => NAME_IDEAS[initialSeed % NAME_IDEAS.length]!, [initialSeed]);
  const seed = Number.parseInt(seedText, 10);
  const seedOk = Number.isFinite(seed) && seed >= 0 && seed <= 0xffffffff;
  const maxFootfall = Math.max(1, ...content.districts.map((d) => d.footfall));

  return (
    <div className="page">
      <div className="newgame">
        <div className="newgame__head">
          <button className="btn btn--ghost btn--sm" onClick={onBack}>← Back</button>
          <h1>Where will you open?</h1>
        </div>

        <section aria-label="District">
          <div className="districts" role="radiogroup" aria-label="District">
            {content.districts.map((d) => {
              const mix = Object.entries(d.segmentMix).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
              const peak = Math.max(...d.seasonCurve, 0.01);
              return (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={d.id === districtId}
                  className="card district"
                  onClick={() => setDistrictId(d.id)}
                >
                  <div className="district__top">
                    <span className="district__icon" aria-hidden="true">{districtIcon(d)}</span>
                    <span className="district__name">{d.name}</span>
                    <span className="district__check" aria-hidden="true">{d.id === districtId ? "✓" : ""}</span>
                  </div>
                  <p className="muted small">{d.blurb}</p>
                  <div className="district__facts">
                    <div>
                      <div className="fact__k">Rent</div>
                      <div className="fact__v"><MoneyText pence={d.monthlyRent} whole /> <span className="faint small">/ month</span></div>
                    </div>
                    <div>
                      <div className="fact__k">Footfall</div>
                      <div className="fact__v">{d.footfall.toLocaleString("en-GB")} <span className="faint small">/ day</span></div>
                      <Bar value={d.footfall} max={maxFootfall} tone="sky" size="sm" />
                    </div>
                  </div>
                  <div>
                    <div className="fact__k" style={{ marginBottom: 4 }}>Who walks past</div>
                    <div className="mix">
                      {mix.map(([seg, v]) => (
                        <Bar key={seg} label={segmentName(content, seg)} value={v * 100} tone="accent" size="sm" showValue />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="fact__k" style={{ marginBottom: 4 }}>Busy months</div>
                    <div className="season" aria-hidden="true">
                      {d.seasonCurve.map((v, i) => <span key={i} className="season__m" style={{ height: `${(v / peak) * 100}%` }} />)}
                    </div>
                    <div className="season__labels" aria-hidden="true">{MONTH_INITIALS.map((m, i) => <span key={i}>{m}</span>)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="card stack">
          <label className="field">
            <span className="field__label">Restaurant name</span>
            <input className="input" value={name} maxLength={32} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
          </label>

          <div className="field">
            <span className="field__label">Difficulty</span>
            <div className="difficulty" role="radiogroup" aria-label="Difficulty">
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

          <label className="field">
            <span className="field__label">Seed</span>
            <span className="seedrow">
              <input className="input" inputMode="numeric" value={seedText} onChange={(e) => setSeedText(e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!seedOk} />
              <button type="button" className="iconbtn" title="New random seed" aria-label="New random seed" onClick={() => setSeedText(String(Math.floor(Math.random() * 900_000) + 100_000))}>⟳</button>
            </span>
            <span className="xs faint">Same seed + same choices = the same game. Share it with a friend.</span>
          </label>

          <div className="small muted">
            You start with <b><MoneyText pence={content.balance.startingCash} whole /></b> savings and a{" "}
            <b><MoneyText pence={content.balance.loanPrincipal} whole /></b> bank loan over {Math.round(content.balance.loanTermDays / 365 * 10) / 10} years.
          </div>

          <button className="btn btn--primary btn--xl" disabled={!districtId || !seedOk} onClick={() => onStart(seed, districtId, name.trim() || placeholder, difficulty)}>
            Sign the lease →
          </button>
        </aside>
      </div>
    </div>
  );
}
