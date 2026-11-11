#!/usr/bin/env node
/**
 * Round 11 (red-team T1): the layout/touch probe, moved into the repo from the round-7 review's scratch script and made
 * honest. Every screen (scripts/lib/harness.mjs walkScreens) at 1280×800, 1024×768 and 768×1024 (iPad upright), with
 * touch emulation (`hasTouch`), in Normal and Bigger text. Per screen it counts:
 *
 *   targets<44   every tappable thing smaller than 44×44 CSS px: buttons, links, inputs, summary, ARIA button/tab/radio/
 *                checkbox/switch/link/menuitem/option/slider, focusable [tabindex], glossary terms (.term), and any
 *                element with a React click/pointer handler. Disabled controls count too (split out as `disabled`); a
 *                checkbox inside a <label> is measured by its label. targets<24 is the WCAG 2.5.8 floor.
 *   text<13      DOM/SVG text below 13 px; canvasText<13 every canvas label below 13 px on every screen with a canvas.
 *   contrast     text below 4.5:1 (3:1 large) against the colour actually behind it: the stack under the text's own box
 *                (elementsFromPoint), composited down to the first opaque layer; gradients are checked at every stop
 *                (worst counts). Text over a canvas, image or video is not judged but counted as `overCanvas`. On a
 *                running service/shift it is `contrastLive` (ticker lines vary run to run; baseline slack 3).
 *   overflow     sideways scroll (page or the .screen scroller), px.
 *   covered      a control whose centre is under something else (behind an open modal is fine); `underBar` when that
 *                something is a sticky/fixed bar (the action dock) — reachable by scrolling, so counted apart.
 *   (Round 13 — A, R12-F8: with a modal open — aria-modal, on its backdrop — only the top modal is measured: the page
 *   behind it, and anything inert or aria-hidden, counts for none of the above.)
 *   clipped      (Round 14 — E) a control cut off: its content spills out of it, or it runs past an overflow-hidden/clip
 *                ancestor (the menu's price stepper lost its price and + that way on a phone).
 *   notAtTop     (Round 14 — E) upright phone only: a screen or tab that didn't arrive at the top of the page (the walk
 *                scrolls each screen to its foot before moving on, so a kept scroll position shows).
 *   terms        each glossary term focused: its tip must show and must not widen the page.
 *   errors       page errors and console errors.
 *
 *   pnpm --filter @full-plate/game probe            # builds if needed, own preview on a free port, checks the baseline
 *   pnpm --filter @full-plate/game probe -- --update-baseline
 * Env: see harness.mjs; FP_PROBE_OUT (default scripts/.probe-out), FP_PROBE_VIEWPORTS ("1280x800,1024x768,768x1024,
 *      390x844m,844x390m"; an "m" suffix is a phone: isMobile + hasTouch at the iPhone's 3× scale, Round 12 — D),
 *      FP_PROBE_TEXT ("normal,large").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canvasProbe, canvasSmall, checkBaseline, contextFor, genSaves, HERE, loadPlaywright, parseViewports, settle, startPreview, walkScreens } from "./lib/harness.mjs";

const OUT = process.env.FP_PROBE_OUT ?? join(HERE, ".probe-out");
const VIEWPORTS = parseViewports(process.env.FP_PROBE_VIEWPORTS ?? "1280x800,1024x768,768x1024,390x844m,844x390m");
const TEXTS = (process.env.FP_PROBE_TEXT ?? "normal,large").split(",");
const MIN = 13;
mkdirSync(OUT, { recursive: true });

/** Runs in the page. */
function metrics(min) {
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const stops = (img) => [...img.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])).filter(Boolean);
  const blend = (base, l) => base.map((v, i) => v * (1 - l[3]) + l[i] * l[3]);
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const visible = (el) => !el.checkVisibility || el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });

  /** What is really behind a text box: a set of candidate colours, or a kind we can't judge. */
  function background(el, box) {
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    let chain = null;
    if (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight) {
      const stack = document.elementsFromPoint(cx, cy);
      const at = stack.indexOf(el);
      if (at >= 0) chain = stack.slice(at);
    }
    if (!chain) { chain = []; for (let e = el; e; e = e.parentElement) chain.push(e); }
    const layers = [];
    for (const e of chain) {
      if (e !== el && /^(CANVAS|IMG|VIDEO)$/.test(e.tagName)) return { kind: "canvas" };
      const cs = getComputedStyle(e);
      const img = cs.backgroundImage;
      if (img && img !== "none") {
        if (/url\(/.test(img)) return { kind: "image" };
        const s = stops(img);
        if (s.length) { layers.push({ stops: s }); if (s.every((c) => c[3] >= 1)) break; }
      }
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push({ stops: [c] }); if (c[3] >= 1) break; }
    }
    let bases = [[255, 255, 255]];
    for (const l of layers.reverse()) {
      const next = [];
      for (const b of bases) for (const s of l.stops) next.push(blend(b, s));
      bases = next.slice(0, 24);
    }
    return { kind: "colour", bases };
  }

  // Round 13 (A, R12-F8): with a modal open (a dialog with aria-modal, on its backdrop) only the top modal is on screen
  // for the player — the page behind it is dimmed, can't be reached, and was measured on its own screen. Count neither
  // its targets, its text nor its terms; nor anything inert or aria-hidden.
  const modals = [...document.querySelectorAll('[aria-modal="true"], .modal-back')].filter((m) => visible(m));
  const top = modals.length ? (modals.at(-1).closest(".modal-back") ?? modals.at(-1)) : null;
  const behind = (el) => (!!top && !top.contains(el)) || !!el.closest('[inert], [aria-hidden="true"]');

  const small = [], lowContrast = [], overCanvas = [];
  const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const text = n.textContent.replace(/\s+/g, " ").trim(); if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,title,.sr-only,.visually-hidden")) continue;
    if (!visible(el) || behind(el)) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const box = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0); if (!box) continue;
    const cs = getComputedStyle(el);
    let px = parseFloat(cs.fontSize);
    if (el instanceof SVGElement) { const m = el.getScreenCTM(); if (m) px *= Math.hypot(m.a, m.b); if (px < min - 0.05) small.push(`${px.toFixed(1)} ${text.slice(0, 30)}`); continue; }
    if (px < min - 0.05) small.push(`${px.toFixed(1)} ${text.slice(0, 30)}`);
    if (el.closest("button:disabled,[aria-disabled=true],input:disabled")) continue; // WCAG 1.4.3: inactive controls are exempt
    const fg = parse(cs.color); if (!fg) continue;
    const bg = background(el, box);
    const k = text.slice(0, 30);
    if (bg.kind !== "colour") { if (!seen.has("c" + k)) { seen.add("c" + k); overCanvas.push(`${bg.kind} ${k}`); } continue; }
    const a = fg[3] * opacityOf(el);
    let worst = Infinity;
    for (const b of bg.bases) {
      const f = fg.slice(0, 3).map((v, i) => v * a + b[i] * (1 - a));
      const L1 = lum(f), L2 = lum(b);
      worst = Math.min(worst, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
    }
    const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    if (worst < (large ? 3 : 4.5) && !seen.has(k)) { seen.add(k); lowContrast.push(`${worst.toFixed(2)} ${k}`); }
  }

  // Tappable things.
  const SEL = "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=link], [role=menuitem], [role=option], [role=slider], .term, [tabindex]:not([tabindex='-1']), [onclick]";
  const NATIVE = "button, a[href], input, select, textarea, summary, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=link], [role=menuitem], [role=option], [role=slider], .term";
  const set = new Set(document.querySelectorAll(SEL));
  const handlerOnly = new Set();
  for (const el of document.body.querySelectorAll("*")) {
    const key = Object.keys(el).find((x) => x.startsWith("__reactProps$"));
    const p = key && el[key];
    if (p && (p.onClick || p.onPointerDown || p.onPointerUp || p.onMouseDown || p.onTouchStart) && !set.has(el)) { set.add(el); handlerOnly.add(el); }
  }
  const modal = document.querySelector(".modal-back, [role=dialog], [role=alertdialog]");
  const smallTargets = [], covered = [], underBar = [], kinds = { control: 0, term: 0, disabled: 0, switch: 0, handler: 0 };
  let tiny = 0;
  const measured = new Set();
  for (const el of set) {
    if (!visible(el) || behind(el)) continue;
    // a click-away backdrop or a wrapper around real controls isn't a target of its own
    if (handlerOnly.has(el) && (el.querySelector(NATIVE) || el.matches(".modal-back"))) continue;
    if (el.tagName === "CANVAS") continue; // the floor canvas is the whole play area
    let t = el;
    if (el.matches("input[type=checkbox], input[type=radio]") && el.closest("label")) t = el.closest("label");
    if (measured.has(t)) continue; measured.add(t);
    let r = t.getBoundingClientRect(); if (!r.width || !r.height) continue;
    // Round 13 (E): a glossary word's target is its invisible hit area (theme.css `.term::before`, lib/termTap.ts).
    if (t.matches(".term")) {
      const b = getComputedStyle(t, "::before");
      if (b.content !== "none" && b.position === "absolute") {
        const n = (v) => Math.min(0, parseFloat(v) || 0);
        r = { left: r.left + n(b.left), right: r.right - n(b.right), top: r.top + n(b.top), bottom: r.bottom - n(b.bottom) };
        r.width = r.right - r.left; r.height = r.bottom - r.top;
      }
    }
    // a visually hidden native input (the save-file picker) is driven by a visible button, which is measured instead
    if (t.tagName === "INPUT" && r.width <= 2 && r.height <= 2) continue;
    if (r.width * r.height > innerWidth * innerHeight * 0.5) continue;
    const disabled = el.disabled || el.getAttribute("aria-disabled") === "true";
    const kind = disabled ? "disabled" : el.closest(".term") ? "term" : el.matches("input[type=checkbox], input[type=radio], [role=checkbox], [role=switch], .switch") ? "switch" : handlerOnly.has(el) ? "handler" : "control";
    const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 36);
    if (r.height < 43.5 || r.width < 43.5) { smallTargets.push(`${Math.round(r.width)}×${Math.round(r.height)} ${kind} ${label}`); kinds[kind]++; if (r.height < 23.5 || r.width < 23.5) tiny++; }
    if (disabled) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
    if (modal && !el.closest(".modal, [role=dialog], [role=alertdialog], .sheet")) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !t.contains(hit) && !hit.contains(t)) {
      const what = `${label} ← ${(typeof hit.className === "string" && hit.className ? hit.className : hit.tagName).slice(0, 40)}`;
      // Under a sticky/fixed bar (the action dock) at this scroll position: reachable by scrolling, counted apart.
      let bar = false;
      for (let e = hit; e && e !== document.body; e = e.parentElement) { const pos = getComputedStyle(e).position; if (pos === "sticky" || pos === "fixed") { bar = true; break; } }
      (bar ? underBar : covered).push(what);
    }
  }
  // Round 14 (E, U3): a control cut off — a button or field whose own content spills out of it (scrollWidth >
  // clientWidth), or whose box runs past an overflow-hidden/clip ancestor (the price stepper's + was clipped by the
  // stepper itself). A scroller (overflow auto/scroll) isn't clipping: what's past its edge is reachable.
  const clipped = [];
  for (const el of document.querySelectorAll("button, input:not([type=checkbox]):not([type=radio]), select, [role=button], [role=tab]")) {
    if (!visible(el) || behind(el)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    const label = (el.getAttribute("aria-label") || el.textContent || el.tagName).replace(/\s+/g, " ").trim().slice(0, 36);
    if (el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") { clipped.push(`spills ${label}`); continue; }
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const hx = cs.overflowX === "hidden" || cs.overflowX === "clip", hy = cs.overflowY === "hidden" || cs.overflowY === "clip";
      if (!hx && !hy) continue;
      if (a.matches(".worldmap__frame, .zoomframe, .service__floor, [data-pan]")) break; // a map you pan: off its edge is reachable
      const ar = a.getBoundingClientRect();
      if ((hx && (r.left < ar.left - 1 || r.right > ar.right + 1)) || (hy && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1))) {
        clipped.push(`${label} ← ${(typeof a.className === "string" && a.className ? a.className : a.tagName).slice(0, 40)}`); break;
      }
    }
  }
  const sw = document.documentElement.scrollWidth, vw = innerWidth;
  const sc = document.querySelector(".screen"); const inner = sc ? sc.scrollWidth - sc.clientWidth : 0;
  return { small, lowContrast, overCanvas, smallTargets, tiny, kinds, covered, underBar, clipped, hOverflow: Math.max(sw > vw + 1 ? sw - vw : 0, inner > 1 ? inner : 0) };
}

