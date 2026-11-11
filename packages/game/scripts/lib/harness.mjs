/**
 * Round 11 (red-team T1): what the probe (scripts/probe.mjs) and the type audit (scripts/type-audit.mjs) share —
 * Playwright, a private `vite preview` on a free port, the audit saves, one walk over every screen, and the committed
 * baseline (scripts/probe-baseline.json) that turns their counts into a pass/fail.
 *
 * Env (both scripts):
 *   FP_URL          use an already running build instead of starting a preview
 *   FP_PORT         the preview's port (default: a free one the OS picks)
 *   FP_SKIP_GEN=1   reuse scripts/.audit-saves instead of regenerating them with the real sim
 *   FP_SKIP_BUILD=1 don't build when dist/ is missing
 *   FP_DIST         serve this built folder instead of dist/ (Round 13 — A: perf-floor.mjs compares two builds)
 *   PLAYWRIGHT_PATH a node_modules folder holding `playwright` when the repo doesn't (default search: the package,
 *                   then /opt/npm-tools/node_modules)
 * Flags: --update-baseline (write today's counts as the new baseline), --no-baseline (report only, exit 0).
 */
import { createRequire } from "node:module";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PKG = join(HERE, "..");
export const SAVES = process.env.FP_AUDIT_SAVES ?? join(HERE, ".audit-saves");
export const BASELINE = join(HERE, "probe-baseline.json");

export function loadPlaywright() {
  const roots = [PKG + "/", process.env.PLAYWRIGHT_PATH, "/opt/npm-tools/node_modules/"].filter(Boolean);
  for (const root of roots) {
    try { return createRequire(root.endsWith("/") ? root : root + "/")("playwright"); } catch { /* next */ }
  }
  console.error("Playwright not found. Install it (npm i -D playwright && npx playwright install chromium) or set PLAYWRIGHT_PATH.");
  process.exit(2);
}

/** Builds the audit saves (scripts/audit-saves.gen.ts through vitest, so workspace TS resolves as in the tests). */
export function genSaves() {
  if (process.env.FP_SKIP_GEN && existsSync(join(SAVES, "owner-planning.json"))) return;
  execSync("npx vitest run --config scripts/vitest.audit.config.ts", { cwd: PKG, stdio: "inherit", env: { ...process.env, FP_AUDIT_SAVES: SAVES } });
}

/**
 * Round 12 (D): "1280x800,390x844m" → [{ width, height, phone }]. An "m" suffix is a phone: Playwright's iPhone 14
 * descriptor (isMobile, hasTouch, 3× scale, Mobile Safari's user agent) at that CSS size — 390×844 is the whole
 * screen upright, 844×390 sideways.
 */
export function parseViewports(list) {
  return list.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const phone = /m$/i.test(s);
    const [width, height] = s.replace(/m$/i, "").split("x").map(Number);
    return { width, height, phone };
  });
}
export const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
/** Browser-context options for one viewport: a phone gets the iPhone's mobile flags; others get `desktop` (scale, touch). */
export function contextFor(vp, desktop = {}) {
  const viewport = { width: vp.width, height: vp.height };
  if (vp.phone) return { viewport, screen: viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA };
  return { viewport, ...desktop };
}

