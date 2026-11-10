#!/usr/bin/env node
/**
 * Type-scale audit (round 5; round 11: 1024 as well as 1280, canvas text on every screen with a canvas, a private
 * preview on a free port, and a committed baseline). Walks every screen of the built game in Chromium
 * (scripts/lib/harness.mjs walkScreens) and counts rendered text smaller than MIN px:
 *   - DOM text: getComputedStyle(fontSize) of every visible text node's parent (SVG <text> × its on-screen scale);
 *   - canvas text: every fillText/strokeText call, font px × canvas transform × (CSS width / backing width), measured on
 *     every screen that shows a canvas (the cached layers are repainted first).
 * Screenshots (deviceScaleFactor 2) go to FP_AUDIT_SHOTS.
 *
 *   pnpm --filter @full-plate/game audit                 # builds if needed; exit 1 above scripts/probe-baseline.json
 *   pnpm --filter @full-plate/game audit -- --update-baseline
 *
 * Env: FP_AUDIT_TEXT=large (Settings › Text size › Bigger), FP_AUDIT_VIEWPORTS ("1280x800,1024x768,768x1024"; below
 *      1024 wide the context has touch, as an iPad does — R11-D; FP_AUDIT_VIEWPORT, one size, is D's spelling of it),
 *      FP_AUDIT_SHOTS (default scripts/.audit-shots), FP_AUDIT_MIN (13), FP_AUDIT_ONLY (comma list of screen names),
 *      and the harness's FP_URL / FP_PORT / FP_SKIP_GEN. Needs Playwright with Chromium.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canvasProbe, canvasSmall, checkBaseline, genSaves, HERE, loadPlaywright, settle, startPreview, walkScreens } from "./lib/harness.mjs";

const MIN = Number(process.env.FP_AUDIT_MIN ?? 13);
const SHOTS = process.env.FP_AUDIT_SHOTS ?? join(HERE, ".audit-shots");
const ONLY = process.env.FP_AUDIT_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const VIEWPORTS = (process.env.FP_AUDIT_VIEWPORTS ?? process.env.FP_AUDIT_VIEWPORT ?? "1280x800,1024x768,768x1024").split(",").map((v) => v.split("x").map(Number));
const TEXT = process.env.FP_AUDIT_TEXT === "large" ? "large" : "normal";
mkdirSync(SHOTS, { recursive: true });

/** Runs in the page: every visible DOM/SVG text below min px. */
function domSmall(min) {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const text = n.textContent.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,title")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest(".sr-only,.visually-hidden")) continue;
    let px = parseFloat(cs.fontSize);
    if (el instanceof SVGElement && el.ownerSVGElement) {
      const m = el.getScreenCTM();
      if (m) px *= Math.hypot(m.a, m.b);
    }
    if (px < min - 0.05) {
      const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "";
      out.push({ px: Math.round(px * 10) / 10, text: text.slice(0, 40), el: `${el.tagName.toLowerCase()}${cls ? "." + cls.trim().split(/\s+/).join(".") : ""}` });
    }
  }
  return out;
}

genSaves();
const { chromium } = loadPlaywright();
const preview = await startPreview();
const results = [];
const totals = {};
const errors = [];
const browser = await chromium.launch();
try {
  for (const [vw, vh] of VIEWPORTS) {
    const tag = `${vw}x${vh}-${TEXT}`;
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, hasTouch: vw < 1024 });
    await ctx.addInitScript(canvasProbe);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    const sum = { screens: 0, canvasScreens: 0, dom: 0, canvas: 0, errors: 0 };
    async function audit(name) {
      if (ONLY && !ONLY.includes(name)) return;
      await page.waitForTimeout(250);
      await settle(page);
      const cv = await canvasSmall(page, MIN);
      const dom = await page.evaluate(domSmall, MIN);
      const seen = new Set();
      const bad = [...dom, ...(cv?.small ?? [])].filter((o) => { const k = `${o.px}|${o.el}|${o.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
      // The app scrolls inside .screen; unroll it so the full-page shot shows everything (layout width is unchanged).
      const unroll = cv ? null : await page.addStyleTag({ content: ".app{height:auto!important}.screen{overflow:visible!important}" });
      await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`), fullPage: true });
      if (unroll) await unroll.evaluate((el) => el.remove());
      results.push({ tag, name, canvas: !!cv, bad });
      sum.screens++; if (cv) sum.canvasScreens++;
      sum.dom += dom.length; sum.canvas += cv?.small.length ?? 0;
      console.log(`${bad.length ? "✗" : "✓"} ${tag} ${name}${cv ? " (canvas)" : ""}${bad.length ? `: ${bad.length} below ${MIN}px` : ""}`);
      for (const o of bad.slice(0, 12)) console.log(`    ${o.px}px  ${o.el}  “${o.text}”`);
      if (bad.length > 12) console.log(`    … ${bad.length - 12} more`);
    }
    await walkScreens(page, { url: preview.url, text: TEXT, shot: audit, log: (s) => console.log(`${tag}${s}`), handsOnWait: 25000 });
    sum.errors = errs.length;
    errors.push(...errs.map((e) => `${tag}: ${e}`));
    totals[tag] = sum;
    await ctx.close();
  }
} finally {
  await browser.close();
  preview.stop();
}

const total = results.reduce((a, r) => a + r.bad.length, 0);
writeFileSync(join(SHOTS, "audit.json"), JSON.stringify({ min: MIN, total, totals, errors, results }, null, 1));
console.log(`\n${results.length} screens, ${total} text runs below ${MIN}px, ${errors.length} page errors. Shots: ${SHOTS}`);
for (const [tag, t] of Object.entries(totals)) console.log(`  ${tag}: ${t.screens} screens (${t.canvasScreens} with a canvas), DOM ${t.dom}, canvas ${t.canvas}, errors ${t.errors}`);
for (const e of errors) console.log("  page error:", e);
process.exit(ONLY ? (total || errors.length ? 1 : 0) : checkBaseline(`audit-${TEXT}`, totals));