/** Runs in the page: focus every Term in turn; its tip must show, and showing it must not widen the page. */
function termCheck() {
  const out = { terms: 0, hidden: [], widen: [] };
  const sc = document.querySelector(".screen");
  const overOf = () => Math.max(document.documentElement.scrollWidth - innerWidth, sc ? sc.scrollWidth - sc.clientWidth : 0);
  const base = overOf(); // a screen that already scrolls sideways (portrait) isn't widened by its terms
  // Round 13 (A, R12-F8): terms behind an open modal aren't reachable (see metrics)
  const modals = [...document.querySelectorAll('[aria-modal="true"], .modal-back')].filter((m) => m.getBoundingClientRect().width > 0);
  const top = modals.length ? (modals.at(-1).closest(".modal-back") ?? modals.at(-1)) : null;
  for (const t of document.querySelectorAll(".term[tabindex]")) {
    if ((top && !top.contains(t)) || t.closest('[inert], [aria-hidden="true"]')) continue;
    const r = t.getBoundingClientRect(); if (!r.width) continue;
    // Round 11b: a term inside a closed <details> (the Evening's "Where the money went": VAT) is not on screen and
    // can't take focus until the player opens it.
    if (t.closest("details:not([open])")) continue;
    out.terms++;
    t.focus();
    const tip = t.querySelector(":scope > .term__tip");
    if (!tip || getComputedStyle(tip).display === "none" || getComputedStyle(tip).visibility === "hidden") out.hidden.push(t.textContent.slice(0, 30));
    const over = overOf() - base;
    if (over > 1) out.widen.push(`${over}px ${t.textContent.slice(0, 24)}`);
    t.blur();
  }
  return out;
}

