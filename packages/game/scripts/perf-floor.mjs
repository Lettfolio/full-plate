#!/usr/bin/env node
/**
 * Round 13 (A, R12-F6): the floor's frame-time bench, so the reviewer can repeat the numbers. The R8.6 / R12.8 method,
 * scripted: the built dist under `vite preview`, headless Chromium with the GPU off (software raster), the audit save
 * `owner-planning` opened, service started at 1× and left to fill until 12:40, then the chosen speed, a 4× CPU
 * throttle (CDP Emulation.setCPUThrottlingRate), a 600 ms settle, and every rAF interval recorded for 5 s.
 *
 * Per run it reports the median / mean / p95 gap, the frames over 20 ms ("dropped": a 60 Hz frame that missed its
 * slot) and the vsyncs missed in all (Σ round(gap / 16.7) − 1), plus the renderer's own JS per frame (`__fpPerf`).
 * With `--passes` (needs a Round 13 build) the same window is run with `window.__fpPassProfile` set instead: each
 * paint pass is flushed to pixels (perfMeter.ts passProfile) and timed, giving ms per frame per pass (JS + raster).
 * The flush slows every frame, so a --passes run's gap numbers are not comparable: take gaps from a plain run.
 *
 *   node scripts/perf-floor.mjs                         # dist-playtest/ (R14: built for you), 1024x768 and 390x844m, 1× and 4×, 2 runs each
 *   FP_DIST=/path/to/other/dist node scripts/perf-floor.mjs --label base   # a playtest build (FP_PLAYTEST=1 vite build)
 * Env: FP_PERF_VIEWPORTS ("1024x768,390x844m"), FP_PERF_SPEEDS ("1,4"), FP_PERF_RUNS (2), FP_PERF_SECONDS (5),
 *      FP_PERF_THROTTLE (4), FP_PERF_JSON (write the results there), plus harness.mjs's FP_URL / FP_DIST / FP_PORT.
 * --bench: the renderer alone on a fixed, deterministic state (see below): ms per frame, no app around it.
 * Flags: --passes (the per-pass profile too), --label <name> (printed with the table), --shots <dir> (a paused-frame
 *        PNG of the floor per viewport, for a before/after pixel diff), --trace <dir> (a Chromium trace of each first
 *        run's window; scripts/perf-trace.mjs sums it by event).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { contextFor, genSaves, loadPlaywright, parseViewports, PKG, SAVES, playtestDist, startPreview } from "./lib/harness.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const VIEWPORTS = parseViewports(process.env.FP_PERF_VIEWPORTS ?? "1024x768,390x844m");
const SPEEDS = (process.env.FP_PERF_SPEEDS ?? "1,4").split(",").map(Number);
const RUNS = Number(process.env.FP_PERF_RUNS ?? 2);
const SECONDS = Number(process.env.FP_PERF_SECONDS ?? 5);
const THROTTLE = Number(process.env.FP_PERF_THROTTLE ?? 4);
const LABEL = opt("--label") ?? (process.env.FP_DIST ? process.env.FP_DIST : "dist-playtest");
const SHOTS = opt("--shots");

/** Runs in the page: every rAF interval for `ms`, then the stats. */
function sample(ms) {
  return new Promise((done) => {
    const gaps = []; let last = 0; const t0 = performance.now();
    const f = (now) => {
      if (last) gaps.push(now - last);
      last = now;
      if (now - t0 < ms) requestAnimationFrame(f); else done(gaps);
    };
    requestAnimationFrame(f);
  });
}

function stats(gaps) {
  const s = [...gaps].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const mean = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
  const dropped = gaps.filter((g) => g > 20).length;
  const missed = gaps.reduce((a, g) => a + Math.max(0, Math.round(g / (1000 / 60)) - 1), 0);
  return { frames: gaps.length, median: q(0.5), mean, p95: q(0.95), max: s.at(-1) ?? 0, dropped, missed };
}

