/**
 * Round 12 (B): the brand kit. `BrandCard` sits on the Restaurant tab (the logo, the shopfront in the house colours,
 * "Edit brand" and "Postcard"); `BrandSheet` is the editor: logo shape, motif, lettering, two house colours (curated
 * swatches or any hex), the staff uniform and the menu-card style, with a live preview and "Randomise". Saving sends
 * one brand code to the reducer (`PathMeta.brand`), which travels with the save. A lazy chunk.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { avatarFor, type GameState, type StaffRole } from "@full-plate/sim-core";
import type { PathMeta } from "../../state/paths";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { Avatar } from "../../components/Avatar";
import { Shopfront } from "../../components/Shopfront";
import { PostcardButton } from "../../components/PostcardDialog";
import {
  avatarUniform, brandVars, encodeBrand, isHex, LETTER_NAMES, LETTERS, lettering, logoDataUrl, MENU_NAMES, MENUS, MOTIF_NAMES, MOTIFS,
  normHex, onColour, PALETTE, randomBrand, resolveBrand, SHAPE_NAMES, SHAPES, UNIFORM_NAMES, UNIFORMS, useBrand, type Brand,
} from "../../lib/brand";
import "./BrandTab.css";

const isReadOnly = (meta: PathMeta) => meta.mode === "career" && !!meta.career && !meta.career.handover;
const brandName = (game: GameState, meta: PathMeta) => meta.empire?.brand.name ?? game.restaurantName;

/** The restaurant's name in the brand's lettering. */
export function Wordmark({ brand, name, className = "" }: { brand: Brand; name: string; className?: string }) {
  const f = lettering(brand.letter);
  return <span className={`wordmark ${className}`} style={{ fontFamily: f.family, fontWeight: f.weight, fontStyle: f.style, textTransform: f.transform, letterSpacing: f.spacing }}>{name}</span>;
}

export function Logo({ brand, size = 64, title }: { brand: Brand; size?: number; title?: string }) {
  return <img className="brandlogo" src={logoDataUrl(brand)} width={size} height={size} alt={title ?? ""} {...(title ? {} : { "aria-hidden": true })} />;
}

/** Restaurant tab: the brand at a glance. */
export function BrandCard({ game, meta, onBrand }: { game: GameState; meta: PathMeta; onBrand?: ((code: string) => void) | undefined }) {
  const live = useBrand();
  const brand = live ?? resolveBrand(meta.brand, brandName(game, meta), isReadOnly(meta));
  const [editing, setEditing] = useState(false);
  const ro = isReadOnly(meta) || !onBrand;
  return (
    <section className="card panel brandcard" aria-labelledby="brandcard-t" style={brandVars(brand) as CSSProperties}>
      <div className="card__title">
        <h3 id="brandcard-t">Your brand</h3>
        <span className="small muted">{meta.brand ? "Your design" : "Made from your restaurant's name — make it yours"}</span>
      </div>
      <div className="brandcard__body">
        <div className="brandcard__mark">
          <Logo brand={brand} size={96} title={`${game.restaurantName} logo`} />
          <div>
            <Wordmark brand={brand} name={brandName(game, meta)} className="brandcard__name" />
            <div className="small muted">{SHAPE_NAMES[brand.shape]} · {MOTIF_NAMES[brand.motif]} · {MENU_NAMES[brand.menu]} menu · staff in {UNIFORM_NAMES[brand.uniform].toLowerCase()}s</div>
          </div>
        </div>
        <Shopfront className="brandcard__shop" name={brandName(game, meta)} logo={logoDataUrl(brand)} small />
      </div>
      <div className="brandcard__buttons">
        {ro
          ? <p className="small muted">This is {game.restaurantName}'s brand. You can design your own once you run the place.</p>
          : <button className="btn btn--tap" onClick={() => setEditing(true)}><Icon name="settings" size={20} />Edit brand</button>}
        <PostcardButton game={game} className="btn btn--tap" />
      </div>
      {editing && onBrand && (
        <BrandSheet
          start={brand}
          name={brandName(game, meta)}
          game={game}
          onClose={() => setEditing(false)}
          onSave={(b) => { onBrand(encodeBrand(b)); setEditing(false); }}
        />
      )}
    </section>
  );
}

function Choice({ label, picked, onPick, children, wide }: { label: string; picked: boolean; onPick: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <button type="button" className={`brandopt ${wide ? "brandopt--wide" : ""}`} role="radio" aria-checked={picked} aria-label={label} title={label} onClick={onPick}>
      {children}
    </button>
  );
}

