/**
 * Round 13 (D): a read-only brand card for the career's MyShift screen — the employer's logo, name in its lettering and
 * what the kit is made of, with the line that it isn't hers yet. An employee wears the employer's default brand
 * (resolveBrand read-only: stored codes are ignored until the handover). Lazy (lib/brand is its own chunk).
 */
import type { CSSProperties } from "react";
import { brandVars, lettering, logoDataUrl, MENU_NAMES, MOTIF_NAMES, resolveBrand, SHAPE_NAMES, UNIFORM_NAMES } from "../lib/brand";

export function HouseBrandCard({ name, code }: { name: string; code?: string | undefined }) {
  const b = resolveBrand(code, name, true);
  const f = lettering(b.letter);
  return (
    <section className="card housebrand" aria-labelledby="housebrand-h" style={brandVars(b) as CSSProperties} data-testid="house-brand">
      <div className="card__title"><h3 id="housebrand-h">The house brand</h3><span className="xs faint">read-only</span></div>
      <div className="housebrand__mark">
        <img className="brandlogo" src={logoDataUrl(b)} width={64} height={64} alt={`${name} logo`} />
        <div>
          <span className="wordmark housebrand__name" style={{ fontFamily: f.family, fontWeight: f.weight, fontStyle: f.style, textTransform: f.transform, letterSpacing: f.spacing }}>{name}</span>
          <div className="small muted">{SHAPE_NAMES[b.shape]} · {MOTIF_NAMES[b.motif]} · {MENU_NAMES[b.menu]} menu · staff in {UNIFORM_NAMES[b.uniform].toLowerCase()}s</div>
        </div>
      </div>
      <p className="small muted">This is {name}'s brand, and that's your uniform. You can design your own once you run the place.</p>
    </section>
  );
}
