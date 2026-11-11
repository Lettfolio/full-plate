/**
 * Round 14 (A): live co-op integrity against the BUILT dist, through the mock runtime's db and room.
 *
 *   1. hostile guest  Alice hosts and cooks, Bob serves live (1024×768, touch). Mid-shift Bob's own page (the pinned
 *                     guest) sends the reviewers' attacks over the room with his real tag: 20×16 fabricated drops a
 *                     message for 2 s, a drop naming every ticket, a quality-100 plate; a third player (Mallory, who
 *                     has the code) floods the room and sends Bob a fake host's room. Alice's cash moves only by what
 *                     her own service does; Bob's floor stays Alice's.
 *   2. heartbeat      the next day, turn-based: Bob closes his tab; ~45 s later Alice's panel says he seems to have
 *                     gone, with Keep waiting / End co-op.
 *   3. phone          Alice on a phone (390×844 upright, 844×390 sideways) with Bob joined: the panel starts folded,
 *                     and neither the pill nor the opened panel covers Open for service, the dock, or (in service) the
 *                     sheet's urgent line — checked with document.elementFromPoint at each of those controls' points.
 *
 *   node scripts/playtest-coop-r14.mjs      (FP_PART=1|2|3 for one part; FP_SHOTS for the screenshots)
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { genSaves, loadPlaywright, SAVES, startPreview } from "./lib/harness.mjs";
import { createMockRoom, createMockStore, installMockClaude } from "./lib/mockClaude.mjs";

const OUT = process.env.FP_SHOTS ?? join(process.cwd(), "playtest-shots");
const PART = process.env.FP_PART ? Number(process.env.FP_PART) : 0;
mkdirSync(OUT, { recursive: true });
genSaves();
const { chromium } = loadPlaywright();
const { url, stop } = await startPreview();
const browser = await chromium.launch();
const errors = [];
const log = (...a) => console.log(...a);
let n = 0;
const shot = async (page, name) => { const f = join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`); await page.screenshot({ path: f }); log("  shot", f); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await wait(150); } return false; };
const check = (ok, what) => { log(ok ? "  ok  " : "  FAIL", what); if (!ok) errors.push(`check failed: ${what}`); };
const text = (page, sel) => page.locator(sel).innerText().catch(() => "");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

async function player(store, room, uid, viewport = { width: 1024, height: 768 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });
  await installMockClaude(ctx, store, { uid, ...(room ? { room } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${uid}: ${String(e)}`));
  return { ctx, page };
}
async function boot(page, save, q = "") {
  await page.goto(url);
  await page.evaluate((o) => {
    localStorage.clear();
    localStorage.setItem("full-plate:settings:v1", JSON.stringify({ autoPause: false, defaultSpeed: 1, speedPicked: true }));
    localStorage.setItem("full-plate:dev", "1");
    if (o) localStorage.setItem("full-plate:save:v1", o);
  }, save);
  await page.goto(url + q); await page.waitForTimeout(700);
}
/** Alice hosts from her save, Bob joins with the code. Returns the code. */
async function inviteAndJoin(a, b, { phone = false } = {}) {
  await boot(a, readFileSync(join(SAVES, "owner-planning.json"), "utf8"), phone ? "" : "?autopilot=0.6");
  await a.getByRole("button", { name: /^Continue/ }).first().click(); await a.waitForTimeout(800);
  await a.getByRole("tab", { name: /^Restaurant/ }).click();
  await a.locator(".visitcard").getByLabel("Your nickname").fill("Alice");
  await a.getByRole("button", { name: "Invite a friend" }).click();
  // a phone folds the panel: the code is in it, so open it once
  const pill = a.locator(".coopdock__pill");
  await until(async () => (await pill.count()) + (await a.locator(".coopdock .visitcode").count()) > 0, 15000);
  if (await pill.count()) await pill.click();
  await a.locator(".coopdock .visitcode").waitFor();
  const code = (await a.locator(".coopdock .visitcode").innerText()).trim().replace(/[^A-Z0-9]/g, "");
  await boot(b, null, phone ? "" : "?autopilot=0.6");
  await b.getByRole("button", { name: /Visit a friend/ }).click();
  await b.getByLabel("Friend's code").fill(code);
  await b.getByLabel(/Your nickname/).fill("Bob");
  await b.getByRole("button", { name: "Go" }).click();
  await b.locator(".coopguest").waitFor();
  check(await until(async () => /Bob/.test(await text(a, ".coopdock"))), "host sees Bob");
  return code;
}
const hostDocOf = (store, code) => [...store.docs].find(([p]) => p.includes(code) && /host$/.test(p))?.[1] ?? null;