async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }
function freePort() {
  return new Promise((res, rej) => { const s = createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}

/** A private preview of dist/ (built first if missing), on 127.0.0.1 only. Returns { url, stop }. */
export async function startPreview() {
  if (process.env.FP_URL) return { url: process.env.FP_URL, stop() {} };
  const dist = process.env.FP_DIST;
  if (!dist && !existsSync(join(PKG, "dist/index.html"))) {
    if (process.env.FP_SKIP_BUILD) { console.error("dist/ is missing: run `pnpm --filter @full-plate/game build`."); process.exit(2); }
    execSync("pnpm build", { cwd: PKG, stdio: "inherit" });
  }
  const port = Number(process.env.FP_PORT) || (await freePort());
  const url = `http://127.0.0.1:${port}/`;
  const vite = join(PKG, "node_modules/.bin/vite");
  const args = ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort", ...(dist ? ["--outDir", dist] : [])];
  const proc = spawn(existsSync(vite) ? vite : "npx", existsSync(vite) ? args : ["vite", ...args], { cwd: PKG, stdio: "ignore" });
  for (let i = 0; i < 120 && !(await reachable(url)); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await reachable(url))) { proc.kill(); console.error(`preview did not start on ${url}`); process.exit(2); }
  return { url, stop: () => proc.kill() };
}

/**
 * Runs in the page before any app code: records the effective CSS px of every canvas text draw.
 *
 * Text drawn straight onto a canvas on the page: font px × the context's scale × the canvas's CSS-to-backing ratio.
 * Round 13 (A): text drawn into an offscreen surface (the cached scene layer, the floor's stamps) is measured where
 * it lands: it is held against its surface (and the ImageBitmap that surface becomes), and when that is drawn onto a
 * page canvas — directly or via another offscreen surface — each label is recorded at font px × every scale on the
 * way (the surface's own transform, the blit's dw/sw, the target's transform, the page canvas's CSS ratio). Before,
 * offscreen text was assumed to be blitted 1:1 at the page's dpr, which missed a floor canvas the page shrinks (a
 * phone) and anything drawn into a stamp.
 */
export function canvasProbe() {
  window.__canvasText = [];
  const pending = new WeakMap(); // offscreen surface / ImageBitmap → [[device px on that surface, text]]
  const push = (px, text) => {
    if (!(px > 0)) return; // a canvas that isn't displayed (0 px wide) shows nothing
    window.__canvasText.push([Math.round(px * 10) / 10, String(text).slice(0, 30)]);
    if (window.__canvasText.length > 20000) window.__canvasText.splice(0, 10000);
  };
  const onPage = (el) => typeof el?.isConnected === "boolean" && el.isConnected;
  const cssOf = (el) => el.getBoundingClientRect().width / (el.width || 1);
  const scaleOf = (ctx) => { const t = ctx.getTransform(); return Math.hypot(t.a, t.b); };
  const hold = (surface, list) => {
    const l = pending.get(surface) ?? [];
    for (const e of list) if (l.length < 400) l.push(e);
    pending.set(surface, l);
  };
  const Ctxs = [CanvasRenderingContext2D, ...(typeof OffscreenCanvasRenderingContext2D !== "undefined" ? [OffscreenCanvasRenderingContext2D] : [])];
  for (const C of Ctxs) {
    for (const fn of ["fillText", "strokeText"]) {
      const orig = C.prototype[fn];
      C.prototype[fn] = function (text, ...rest) {
        try {
          const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
          const dev = m ? Number(m[1]) * scaleOf(this) : 0; // device px on this context's surface
          if (String(text).trim() && dev > 0) {
            if (onPage(this.canvas)) push(dev * cssOf(this.canvas), text);
            else hold(this.canvas, [[dev, String(text)]]);
          }
        } catch { /* never break the game */ }
        return orig.call(this, text, ...rest);
      };
    }
    const draw = C.prototype.drawImage;
    C.prototype.drawImage = function (src, ...a) {
      try {
        const list = pending.get(src);
        if (list?.length) {
          const sw = a.length >= 8 ? a[2] : src.width, dw = a.length >= 8 ? a[6] : a.length >= 4 ? a[2] : src.width;
          const k = (dw / (sw || 1)) * scaleOf(this);
          if (onPage(this.canvas)) { const css = cssOf(this.canvas); for (const [px, t] of list) push(px * k * css, t); }
          else hold(this.canvas, list.map(([px, t]) => [px * k, t]));
        }
      } catch { /* never break the game */ }
      return draw.call(this, src, ...a);
    };
    const clear = C.prototype.clearRect;
    C.prototype.clearRect = function (x, y, w, h) {
      try { if (!onPage(this.canvas) && x <= 0 && y <= 0 && w >= this.canvas.width && h >= this.canvas.height) pending.delete(this.canvas); } catch { /* ignore */ }
      return clear.call(this, x, y, w, h);
    };
  }
  if (typeof OffscreenCanvas !== "undefined" && OffscreenCanvas.prototype.transferToImageBitmap) {
    const t = OffscreenCanvas.prototype.transferToImageBitmap;
    OffscreenCanvas.prototype.transferToImageBitmap = function () {
      const bmp = t.call(this);
      try { const l = pending.get(this); if (l) { pending.set(bmp, l); pending.delete(this); } } catch { /* ignore */ }
      return bmp;
    };
  }
}

/**
 * Lets every finite CSS animation/transition on the page finish (fades, slides, toasts arriving), so a screen is
 * measured as it settles rather than mid-fade at whatever moment a loaded machine happens to sample it. Infinite
 * ones (pulses, the clock's blink) are left running.
 */
export async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming?.();
      if (t && t.iterations !== Infinity && a.playState !== "finished") try { a.finish(); } catch { /* ignore */ }
    }
  });
  await page.waitForTimeout(50);
}