genSaves();
const { chromium } = loadPlaywright();
const preview = await startPreview();
const report = {};
const totals = {};
const browser = await chromium.launch();
try {
  for (const text of TEXTS) for (const vp of VIEWPORTS) {
    const [vw, vh] = [vp.width, vp.height];
    const tag = `${vw}x${vh}-${text}`;
    const ctx = await browser.newContext(contextFor(vp, { deviceScaleFactor: 1, hasTouch: true }));
    await ctx.addInitScript(canvasProbe);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    const sum = { screens: 0, "targets<44": 0, "targets<24": 0, term: 0, disabled: 0, switch: 0, handler: 0, "text<13": 0, "canvasText<13": 0, contrast: 0, contrastLive: 0, overCanvas: 0, overflowScreens: 0, covered: 0, underBar: 0, clipped: 0, notAtTop: 0, termsHidden: 0, termsWiden: 0, errors: 0 };
    async function shot(name, opts = {}) {
      const { terms = true, live = false } = opts;
      await page.waitForTimeout(250);
      await settle(page);
      await page.screenshot({ path: join(OUT, `${tag}-${name}.png`) });
      const m = await page.evaluate(metrics, MIN);
      const cv = await canvasSmall(page, MIN);
      m.canvasSmall = cv?.small ?? [];
      // Round 14 (E, U1): on an upright phone every screen and tab arrives at the top (the walk scrolls each screen to
      // its foot before moving on: lib/harness.mjs). A screen with a sheet or dialog open, or one the walk itself
      // scrolled (`scrolled: true`), isn't an arrival.
      m.scrollY = await page.evaluate(() => Math.round(Math.max(scrollY, document.querySelector(".screen")?.scrollTop ?? 0)));
      m.notAtTop = vp.phone && vw < vh && !opts.scrolled && !(await page.evaluate(() => !!document.querySelector('[aria-modal="true"], .modal-back'))) && m.scrollY > 0;
      if (terms) { const y = await page.evaluate(() => document.querySelector(".screen")?.scrollTop ?? 0); m.terms = await page.evaluate(termCheck); await page.evaluate((v) => { const s = document.querySelector(".screen"); if (s) s.scrollTop = v; }, y); }
      report[`${tag}|${name}`] = m;
      sum.screens++; sum["targets<44"] += m.smallTargets.length; sum["targets<24"] += m.tiny;
      for (const k of ["term", "disabled", "switch", "handler"]) sum[k] += m.kinds[k];
      sum["text<13"] += m.small.length; sum["canvasText<13"] += m.canvasSmall.length; if (live) sum.contrastLive += m.lowContrast.length; else sum.contrast += m.lowContrast.length; sum.overCanvas += m.overCanvas.length;
      sum.overflowScreens += m.hOverflow > 0 ? 1 : 0; sum.covered += m.covered.length; sum.underBar += m.underBar.length; sum.clipped += m.clipped.length; sum.notAtTop += m.notAtTop ? 1 : 0;
      sum.termsHidden += m.terms?.hidden.length ?? 0; sum.termsWiden += m.terms?.widen.length ?? 0;
      console.log(`${tag} ${name}: tgt<44 ${m.smallTargets.length} (term ${m.kinds.term}, disabled ${m.kinds.disabled}, switch ${m.kinds.switch}, handler ${m.kinds.handler}) <24 ${m.tiny} | txt<13 ${m.small.length} canvas<13 ${cv ? m.canvasSmall.length : "-"} | contrast ${m.lowContrast.length} over-canvas ${m.overCanvas.length} | overflow ${m.hOverflow} covered ${m.covered.length} under-bar ${m.underBar.length} clipped ${m.clipped.length}${m.notAtTop ? ` NOT-AT-TOP ${m.scrollY}` : ""}${m.terms ? ` | terms ${m.terms.terms}/${m.terms.hidden.length}h/${m.terms.widen.length}w` : ""}`);
    }
    await walkScreens(page, { url: preview.url, text, shot, log: (s) => console.log(`${tag}${s}`) });
    sum.errors = errors.length;
    report[`${tag}|errors`] = errors;
    totals[tag] = sum;
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.stop();
}
writeFileSync(join(OUT, "probe.json"), JSON.stringify({ totals, report }, null, 1));
const cols = Object.keys(Object.values(totals)[0] ?? {});
console.log(`\n| run | ${cols.join(" | ")} |\n|---|${cols.map(() => "---").join("|")}|`);
for (const [tag, s] of Object.entries(totals)) console.log(`| ${tag} | ${cols.map((c) => s[c]).join(" | ")} |`);
console.log(`\nDetail: ${join(OUT, "probe.json")}`);
// Live screens (a running service/shift) show whichever ticker lines that moment has (older lines fade by design),
// so their contrast count moves by a line or two between runs: checked with a slack of 3. Round 13 (A): the same goes
// for canvas labels on a phone's live floor ("13 waiting", the guests' names, which tickets are up): measured where
// they land since R13, they move by ±12 run to run (117–141 on 390×844 across four runs): a slack of 20.
process.exit(checkBaseline("probe", totals, { contrastLive: 3, "canvasText<13": 20 }));
