/**
 * Round 13 (F): the LIVE co-op shift, two players against a built dist through the mock runtime's db AND room
 * (scripts/lib/mockClaude.mjs). Three whole shifts on three nights — 0 ms, 150 ms + 20% loss, 400 ms + 20% loss —
 * host cooking (`?autopilot=` bots on both sides), guest serving; a 5 s blackout mid-shift on the first night (the
 * guest goes away and comes back); the host's replay check at each close; the slow-link offer at 400 ms; then the
 * fallback: a host whose page has no `room` gets the Round 12 turn-based day, unchanged. 1024×768 with touch.
 * Screenshots from both sides at the same moments to FP_SHOTS (default ./playtest-shots).
 *
 *   node scripts/playtest-coop-live.mjs        (FP_URL to use a running preview; FP_NIGHTS=1 for the first night only)
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { genSaves, loadPlaywright, SAVES, startPreview } from "./lib/harness.mjs";
import { createMockRoom, createMockStore, installMockClaude } from "./lib/mockClaude.mjs";

const OUT = process.env.FP_SHOTS ?? join(process.cwd(), "playtest-shots");
mkdirSync(OUT, { recursive: true });
genSaves();
const { chromium } = loadPlaywright();
const { url, stop } = await startPreview();
const store = createMockStore({ latencyMs: 20 });
const room = createMockRoom({ topics: { "fp-in": "interact", "fp-st": "interact", "fp-emo": "interact" }, seed: 13 });
const browser = await chromium.launch();
const errors = [];
const report = [];
const log = (...a) => console.log(...a);
let n = 0;
const shot = async (page, name) => { const f = join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`); await page.screenshot({ path: f }); log("  shot", f); };
const both = async (a, b, name) => { await Promise.all([shot(a, `host-${name}`), shot(b, `guest-${name}`)]); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await wait(150); } return false; };
const check = (ok, what) => { log(ok ? "  ok  " : "  FAIL", what); if (!ok) errors.push(`check failed: ${what}`); };
async function player(uid, withRoom = true) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, hasTouch: true });
  await installMockClaude(ctx, store, { uid, ...(withRoom ? { room } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${uid}: ${String(e)}`));
  return { ctx, page };
}
async function boot(page, save, q = "?autopilot=0.6") {
  await page.goto(url);
  await page.evaluate((o) => {
    localStorage.clear();
    localStorage.setItem("full-plate:settings:v1", JSON.stringify({ autoPause: false, defaultSpeed: 1, speedPicked: true }));
    localStorage.setItem("full-plate:dev", "1");
    if (o) localStorage.setItem("full-plate:save:v1", o);
  }, save);
  await page.goto(url + q); await page.waitForTimeout(700);
}
const text = (page, sel) => page.locator(sel).innerText().catch(() => "");

try {
  const A = await player("u_alice");
  const B = await player("u_bob");
  const a = A.page, b = B.page;

  log("1. invite and join (Round 12's code + nickname)");
  await boot(a, readFileSync(join(SAVES, "owner-planning.json"), "utf8"));
  await a.getByRole("button", { name: /^Continue/ }).first().click(); await a.waitForTimeout(800);
  await a.getByRole("tab", { name: /^Restaurant/ }).click();
  await a.locator(".visitcard").getByLabel("Your nickname").fill("Alice");
  await a.getByRole("button", { name: "Invite a friend" }).click();
  await a.locator(".coopdock .visitcode").waitFor();
  const code = (await a.locator(".coopdock .visitcode").innerText()).trim();
  await boot(b, null);
  await b.getByRole("button", { name: /Visit a friend/ }).click();
  await b.getByLabel("Friend's code").fill(code);
  await b.getByLabel(/Your nickname/).fill("Bob");
  await b.getByRole("button", { name: "Go" }).click();
  await b.locator(".coopguest").waitFor();
  check(await until(async () => /with Bob/.test(await text(a, ".coopdock"))), "host sees Bob");

  const nights = [
    { name: "0ms", latencyMs: 0, jitterMs: 0, loss: 0 },
    { name: "150ms-20pct", latencyMs: 150, jitterMs: 60, loss: 0.2 },
    { name: "400ms-20pct", latencyMs: 400, jitterMs: 80, loss: 0.2 },
  ].slice(0, Number(process.env.FP_NIGHTS ?? 3));
  for (const [i, night] of nights.entries()) {
    Object.assign(room.opts, { latencyMs: night.latencyMs, jitterMs: night.jitterMs, loss: night.loss });
    log(`\n${i + 2}. night ${i + 1}: ${night.name}`);
    await a.getByRole("tab", { name: /^Menu/ }).click().catch(() => {});
    check(await until(async () => (await a.getByRole("button", { name: "Go live tonight" }).count()) > 0), "host is offered a live service");
    if (i === 0) await both(a, b, `${night.name}-offer`);
    await a.getByRole("button", { name: /I cook, Bob serves/ }).click();
    await a.getByRole("button", { name: "Go live tonight" }).click();
    check(await until(async () => /Live tonight: you're serving/.test(await text(b, ".coopguest"))), "guest sees: live tonight, serving");
    check(await until(async () => /Bob is in the room/.test(await text(a, ".coopdock")), 15000), "host sees the guest in the room");
    if (i === 0) await both(a, b, `${night.name}-ready`);
    // open the doors
    await a.locator("button.btn--xl.btn--primary").last().click();
    const anyway = a.getByRole("button", { name: "Open anyway" }); if (await anyway.count()) await anyway.click();
    check(await until(async () => (await a.locator(".handson canvas").count()) > 0, 15000), "host is on the line (hands-on)");
    check(await until(async () => (await b.locator(".cooplive .handson canvas").count()) > 0, 15000), "guest's floor is up");
    await wait(6000);
    await both(a, b, `${night.name}-shift-early`);
    if (i === 0) {
      // emotes over the room
      await b.locator(".cooplive__hud").getByRole("button", { name: /Emote/ }).click();
      await b.locator(".cooplive__hud").getByRole("button", { name: /Send “Nice one”/ }).click();
      check(await until(async () => /Bob\s*:\s*Nice one/.test(await text(a, ".cooplive__hud"))), "host hears the guest's emote");
      const fps = async (p) => p.evaluate(() => new Promise((r) => { let k = 0; const t0 = performance.now(); let worst = 0, last = t0; const f = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; k++; if (t - t0 < 2000) requestAnimationFrame(f); else r({ fps: Math.round(k / ((t - t0) / 1000)), worstFrameMs: Math.round(worst) }); }; requestAnimationFrame(f); }));
      log("   frames: host", JSON.stringify(await fps(a)), "guest", JSON.stringify(await fps(b)), "room", JSON.stringify(room.stats.topics));
      if (process.env.FP_QUICK) throw new Error("quick stop");
      await both(a, b, `${night.name}-emote`);
      // a 5 s blackout: the guest goes away (the team covers), then comes back
      room.opts.loss = 1;
      check(await until(async () => /gone quiet/.test(await text(a, ".cooplive__hud")), 8000), "host: the guest has gone quiet, the team covers");
      await both(a, b, `${night.name}-blackout`);
      room.opts.loss = night.loss;
      check(await until(async () => !/gone quiet/.test(await text(a, ".cooplive__hud")), 8000), "host: the guest is back");
    }
    if (night.latencyMs >= 400) {
      check(await until(async () => /link is slow/.test(await text(a, ".cooplive__hud")), 30000), "host is told the link is slow and offered to finish alone");
      await both(a, b, `${night.name}-slow-offer`);
    }
    await wait(20000);
    await both(a, b, `${night.name}-shift-mid`);
    // the rest of the shift, to close
    const closed = await until(async () => (await a.locator(".handson canvas").count()) === 0, 240000);
    check(closed, "the shift ran to closing time");
    check(await until(async () => /Doors closed/.test(await text(b, ".coopguest")), 15000), "guest: doors closed, with their numbers");
    await wait(800);
    await both(a, b, `${night.name}-closed`);
    const replay = await a.evaluate(() => window.__fpCoopReplay ?? null);
    const host = await a.evaluate(() => window.__fpCoopLive ?? null);
    const guest = await b.evaluate(() => window.__fpCoopLive ?? null);
    check(!!replay && replay.ok, `replay of the host's log is byte-identical (${replay?.actions} actions, ${replay?.bytes} bytes)`);
    const sizes = [...(host?.sizes ?? [])].sort((x, y) => x - y);
    const row = {
      night: night.name, replay, rtt: host?.rtt, guestRtt: guest?.rtt, snaps: host?.snaps, seconds: Math.round(host?.seconds ?? 0),
      rate: host?.seconds ? Math.round((host.snaps / host.seconds) * 10) / 10 : null,
      size: sizes.length ? { min: sizes[0], median: sizes[Math.floor(sizes.length / 2)], max: sizes.at(-1) } : null,
      applied: host?.applied, refused: { host: host?.refused, guest: guest?.refused }, room: { ...room.stats },
      guestCard: (await text(b, ".cooplive__card")).replace(/\n/g, " | "),
    };
    report.push(row);
    log("  ", JSON.stringify(row));
    check(!!row.size && row.size.max <= 4096, "every snapshot under 4 KiB");
    check(row.applied > 0, "the guest's taps reached the host's game");
    // back to the turn-based screen; host on to the next day
    await b.getByRole("button", { name: "Back to the co-op day" }).click();
    check(await until(async () => /Tonight at/.test(await text(b, ".coopguest")), 15000), "guest sees the evening numbers (Round 12 card)");
    if (i < nights.length - 1) {
      const next = a.getByRole("button", { name: /Next day|Tomorrow|morning post/ }).first();
      await next.click();
      const ev = a.locator(".modal .btn").first(); if (await ev.count()) await ev.click().catch(() => {});
      await a.waitForTimeout(1200);
      check(await until(async () => /Plan tonight/.test(await text(b, ".coopguest")), 15000), "next day: guest back on the plan");
    }
  }

  log("\nfallback: no room on the host's page → the Round 12 turn-based day, unchanged");
  const C = await player("u_carol", false);
  const D = await player("u_dan");
  await boot(C.page, readFileSync(join(SAVES, "owner-planning.json"), "utf8"), "");
  await C.page.getByRole("button", { name: /^Continue/ }).first().click(); await C.page.waitForTimeout(800);
  await C.page.getByRole("tab", { name: /^Restaurant/ }).click();
  await C.page.locator(".visitcard").getByLabel("Your nickname").fill("Carol");
  await C.page.getByRole("button", { name: "Invite a friend" }).click();
  await C.page.locator(".coopdock .visitcode").waitFor();
  const code2 = (await C.page.locator(".coopdock .visitcode").innerText()).trim();
  await boot(D.page, null, "");
  await D.page.getByRole("button", { name: /Visit a friend/ }).click();
  await D.page.getByLabel("Friend's code").fill(code2);
  await D.page.getByLabel(/Your nickname/).fill("Dan");
  await D.page.getByRole("button", { name: "Go" }).click();
  await D.page.locator(".coopguest").waitFor();
  check(await until(async () => /with Dan/.test(await text(C.page, ".coopdock"))), "host (no room) sees Dan");
  await C.page.waitForTimeout(1500);
  check((await C.page.getByRole("button", { name: "Go live tonight" }).count()) === 0, "no live offer without room");
  check(await D.page.getByRole("button", { name: /Send plan to Carol/ }).isVisible(), "guest plans tonight as in Round 12");
  await both(C.page, D.page, "fallback-no-room");
} catch (e) {
  errors.push(`script: ${String(e).split("\n")[0]}`);
} finally {
  await browser.close();
  stop();
}
log(`\nreport: ${JSON.stringify(report, null, 1)}`);
log(errors.length ? `\n${errors.length} problem(s):\n${errors.join("\n")}` : "\n0 page errors, every check passed");
process.exit(errors.length ? 1 : 0);
