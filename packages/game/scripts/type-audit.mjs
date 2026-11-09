#!/usr/bin/env node
/**
 * Type-scale audit (round 5). Walks every screen of the built game in Chromium at 1280×800 and fails if any rendered
 * text is smaller than MIN px:
 *   - DOM text: getComputedStyle(fontSize) of every visible text node's parent (SVG <text> × its on-screen scale);
 *   - canvas text: every fillText/strokeText call, font px × canvas transform × (CSS width / backing width).
 * Screenshots (deviceScaleFactor 2) go to FP_AUDIT_SHOTS.
 *
 *   pnpm --filter @full-plate/game build
 *   node packages/game/scripts/type-audit.mjs            # from the repo root, or `node scripts/type-audit.mjs` here
 *
 * Env: FP_AUDIT_URL (default: starts `vite preview` on :4173 itself), FP_AUDIT_SHOTS (default scripts/.audit-shots),
 *      FP_AUDIT_MIN (13), FP_AUDIT_ONLY (comma list of screen names), FP_AUDIT_SKIP_GEN=1 (reuse scripts/.audit-saves).
 * Needs Playwright with Chromium on the machine (`require("playwright")`). Exit code 1 when anything is too small.
 */
import { createRequire } from "node:module";
import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const MIN = Number(process.env.FP_AUDIT_MIN ?? 13);
const SHOTS = process.env.FP_AUDIT_SHOTS ?? join(HERE, ".audit-shots");
const SAVES = process.env.FP_AUDIT_SAVES ?? join(HERE, ".audit-saves");
const ONLY = process.env.FP_AUDIT_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
mkdirSync(SHOTS, { recursive: true });

if (!process.env.FP_AUDIT_SKIP_GEN) {
  execSync("npx vitest run --config scripts/vitest.audit.config.ts", { cwd: PKG, stdio: "inherit", env: { ...process.env, FP_AUDIT_SAVES: SAVES } });
}

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }
let preview;
let URL = process.env.FP_AUDIT_URL;
if (!URL) {
  URL = "http://localhost:4173/";
  if (!(await reachable(URL))) {
    preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { cwd: PKG, stdio: "ignore" });
    for (let i = 0; i < 60 && !(await reachable(URL)); i++) await new Promise((r) => setTimeout(r, 250));
  }
}

/** Runs in the page before any app code: records the effective CSS px of every canvas text draw. */
function canvasProbe() {
  window.__canvasText = [];
  for (const C of [CanvasRenderingContext2D]) {
    for (const fn of ["fillText", "strokeText"]) {
      const orig = C.prototype[fn];
      C.prototype[fn] = function (text, ...rest) {
        try {
          const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
          const t = this.getTransform();
          const el = this.canvas;
          const css = el.getBoundingClientRect().width / (el.width || 1);
          const px = m ? Number(m[1]) * Math.hypot(t.a, t.b) * css : 0;
          if (String(text).trim() && px > 0 && el.isConnected) window.__canvasText.push([Math.round(px * 10) / 10, String(text).slice(0, 30)]);
          if (window.__canvasText.length > 20000) window.__canvasText.splice(0, 10000);
        } catch { /* never break the game */ }
        return orig.call(this, text, ...rest);
      };
    }
  }
}

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

const results = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.addInitScript(canvasProbe);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const save = (name) => readFileSync(join(SAVES, `${name}.json`), "utf8");
async function boot({ owner, career, speed = 1 } = {}) {
  await page.goto(URL);
  await page.evaluate(([o, c, sp]) => {
    localStorage.clear();
    localStorage.setItem("full-plate:settings:v1", JSON.stringify({ autoPause: false, defaultSpeed: sp }));
    if (o) localStorage.setItem("full-plate:save:v1", o);
    if (c) localStorage.setItem("full-plate:career:v1", c);
  }, [owner ? save(owner) : null, career ?? null, speed]);
  await page.reload();
  await page.waitForTimeout(300);
}
async function cont() { await page.getByRole("button", { name: "Continue", exact: true }).click(); await page.waitForTimeout(700); }
const tab = async (name) => { await page.getByRole("tab", { name }).first().click(); await page.waitForTimeout(400); };