async function openService(page, url, vp) {
  const save = readFileSync(join(SAVES, "owner-planning.json"), "utf8");
  await page.goto(url);
  await page.evaluate((o) => {
    localStorage.clear();
    localStorage.setItem("full-plate:settings:v1", JSON.stringify({ autoPause: false, defaultSpeed: 1, speedPicked: true, textSize: "normal" }));
    localStorage.setItem("full-plate:save:v1", o);
  }, save);
  await page.goto(url + "?perf=1");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Continue/ }).first().click();
  await page.waitForTimeout(700);
  await page.locator("button.btn--xl.btn--primary").last().click();
  const anyway = page.getByRole("button", { name: "Open anyway" });
  await page.waitForTimeout(300);
  if (await anyway.count()) await anyway.click();
  await page.waitForSelector("canvas", { timeout: 10000 });
  // let the room fill at 1× until 12:40 (tick 8)
  await page.waitForFunction(() => { const t = document.querySelector(".clock__time")?.textContent ?? ""; return t >= "12:40"; }, null, { timeout: 30000 });
  void vp;
}

async function setSpeed(page, sp) {
  const b = page.getByRole("button", { name: sp === 0 ? "Pause" : `Speed ${sp}x` }).first();
  if (await b.count()) await b.tap(); else await page.keyboard.press(String(sp));
}

const { chromium } = loadPlaywright();

/**
 * --bench: the renderer alone, on a fixed state (floor-bench.html + src/dev/floorBench.ts under the Vite dev server).
 * Same states and times for every build, so the number moves only when the drawing does. FP_BENCH_ROOT points at
 * another checkout's packages/game (with the bench page copied in) to bench that code instead.
 */