try {
  // ───────────────────────── 1. the hostile guest ─────────────────────────
  if (!PART || PART === 1) {
    log("1. hostile guest, live shift at 0 ms");
    const store = createMockStore({ latencyMs: 20 });
    const room = createMockRoom({ topics: { "fp-in": "interact", "fp-st": "interact", "fp-emo": "interact" }, seed: 14 });
    const A = await player(store, room, "u_alice"), B = await player(store, room, "u_bob"), M = await player(store, room, "u_mallory");
    const a = A.page, b = B.page, m = M.page;
    const code = await inviteAndJoin(a, b);
    await a.getByRole("tab", { name: /^Menu/ }).click().catch(() => {});
    check(await until(async () => (await a.getByRole("button", { name: "Go live tonight" }).count()) > 0), "host is offered a live service");
    await a.getByRole("button", { name: /I cook, Bob serves/ }).click();
    await a.getByRole("button", { name: "Go live tonight" }).click();
    check(await until(async () => /Bob is in the room/.test(await text(a, ".coopdock")), 15000), "host sees the guest in the room");
    // the lobby how-to (R13-N2) on Bob's side while the doors are shut
    const how = b.locator(".cooplive__howto summary");
    check((await how.count()) > 0, "guest's lobby offers 'How the shift works' before the doors open");
    if (await how.count()) { await how.click(); await shot(b, "guest-lobby-howto"); }
    await a.locator("button.btn--xl.btn--primary").last().click();
    const anyway = a.getByRole("button", { name: "Open anyway" }); if (await anyway.count()) await anyway.click();
    check(await until(async () => (await a.locator(".handson canvas").count()) > 0, 15000), "host is on the line");
    check(await until(async () => (await b.locator(".cooplive .handson canvas").count()) > 0, 15000), "guest's floor is up");
    check((await b.locator(".howto, .onboard__card").count()) === 0, "guest's shift opens straight on the floor (no how-to over the host's clock)");
    // let the service get going: Bob's (autopilot) taps reaching Alice's game
    check(await until(async () => ((await a.evaluate(() => window.__fpCoopLive?.applied)) ?? 0) > 0, 120_000), "Bob's honest taps reach Alice's game");
    await wait(3000);
    await shot(a, "host-live-before-attack"); await shot(b, "guest-live-before-attack");

    const live = hostDocOf(store, code)?.live;
    check(!!live?.nonce, "the lobby record has a nonce");
    const roomName = `fp-${sha(`fp-room|${code}|${live.nonce}`).slice(0, 28)}`;
    // Bob's own page joins the same named room: the same peer the host pinned
    const join = async (page) => page.evaluate(async (name) => {
      const ns = await window.claude.use("room");
      const r = await ns.join(name);
      for (let i = 0; i < 50 && !r.peers().some((p) => p.sameTab); i++) await new Promise((res) => setTimeout(res, 50));
      window.__atk = r;
      return r.peers().find((p) => p.sameTab)?.peer ?? null;
    }, roomName);
    // Mallory (she has the code) listens first: the host's floors carry the ticket ids
    const mPeer = await join(m);
    await m.evaluate(() => { window.__ids = new Set(); window.__atk.on("fp-st", (x) => { for (const r of x.data?.x ?? []) if (typeof r[0] === "string") window.__ids.add(r[0]); }); });
    const bobPeer = await join(b);
    check(!!bobPeer, "attacker (Bob's page) is in the live room");
    const bobTag = sha(`fp-tag|${live.nonce}|${bobPeer}`).slice(0, 20);
    const pinned = await a.evaluate(() => window.__fpCoopLive?.status);
    log("   host status before", JSON.stringify(pinned));
    const cashOf = async () => a.evaluate(() => { const t = document.querySelector(".status__cash")?.textContent ?? ""; return t.trim(); });
    const appliedBefore = (await a.evaluate(() => window.__fpCoopLive?.applied)) ?? 0;
    const cashText0 = await cashOf();

    // 1a. batches of 16 fabricated £50 drops, a full 4 KiB message every 66 ms for 2 s (a fresh page session id)
    const r1 = await b.evaluate(async ({ tag }) => {
      const r = window.__atk; let q = 0;
      const drop = { type: "DROPPED", item: "plates", cost: 5000 };
      for (let i = 0; i < 31; i++) {
        // as many batches of 16 as the 4 KiB message limit lets through (5)
        await r.emit("fp-in", { s: tag, k: "act", sid: "attacker1", p: Array.from({ length: 5 }, () => [++q, Array.from({ length: 16 }, () => drop)]) }).catch(() => {});
        await new Promise((res) => setTimeout(res, 66));
      }
      return q;
    }, { tag: bobTag });
    await wait(1500);
    const st1 = await a.evaluate(() => window.__fpCoopLive);
    log("   after 1a: sent", r1, "batches; host", JSON.stringify({ applied: st1?.applied, refused: st1?.refused, dropCost: st1?.status?.dropCost, benched: st1?.status?.benched }));
    check((st1?.status?.dropCost ?? 0) === 0, "1a: fabricated drops cost the host nothing (dropCost £0)");
    check(!st1?.status?.benched, "1a: and nothing was charged, so nobody is benched");

    // 1b. one drop naming every ticket id we can see, at cost 0, then the same again; 1c. a quality-100 plate
    const seen = await m.evaluate(() => [...window.__ids]);
    log("   ticket ids heard on the room:", seen.length);
    const r2 = await b.evaluate(async ({ tag, ids }) => {
      const r = window.__atk;
      const fake = Array.from({ length: 40 }, (_, i) => `k${i}`);
      const all = ids.length ? ids : fake;
      const drops = []; for (let i = 0; i < all.length; i += 3) drops.push({ type: "DROPPED", item: "plates", cost: 0, ticketIds: all.slice(i, i + 3) });
      await r.emit("fp-in", { s: tag, k: "act", sid: "attacker2", p: [[1, drops.slice(0, 16)]] }).catch(() => {});
      await new Promise((res) => setTimeout(res, 300));
      await r.emit("fp-in", { s: tag, k: "act", sid: "attacker2", p: [[2, [{ type: "PLATE_COOKED", ticketId: all[0], quality: 100, execution: 1, station: "none", speedBonus: 1 }]]] }).catch(() => {});
      return all.length;
    }, { tag: bobTag, ids: seen });
    await wait(1500);
    const st2 = await a.evaluate(() => window.__fpCoopLive);
    log("   after 1b/1c: named", r2, "tickets; host", JSON.stringify({ applied: st2?.applied, refused: st2?.refused, dropCost: st2?.status?.dropCost, cap: st2?.status?.dropCap }));
    check((st2?.status?.dropCost ?? 0) <= (st2?.status?.dropCap ?? 0), "1b: whatever was honoured is within tonight's cap");

    // 1d. Mallory, with the code, floods the room (300 msg/s for 2 s) and tells Bob she's the host
    const mTag = sha(`fp-tag|${live.nonce}|${mPeer}`).slice(0, 20);
    const appliedMid = (await a.evaluate(() => window.__fpCoopLive?.applied)) ?? 0;
    await m.evaluate(async ({ tag }) => {
      const r = window.__atk;
      await r.emit("fp-st", { s: tag, k: "base", b: 1, dy: 0, sd: 1, nm: "Mallorys", d: [], sf: [], tb: [["t1", 2]], hr: 0 });
      for (let i = 0; i < 60; i++) { for (let k = 0; k < 10; k++) r.emit("fp-in", { s: tag, k: "hi", role: "server" }).catch(() => {}); await new Promise((res) => setTimeout(res, 33)); }
    }, { tag: mTag });
    await wait(4000);
    const st3 = await a.evaluate(() => window.__fpCoopLive);
    const gname = await b.evaluate(() => document.querySelector(".cooplive")?.textContent ?? "");
    log("   after 1d: host", JSON.stringify({ applied: st3?.applied, refused: st3?.refused, guest: st3?.status?.guest }));
    check(st3?.status?.guest === "here", "1d: through Mallory's flood the host still hears Bob");
    check((st3?.applied ?? 0) > appliedMid, "1d: Bob's real taps still land during the flood");
    check(!/Mallorys/.test(gname), "1d: Bob's floor is still Alice's restaurant");
    await shot(a, "host-live-after-attacks"); await shot(b, "guest-live-after-attacks");
    log("   cash text before/after:", cashText0, "→", await cashOf(), "(the service itself moves it)");
    log("   applied by host from Bob before attacks", appliedBefore, "after", st3?.applied);
    await A.ctx.close(); await B.ctx.close(); await M.ctx.close();
  }

  // ───────────────────────── 2. the heartbeat ─────────────────────────
  if (!PART || PART === 2) {
    log("\n2. a friend who closes the tab (turn-based day)");
    const store = createMockStore({ latencyMs: 20 });
    const A = await player(store, null, "u_alice"), B = await player(store, null, "u_bob");
    const a = A.page, b = B.page;
    await inviteAndJoin(a, b);
    await wait(2000);
    check(!/seems to have gone/.test(await text(a, ".coopdock")), "while Bob's page answers, nothing is said");
    await B.ctx.close();
    log("   Bob's tab closed; waiting ~60 s");
    const t0 = Date.now();
    const noticed = await until(async () => /seems to have gone/.test(await text(a, ".coopdock")), 75_000);
    check(noticed, `the host is told Bob seems to have gone (after ${Math.round((Date.now() - t0) / 1000)} s)`);
    await shot(a, "host-friend-gone");
    check((await a.getByRole("button", { name: "Keep waiting" }).count()) > 0 && (await a.getByRole("button", { name: "End co-op" }).count()) > 0, "with Keep waiting and End co-op");
    await a.getByRole("button", { name: "Keep waiting" }).click();
    check(!/seems to have gone/.test(await text(a, ".coopdock")), "Keep waiting puts it away");
    await A.ctx.close();
  }

  // ───────────────────────── 3. phone placement ─────────────────────────
  if (!PART || PART === 3) {
    for (const vp of [{ width: 390, height: 844, name: "upright" }, { width: 844, height: 390, name: "sideways" }]) {
      log(`\n3. host on a phone, ${vp.name} ${vp.width}×${vp.height}`);
      const store = createMockStore({ latencyMs: 20 });
      const A = await player(store, null, "u_alice", { width: vp.width, height: vp.height }), B = await player(store, null, "u_bob");
      const a = A.page, b = B.page;
      await inviteAndJoin(a, b, { phone: true });
      // fold it again (inviting opened it), then reload: a phone starts folded
      await a.reload(); await a.waitForTimeout(1200);
      const cont = a.getByRole("button", { name: /^Continue/ }); if (await cont.count()) { await cont.first().click(); await a.waitForTimeout(800); }
      check(await until(async () => (await a.locator(".coopdock__pill").count()) > 0, 8000), "the panel starts folded (a pill)");
      check((await a.locator("aside.coopdock").count()) === 0, "and the panel itself is not up");
      const covers = async (label) => a.evaluate((what) => {
        const targets = [
          ...[...document.querySelectorAll(".actiondock .btn--xl, .actiondock button")].map((el) => ["Open for service / dock button", el]),
          ...[...document.querySelectorAll(".actiondock")].map((el) => ["the dock", el]),
          ...[...document.querySelectorAll(".servsheet__urgent")].map((el) => ["the sheet's urgent line", el]),
          ...[...document.querySelectorAll(".service__side:not(.service__side--sheet) > *")].map((el) => ["the service panel", el]),
        ];
        const bad = [];
        for (const [name, el] of targets) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.5], [0.9, 0.5], [0.5, 0.15], [0.5, 0.85]]) {
            const x = r.left + r.width * fx, y = r.top + r.height * fy;
            if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            if (hit && hit.closest(".coopdock")) bad.push(`${name} at ${Math.round(x)},${Math.round(y)}`);
          }
        }
        return { what, bad, targets: targets.length };
      }, label);
      const r1 = await covers("folded, planning");
      log("  ", JSON.stringify(r1));
      check(r1.targets > 0 && r1.bad.length === 0, `${vp.name}: the folded pill covers nothing it mustn't (planning)`);
      await shot(a, `phone-${vp.name}-planning-folded`);
      await a.locator(".coopdock__pill").click();
      await a.waitForTimeout(300);
      const r2 = await covers("open, planning");
      log("  ", JSON.stringify(r2));
      check(r2.bad.length === 0, `${vp.name}: the open panel covers nothing it mustn't (planning)`);
      await shot(a, `phone-${vp.name}-planning-open`);
      // into service: the sheet's urgent line
      await a.locator(".actiondock button.btn--xl.btn--primary").last().click();
      const anyway = a.getByRole("button", { name: "Open anyway" }); if (await anyway.count()) await anyway.click();
      await a.waitForTimeout(2500);
      const r3 = await covers("folded, service");
      log("  ", JSON.stringify(r3));
      check(r3.bad.length === 0, `${vp.name}: in service the pill covers nothing it mustn't`);
      await shot(a, `phone-${vp.name}-service`);
      await A.ctx.close(); await B.ctx.close();
    }
  }
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  stop();
}
log(errors.length ? `\n${errors.length} problem(s):\n${errors.join("\n")}` : "\nall checks passed, 0 page errors");
process.exit(errors.length ? 1 : 0);