function Swatches({ label, value, onPick }: { label: string; value: string; onPick: (hex: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (shown !== value) { setShown(value); setText(value); }
  const id = `hex-${label.replace(/\W+/g, "")}`;
  return (
    <div className="brandsw">
      <div className="brandsw__row" role="radiogroup" aria-label={label}>
        {PALETTE.map((c) => (
          <button key={c.hex} type="button" className="brandsw__chip" role="radio" aria-checked={value === c.hex} aria-label={c.name} title={c.name}
            style={{ background: c.hex, color: onColour(c.hex) }} onClick={() => onPick(c.hex)}>
            {value === c.hex && <Icon name="check" size={20} />}
          </button>
        ))}
      </div>
      <label className="brandsw__hex" htmlFor={id}>
        <span className="small">Or any colour</span>
        <span className="brandsw__dot" style={{ background: value }} aria-hidden="true" />
        <input id={id} type="text" inputMode="text" spellCheck={false} maxLength={7} value={text} aria-label={`${label}: hex code`}
          onChange={(e) => { setText(e.target.value); if (isHex(e.target.value)) onPick(normHex(e.target.value)); }} />
      </label>
      {!isHex(text) && text.length >= 4 && <span className="small muted">A colour code is # and six of 0–9 and a–f, like #c4412b.</span>}
    </div>
  );
}

const SAMPLE: { role: StaffRole; name: string }[] = [{ role: "chef", name: "Rosa Chef" }, { role: "server", name: "Theo Server" }, { role: "bar", name: "Ike Bar" }, { role: "manager", name: "Mo Manager" }];

/** The editor sheet. */
export function BrandSheet({ start, name, game, onClose, onSave }: { start: Brand; name: string; game: GameState; onClose: () => void; onSave: (b: Brand) => void }) {
  const [b, setB] = useState<Brand>(start);
  const [spins, setSpins] = useState(0);
  const set = (patch: Partial<Brand>) => setB((x) => ({ ...x, ...patch }));
  const people = useMemo(() => SAMPLE.map((s) => game.staff.find((p) => p.role === s.role) ?? { id: `sample-${s.role}`, ...s }), [game.staff]);
  return (
    <Dialog title="Brand kit" kicker={name} stamp={<Icon name="restaurant" size={28} />} onClose={onClose} wide className="brandsheet">
      <div className="brandsheet__grid">
        <div className="brandsheet__preview" style={brandVars(b) as CSSProperties} aria-label="Preview">
          <div className="brandprev__head">
            <Logo brand={b} size={88} title="Your logo" />
            <Wordmark brand={b} name={name} className="brandprev__name" />
          </div>
          <Shopfront className="brandprev__shop" name={name} logo={logoDataUrl(b)} small />
          <div className={`brandprev__menu brandprev__menu--${b.menu}`}>
            <Logo brand={b} size={32} /><Wordmark brand={b} name="Today's menu" />
          </div>
          <div className="brandprev__crew" aria-label="Staff in the house uniform">
            {people.map((p) => (
              <figure key={p.id}>
                <Avatar spec={avatarFor(p)} uniform={avatarUniform(b, p.role)} size={64} />
                <figcaption className="small">{p.role === "bar" ? "Bar" : p.role[0]!.toUpperCase() + p.role.slice(1)}</figcaption>
              </figure>
            ))}
          </div>
        </div>
        <div className="brandsheet__controls">
          <fieldset className="brandset">
            <legend>Logo shape</legend>
            <div className="brandset__row" role="radiogroup" aria-label="Logo shape">
              {SHAPES.map((s) => <Choice key={s} label={SHAPE_NAMES[s]} picked={b.shape === s} onPick={() => set({ shape: s })}><Logo brand={{ ...b, shape: s }} size={40} /></Choice>)}
            </div>
          </fieldset>
          <fieldset className="brandset">
            <legend>Picture</legend>
            <div className="brandset__row" role="radiogroup" aria-label="Logo picture">
              {MOTIFS.map((m) => <Choice key={m} label={MOTIF_NAMES[m]} picked={b.motif === m} onPick={() => set({ motif: m })}><Logo brand={{ ...b, motif: m }} size={40} /></Choice>)}
            </div>
          </fieldset>
          <fieldset className="brandset">
            <legend>Lettering</legend>
            <div className="brandset__row" role="radiogroup" aria-label="Lettering">
              {LETTERS.map((l) => <Choice key={l} label={LETTER_NAMES[l]} picked={b.letter === l} onPick={() => set({ letter: l })} wide><Wordmark brand={{ ...b, letter: l }} name={LETTER_NAMES[l]} /></Choice>)}
            </div>
          </fieldset>
          <fieldset className="brandset">
            <legend>House colour</legend>
            <Swatches label="House colour" value={b.primary} onPick={(primary) => set({ primary })} />
          </fieldset>
          <fieldset className="brandset">
            <legend>Accent colour</legend>
            <Swatches label="Accent colour" value={b.accent} onPick={(accent) => set({ accent })} />
          </fieldset>
          <fieldset className="brandset">
            <legend>Uniform</legend>
            <div className="brandset__row" role="radiogroup" aria-label="Uniform style">
              {UNIFORMS.map((u) => <Choice key={u} label={UNIFORM_NAMES[u]} picked={b.uniform === u} onPick={() => set({ uniform: u })} wide>{UNIFORM_NAMES[u]}</Choice>)}
            </div>
            <Swatches label="Uniform colour" value={b.uniformColour} onPick={(uniformColour) => set({ uniformColour })} />
          </fieldset>
          <fieldset className="brandset">
            <legend>Menu and sign style</legend>
            <div className="brandset__row" role="radiogroup" aria-label="Menu style">
              {MENUS.map((m) => <Choice key={m} label={MENU_NAMES[m]} picked={b.menu === m} onPick={() => set({ menu: m })} wide>{MENU_NAMES[m]}</Choice>)}
            </div>
          </fieldset>
        </div>
      </div>
      <div className="brandsheet__buttons">
        <button className="btn btn--tap" onClick={() => { const n = spins + 1; setSpins(n); setB(randomBrand(n + game.seed)); }}>Randomise</button>
        <span className="spacer" />
        <button className="btn btn--ghost btn--tap" onClick={onClose}>Cancel</button>
        <button className="btn btn--green btn--tap" onClick={() => onSave(b)}><Icon name="check" size={20} />Save brand</button>
      </div>
    </Dialog>
  );
}