if (flag("--bench")) {
  const root = process.env.FP_BENCH_ROOT ?? PKG;
  const port = Number(process.env.FP_PORT) || 5190 + Math.floor(Math.random() * 300);
  const vite = spawn(join(PKG, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
  const url = `http://127.0.0.1:${port}/floor-bench.html`;
  for (let i = 0; i < 120; i++) { try { if ((await fetch(url)).ok) break; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-gpu-compositing", "--disable-gpu-rasterization"] });
  const sizes = (process.env.FP_BENCH_SIZES ?? "632x643@1,372x268@2").split(",");
  const out = [];
  try {
    for (const sz of sizes) {
      const [, w, h, d] = /(\d+)x(\d+)@(\d+)/.exec(sz);
      const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(d) });
      const page = await ctx.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${url}?w=${w}&h=${h}`);
      await page.waitForFunction(() => document.title === "Floor bench ready", null, { timeout: 120000 });
      await page.evaluate(() => document.fonts.ready);
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        for (const [name, still] of [["lunch", [200, 50_000]], ["early", [40, 12_345]]]) {
          await page.evaluate(([i, n]) => window.__floorBench.still(i, n), still);
          await page.locator("canvas").screenshot({ path: join(SHOTS, `bench-${name}-${sz.replace("@", "at")}.png`) });
        }
      }
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
      const ms = [];
      for (let r = 0; r < RUNS; r++) ms.push(await page.evaluate(() => window.__floorBench.bench(300)));
      const row = { label: LABEL, size: sz, throttle: THROTTLE, msPerFrame: ms.map((v) => +v.toFixed(3)), best: +Math.min(...ms).toFixed(3), errors };
      if (flag("--passes")) {
        // per pass, the best of RUNS windows (the machine's noise only ever adds)
        const best = {};
        for (let r = 0; r < RUNS; r++) for (const [k, v] of Object.entries(await page.evaluate(() => window.__floorBench.passes?.(300) ?? {}))) best[k] = Math.min(best[k] ?? Infinity, v);
        row.passes = Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toFixed(3)]));
      }
      out.push(row);
      console.log(`${LABEL} bench ${sz} ${THROTTLE}× throttle: ms per frame ${row.msPerFrame.join(" / ")} (best ${row.best})${row.passes ? " | " + Object.entries(row.passes).map(([k, v]) => `${k} ${v}`).join(" ") : ""}${errors.length ? ` | errors: ${errors[0]}` : ""}`);
      await ctx.close();
    }
  } finally { await browser.close(); vite.kill(); }
  if (process.env.FP_PERF_JSON) writeFileSync(process.env.FP_PERF_JSON, JSON.stringify(out, null, 2));
  process.exit(0);
}

genSaves();
playtestDist(); // R14 (C, S14-9): ?perf= and the pass profile need a playtest build (FP_DIST: bring your own)
const preview = await startPreview();
const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-gpu-compositing", "--disable-gpu-rasterization"] });
const results = [];
try {
  for (const vp of VIEWPORTS) {
    for (const sp of SPEEDS) {
      for (let run = 0; run < RUNS; run++) {
        const ctx = await browser.newContext(contextFor(vp, { deviceScaleFactor: 1, hasTouch: true }));
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await openService(page, preview.url, vp);
        const cdp = await ctx.newCDPSession(page);
        await setSpeed(page, sp);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
        await page.waitForTimeout(600);
        const passes = flag("--passes");
        if (passes) await page.evaluate(() => { window.__fpPassProfile = {}; });
        const clock0 = await page.locator(".clock__time").first().textContent();
        const trace = opt("--trace");
        if (trace && run === 0) await browser.startTracing(page, { path: join(trace, `trace-${LABEL.replace(/\W+/g, "_")}-${vp.width}x${vp.height}-${sp}x.json`), categories: ["devtools.timeline", "toplevel", "blink", "cc", "disabled-by-default-devtools.timeline"] });
        const gaps = await page.evaluate(sample, SECONDS * 1000);
        if (trace && run === 0) await browser.stopTracing();
        const js = await page.evaluate(() => window.__fpPerf?.floor?.work ?? null);
        const clock1 = await page.locator(".clock__time").first().textContent();
        const canvas = await page.evaluate(() => { const c = document.querySelector("canvas"); return c ? `${c.clientWidth}x${c.clientHeight}@${(c.width / c.clientWidth).toFixed(1)}` : ""; });
        const row = { canvas, label: LABEL, vp: `${vp.width}x${vp.height}${vp.phone ? "m" : ""}`, speed: sp, run, clock: `${clock0}–${clock1}`, js, ...stats(gaps), errors: errors.length };
        if (passes) {
          const p = await page.evaluate(() => { const p = window.__fpPassProfile; window.__fpPassProfile = null; return p; });
          if (p?.frames) { row.passes = Object.fromEntries(Object.entries(p.ms).map(([k, v]) => [k, +(v / p.frames).toFixed(3)])); row.passes.total = +Object.values(row.passes).reduce((a, b) => a + b, 0).toFixed(3); }
        }
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        if (SHOTS && run === 0 && sp === SPEEDS[0]) {
          mkdirSync(SHOTS, { recursive: true });
          await setSpeed(page, 0); await page.waitForTimeout(400);
          await page.locator("canvas").first().screenshot({ path: join(SHOTS, `floor-paused-${row.vp}.png`) });
        }
        results.push(row);
        const f = (n) => n.toFixed(2);
        console.log(`${LABEL} ${row.vp} (floor ${canvas}) ${sp}× #${run + 1} ${row.clock}: median ${f(row.median)} mean ${f(row.mean)} p95 ${f(row.p95)} max ${f(row.max)} | dropped ${row.dropped}/${row.frames} missed ${row.missed} | JS ${js?.toFixed(2) ?? "–"} ms${row.passes ? " | " + Object.entries(row.passes).map(([k, v]) => `${k} ${v}`).join(" ") : ""}${errors.length ? ` | ${errors.length} page errors: ${errors[0]}` : ""}`);
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  preview.stop();
}
if (process.env.FP_PERF_JSON) writeFileSync(process.env.FP_PERF_JSON, JSON.stringify(results, null, 2));