/**
 * Measures canvas text on the current screen if it has a visible canvas: a 1 px resize and back repaints the cached
 * layers so their labels are counted too. Returns the deduplicated runs below `min` px (or null: no canvas here).
 */
export async function canvasSmall(page, min) {
  const has = await page.evaluate(() => [...document.querySelectorAll("canvas")].some((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));
  if (!has) { await page.evaluate(() => { window.__canvasText = []; }); return null; }
  const vp = page.viewportSize();
  // R11-D: nudge the height, not the width: 1023 px wide crosses the portrait breakpoint (NARROW_QUERY), and any width
  // change leaves the measured layers one blit off scale.
  await page.setViewportSize({ width: vp.width, height: vp.height - 1 }); await page.waitForTimeout(150);
  await page.setViewportSize(vp); await page.waitForTimeout(250);
  const drawn = await page.evaluate(() => window.__canvasText.splice(0));
  const seen = new Map();
  for (const [px, text] of drawn) if (px < min - 0.05) { const k = `${px}|${text}`; if (!seen.has(k)) seen.set(k, { px, text, el: "canvas" }); }
  return { drawn: drawn.length, small: [...seen.values()] };
}

/**
 * One walk over every screen the game has (title → owner → evening/fork/game over/win → Empire → board → Stars →
 * career). `shot(name, opts)` is called on each (`opts.live`: a running service or shift, whose exact frame depends on
 * how fast the machine is); a step that fails is logged and the walk goes on (the count of screens
 * reached is part of the baseline, so a broken step can't pass as "fewer problems").
 */
export async function walkScreens(page, { url, text, shot, log, handsOnWait = 3000 }) {
  const save = (n) => readFileSync(join(SAVES, `${n}.json`), "utf8");
  async function boot({ owner, career, speed = 1 } = {}) {
    await page.goto(url);
    await page.evaluate(([o, c, sp, t]) => {
      localStorage.clear();
      // Round 11 (D): speedPicked keeps Cosy saves at the walk's speed (Cosy otherwise starts at 4×); the dev flag turns
      // the playtest switches (?autopilot=, ?perf=) on in this production build.
      localStorage.setItem("full-plate:settings:v1", JSON.stringify({ autoPause: false, defaultSpeed: sp, speedPicked: true, textSize: t }));
      localStorage.setItem("full-plate:dev", "1");
      if (o) localStorage.setItem("full-plate:save:v1", o);
      if (c) localStorage.setItem("full-plate:career:v1", c);
    }, [owner ? save(owner) : null, career ?? null, speed, text]);
    await page.reload(); await page.waitForTimeout(350);
  }
  const cont = async () => { await page.getByRole("button", { name: /^Continue/ }).first().click(); await page.waitForTimeout(700); };
  const tab = async (name) => { await page.getByRole("tab", { name }).first().click(); await page.waitForTimeout(400); };
  // FP_WALK_DEBUG=1 prints the whole error (Playwright's call log says which element got in the way).
  const step = async (label, fn) => { try { await fn(); } catch (e) { log(`  ! ${label}: ${process.env.FP_WALK_DEBUG ? String(e) : String(e).split("\n")[0]}`); } };
  const esc = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(200); };

  await step("title", async () => {
    await boot({ owner: "owner-planning" }); await shot("01-title");
    const g = page.getByRole("button", { name: /How do I win/ }); if (await g.count()) { await g.click(); await page.waitForTimeout(300); await shot("01b-goal-explainer"); await esc(); }
    await page.getByRole("button", { name: /Your games/ }).click(); await page.waitForTimeout(400); await shot("01d-your-games");
    await page.getByRole("button", { name: /^Rename / }).first().click(); await page.waitForTimeout(200); await shot("01e-your-games-rename");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: /^Delete / }).first().click(); await page.waitForTimeout(300); await shot("01f-delete-confirm");
    await page.getByRole("button", { name: "Keep it" }).click(); await page.waitForTimeout(200); await esc();
    await page.getByRole("button", { name: "New game" }).click(); await page.waitForTimeout(400); await shot("01c-new-game-slot");
    await page.getByRole("button", { name: /Start in an empty slot/ }).click(); await page.waitForTimeout(300); await shot("02-start-picker");
    await page.getByRole("radio", { name: /^Apprentice chef/ }).click(); await page.waitForTimeout(200); await shot("03-start-picker-career");
    await page.getByRole("radio", { name: /^Owner/ }).click(); await page.waitForTimeout(200);
    await page.locator("button.btn--xl.btn--primary").last().click(); await page.waitForTimeout(400); await shot("04-new-game-lease");
  });
  await step("planning", async () => {
    await boot({ owner: "owner-planning" }); await cont();
    await shot("10-planning-menu");
    const mx = page.getByRole("button", { name: /Menu matrix/ }); if (await mx.count()) { await mx.click(); await page.waitForTimeout(500); await shot("10b-menu-matrix"); await page.getByRole("button", { name: /Today's menu/ }).click(); }
    await tab(/^Staff/); await shot("11-planning-staff");
    const hire = page.getByRole("button", { name: /Hire someone/ }); if (await hire.count()) { await hire.click(); await page.waitForTimeout(300); await shot("11b-planning-hire-sheet"); await esc(); }
    await tab(/^Stock/); await shot("12-planning-stock");
    await tab(/^Restaurant/); await shot("13-planning-restaurant");
    await tab(/^Decorate/); await page.waitForTimeout(900);
    await page.getByRole("group", { name: "Choose what to decorate" }).getByRole("button", { name: /^Sign/ }).click();
    await page.locator("li.decorate__card").last().hover(); await page.waitForTimeout(500);
    await shot("13b-planning-decorate");
    await page.getByRole("button", { name: /What do I do/ }).click(); await page.waitForTimeout(200); await shot("14-planning-help"); await esc();
    // Round 13 (B): on a phone Settings and the save mark live in the header's "⋯" sheet
    const more = async () => { const m = page.locator(".status__morebtn"); if (await m.isVisible() && (await m.getAttribute("aria-expanded")) !== "true") { await m.click(); await page.waitForTimeout(200); } };
    await more(); await page.getByRole("button", { name: "Settings" }).first().click(); await page.waitForTimeout(250); await shot("15-settings", { terms: false }); await esc();
    await more(); await page.locator(".savemark").click(); await page.waitForTimeout(400); await shot("16-save-mark", { terms: false }); await esc();
    await tab(/^Menu/);
    await page.locator("button.btn--xl.btn--primary").last().click();
    const anyway = page.getByRole("button", { name: "Open anyway" }); if (await anyway.count()) await anyway.click();
    await page.waitForTimeout(5000); await shot("20-service", { live: true });
    const s4 = page.getByRole("button", { name: /Speed 4/ }); if (await s4.count()) { await s4.click(); await page.waitForTimeout(6000); await shot("21-service-4x", { live: true }); }
  });
  await step("evening", async () => { await boot({ owner: "owner-evening" }); await cont(); await shot("30-evening"); });
  await step("fork", async () => { await boot({ owner: "fork-evening" }); await cont(); await shot("31-fork-card", { terms: false }); });
  await step("gameover", async () => {
    // Round 11 (B): a lost game is archived ("Lost — day N"), not behind Continue; Your games shows it, "What happened" opens it.
    await boot({ career: save("gameover") });
    await page.getByRole("button", { name: /Your games/ }).click(); await page.waitForTimeout(500);
    await shot("32a-lost-slot");
    await page.getByRole("button", { name: /^What happened to / }).first().click(); await page.waitForTimeout(900);
    await shot("32-game-over");
  });
  await step("win", async () => { await boot({ owner: "win" }); await cont(); await page.waitForTimeout(800); await shot("33-win"); });
  await step("empire", async () => {
    await boot({ owner: "empire" }); await cont(); await tab(/Empire/); await shot("40-empire");
    const panels = await page.locator(".empire aside [role=tab]").allInnerTexts();
    for (const [i, p] of panels.entries()) {
      if (i === 0) continue;
      await page.locator(".empire aside [role=tab]").nth(i).click(); await page.waitForTimeout(300);
      await shot(`4${i + 1}-empire-${p.trim().toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`);
    }
  });
  await step("board", async () => {
    await boot({ owner: "empire-board" }); await cont(); await shot("45-empire-board-meeting", { terms: false });
    await page.getByRole("button", { name: "Skip this one" }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Next day/ }).click(); await page.waitForTimeout(500);
    await tab(/Empire/);
    await page.locator(".empire aside [role=tab]").filter({ hasText: "Money" }).click(); await page.waitForTimeout(300);
    await shot("46-empire-board-minutes");
    await page.getByRole("button", { name: "Zoom in" }).click(); await page.getByRole("button", { name: "Zoom in" }).click(); await page.waitForTimeout(200);
    await shot("47-empire-map-zoomed");
    await page.getByRole("button", { name: "Reset map" }).click();
    await page.getByRole("button", { name: /^Harbourton,/ }).click(); await page.waitForTimeout(300);
    await shot("48-empire-city-map");
  });
  await step("stars", async () => { await boot({ owner: "stars" }); await cont(); await tab(/Stars/); await shot("50-stars"); });
  await step("career", async () => {
    await boot({ speed: 2 });
    await page.getByRole("button", { name: "New game" }).click(); await page.waitForTimeout(300);
    const empty = page.getByRole("button", { name: /Start in an empty slot/ }); if (await empty.count()) { await empty.click(); await page.waitForTimeout(300); }
    await page.getByRole("radio", { name: /^Apprentice chef/ }).click();
    await page.getByRole("radio", { name: /^Cosy/ }).click();
    await page.getByRole("textbox").first().fill("Mia");
    await page.getByRole("button", { name: /Start as apprentice chef/ }).click(); await page.waitForTimeout(800);
    await shot("60-my-shift");
    for (let i = 0; i < 5 && !(await page.getByRole("button", { name: /Start my shift/ }).count()); i++) {
      await page.getByRole("button", { name: /Watch today|Next day/ }).first().click(); await page.waitForTimeout(600);
      const skip = page.getByRole("button", { name: /Skip to end of shift/ }); if (await skip.count()) { await skip.click(); await page.waitForTimeout(600); }
      const next = page.getByRole("button", { name: /Next day/ }); if (await next.count()) { await next.first().click(); await page.waitForTimeout(800); }
    }
    await page.getByRole("button", { name: /Start my shift/ }).click(); await page.waitForTimeout(2500);
    await shot("61-watch-shift", { live: true });
    const play = page.getByRole("button", { name: /Play my shift/ });
    if (await play.count()) {
      await play.click(); await page.waitForTimeout(1500);
      // Round 12 (D): an upright phone gets "Turn your phone sideways" first (it holds the shift); measure it, then
      // carry on upright so the walk still reaches the kitchen.
      const turn = page.getByRole("button", { name: "Play it upright anyway" });
      if (await turn.count()) { await shot("62r-turn-sideways", { terms: false }); await turn.click(); await page.waitForTimeout(500); }
      if (await page.locator(".onboard").count()) {
        await shot("62a-onboarding", { terms: false });
        const sk = page.locator(".onboard").getByRole("button", { name: /^Skip/ }).first(); if (await sk.count()) { await sk.click(); await page.waitForTimeout(300); }
      }
      await page.waitForTimeout(handsOnWait); await shot("62-hands-on", { terms: false, live: true });
      await page.getByRole("button", { name: /Skip to end of shift/ }).first().click(); await page.waitForTimeout(1500);
      await shot("63-shift-scorecard");
      const c2 = page.getByRole("button", { name: /Continue|See my evening|Done|Close/ }); if (await c2.count()) { await c2.first().click(); await page.waitForTimeout(800); }
    } else { await page.getByRole("button", { name: /Skip to end of shift/ }).first().click(); await page.waitForTimeout(1500); }
    await shot("64-career-evening");
  });
  // R12 review: the Round 12 screens the walk didn't reach (brand kit, invent a dish, today's challenge, visit a friend).
  await step("round12", async () => {
    await boot({ owner: "owner-planning" }); await cont();
    await tab(/^Restaurant/); await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Edit brand" }).click(); await page.waitForTimeout(500); await shot("70-brand-kit");
    await page.getByRole("button", { name: "Cancel" }).last().click(); await page.waitForTimeout(200);
    await tab(/^Menu/);
    await page.getByRole("button", { name: /Invent a dish/ }).click(); await page.waitForTimeout(600); await shot("71-invent-dish");
    await esc();
    await boot({ owner: "owner-planning" });
    await page.getByRole("button", { name: /Today's challenge/ }).click(); await page.waitForTimeout(800); await shot("72-challenge-intro");
    await page.getByRole("button", { name: "Back" }).first().click(); await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Visit a friend/ }).click(); await page.waitForTimeout(600); await shot("73-visit-friend");
  });
}

/**
 * Compares `totals` ({ [runTag]: { metric: n } }) with the committed baseline under `kind`. A metric above its
 * baseline (+ `slack[metric]`, for counts taken from live screens), or fewer screens reached, is a regression (exit 1). --update-baseline writes today's numbers instead.
 */
export function checkBaseline(kind, totals, slack = {}) {
  const args = process.argv.slice(2);
  const all = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  if (args.includes("--update-baseline")) {
    all[kind] = totals;
    writeFileSync(BASELINE, JSON.stringify(all, null, 2) + "\n");
    console.log(`baseline: wrote ${kind} to ${BASELINE}`);
    return 0;
  }
  if (args.includes("--no-baseline")) return 0;
  const base = all[kind];
  if (!base) { console.log(`baseline: no ${kind} baseline yet (run with --update-baseline)`); return 1; }
  const bad = [];
  for (const [tag, metrics] of Object.entries(base)) {
    const now = totals[tag];
    if (!now) { bad.push(`${tag}: not run`); continue; }
    for (const [m, b] of Object.entries(metrics)) {
      const v = now[m] ?? 0;
      if (m === "screens" ? v < b : v > b + (slack[m] ?? 0)) bad.push(`${tag} ${m}: ${v} (baseline ${b})`);
    }
  }
  const better = [];
  for (const [tag, metrics] of Object.entries(totals)) for (const [m, v] of Object.entries(metrics)) {
    const b = base[tag]?.[m]; if (b !== undefined && !(m in slack) && (m === "screens" ? v > b : v < b)) better.push(`${tag} ${m}: ${v} (baseline ${b})`);
  }
  if (better.length) console.log(`baseline: better than ${kind} baseline — lower it with --update-baseline:\n  ${better.join("\n  ")}`);
  if (bad.length) { console.log(`baseline: ${kind} REGRESSED:\n  ${bad.join("\n  ")}`); return 1; }
  console.log(`baseline: ${kind} within baseline`);
  return 0;
}