async function audit(name, { canvas = false } = {}) {
  if (ONLY && !ONLY.includes(name)) return;
  await page.waitForTimeout(250);
  const dom = await page.evaluate(domSmall, MIN);
  let canvasSmall = [];
  if (canvas) {
    const drawn = await page.evaluate(() => window.__canvasText.splice(0));
    const seen = new Map();
    for (const [px, text] of drawn) if (px < MIN - 0.05) { const k = `${px}|${text}`; if (!seen.has(k)) seen.set(k, { px, text, el: "canvas" }); }
    canvasSmall = [...seen.values()];
  }
  const seen = new Set();
  const bad = [...dom, ...canvasSmall].filter((o) => { const k = `${o.px}|${o.el}|${o.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
  results.push({ name, bad });
  console.log(`${bad.length ? "✗" : "✓"} ${name}${bad.length ? `: ${bad.length} below ${MIN}px` : ""}`);
  for (const o of bad.slice(0, 12)) console.log(`    ${o.px}px  ${o.el}  “${o.text}”`);
  if (bad.length > 12) console.log(`    … ${bad.length - 12} more`);
}
const resetCanvas = () => page.evaluate(() => { window.__canvasText = []; });

try {
  // Title, start picker, lease screen
  await boot({ owner: "owner-planning" });
  await audit("01-title");
  await page.getByRole("button", { name: "New game" }).click(); await page.waitForTimeout(300);
  await audit("02-start-picker");
  await page.getByRole("radio", { name: /^Apprentice chef/ }).click(); await page.waitForTimeout(200);
  await audit("03-start-picker-career");
  await page.getByRole("radio", { name: /^Owner/ }).click(); await page.waitForTimeout(200);
  await page.locator("button.btn--xl.btn--primary").click(); await page.waitForTimeout(400);
  await audit("04-new-game-lease");

  // Owner planning tabs, help, settings
  await boot({ owner: "owner-planning" }); await cont();
  await audit("10-planning-menu");
  await tab(/^Staff/); await audit("11-planning-staff");
  await tab(/^Stock/); await audit("12-planning-stock");
  await tab(/^Restaurant/); await audit("13-planning-restaurant");
  await page.getByRole("button", { name: /What do I do/ }).click(); await page.waitForTimeout(200);
  await audit("14-planning-help");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).click(); await page.waitForTimeout(200);
  await audit("15-settings");
  await page.getByRole("button", { name: "Settings" }).click();

  // Owner service (canvas)
  await tab(/^Menu/);
  await resetCanvas();
  await page.locator(".openbar button.btn--xl.btn--primary, button.btn--xl.btn--primary").last().click();
  const anyway = page.getByRole("button", { name: "Open anyway" });
  if (await anyway.count()) await anyway.click();
  await page.waitForTimeout(6000);
  await audit("20-service", { canvas: true });

  // Evening, fork, game over, win
  await boot({ owner: "owner-evening" }); await cont(); await audit("30-evening");
  await boot({ owner: "fork-evening" }); await cont(); await audit("31-fork-card");
  await boot({ career: save("gameover") });
  await page.getByRole("button", { name: /Continue career/ }).click(); await page.waitForTimeout(700);
  await audit("32-game-over");
  await boot({ owner: "win" }); await cont(); await audit("33-win");

  // Empire and its side panels
  await boot({ owner: "empire" }); await cont();
  await tab(/Empire/);
  await audit("40-empire");
  const panels = await page.locator(".empire aside [role=tab]").allInnerTexts();
  for (const [i, p] of panels.entries()) {
    await page.locator(".empire aside [role=tab]").nth(i).click(); await page.waitForTimeout(300);
    await audit(`4${i + 1}-empire-${p.trim().toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`);
  }

  // Stars
  await boot({ owner: "stars" }); await cont();
  await tab(/Stars/);
  await audit("50-stars");

  // Career: my shift → watch → hands-on → evening
  await boot({ speed: 2 });
  await page.getByRole("button", { name: "New game" }).click();
  await page.getByRole("radio", { name: /^Apprentice chef/ }).click();
  await page.getByRole("radio", { name: /^Cosy/ }).click();
  await page.getByRole("textbox").first().fill("Mia");
  await page.getByRole("button", { name: /Start as apprentice chef/ }).click();
  await page.waitForTimeout(800);
  await audit("60-my-shift");
  for (let i = 0; i < 5 && !(await page.getByRole("button", { name: /Start my shift/ }).count()); i++) {
    await page.getByRole("button", { name: /Watch today|Next day/ }).first().click(); await page.waitForTimeout(600);
    const skip = page.getByRole("button", { name: /Skip to end of shift/ });
    if (await skip.count()) { await skip.click(); await page.waitForTimeout(600); }
    const next = page.getByRole("button", { name: /Next day/ });
    if (await next.count()) { await next.first().click(); await page.waitForTimeout(800); }
  }
  await resetCanvas();
  await page.getByRole("button", { name: /Start my shift/ }).click(); await page.waitForTimeout(3000);
  await audit("61-watch-shift", { canvas: true });
  const play = page.getByRole("button", { name: /Play my shift/ });
  if (await play.count()) {
    await resetCanvas();
    await play.click(); await page.waitForTimeout(25000);
    await audit("62-hands-on", { canvas: true });
    await page.getByRole("button", { name: /Skip to end of shift/ }).first().click(); await page.waitForTimeout(1500);
    await audit("63-shift-scorecard");
    const cont2 = page.getByRole("button", { name: /Continue|See my evening|Done|Close/ });
    if (await cont2.count()) { await cont2.first().click(); await page.waitForTimeout(800); }
  } else {
    await page.getByRole("button", { name: /Skip to end of shift/ }).first().click(); await page.waitForTimeout(1500);
  }
  await audit("64-career-evening");
} finally {
  await browser.close();
  preview?.kill();
}

const total = results.reduce((a, r) => a + r.bad.length, 0);
writeFileSync(join(SHOTS, "audit.json"), JSON.stringify({ min: MIN, total, errors, results }, null, 1));
console.log(`\n${results.length} screens, ${total} text runs below ${MIN}px, ${errors.length} page errors. Shots: ${SHOTS}`);
for (const e of errors) console.log("  page error:", e);
process.exit(total || errors.length ? 1 : 0);
