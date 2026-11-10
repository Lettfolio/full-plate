/**
 * Round 12 (G): two players against a built dist, through the mock runtime (scripts/lib/mockClaude.mjs): share → visit
 * → review → the owner's Visitors list; then a co-op day (invite → join → plan → "Use it" → emotes → service →
 * evening → end); and the no-db line. 1024×768 with touch. Screenshots to FP_SHOTS (default ./playtest-shots).
 *
 *   node scripts/playtest-friends.mjs            (builds dist/ if missing; FP_URL to use a running preview)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { genSaves, loadPlaywright, SAVES, startPreview } from "./lib/harness.mjs";
import { createMockStore, installMockClaude } from "./lib/mockClaude.mjs";
import { readFileSync } from "node:fs";

const OUT = process.env.FP_SHOTS ?? join(process.cwd(), "playtest-shots");
mkdirSync(OUT, { recursive: true });
genSaves();
const { chromium } = loadPlaywright();
const { url, stop } = await startPreview();
const store = createMockStore({ latencyMs: Number(process.env.FP_LATENCY ?? 30) });
const browser = await chromium.launch();
const errors = [];
const log = (...a) => console.log(...a);
let n = 0;
const shot = async (page, name) => { const f = join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`); await page.screenshot({ path: f }); log("  shot", f); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function player(uid, mock = true) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, hasTouch: true });
  if (mock) await installMockClaude(ctx, store, { uid });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${uid}: ${String(e)}`));
  return { ctx, page };
}
async function boot(page, save) {
  await page.goto(url);
  await page.evaluate((o) => {
    localStorage.clear();
    localStorage.setItem("full-plate:settings:v1", JSON.stringify({ autoPause: false, defaultSpeed: 4, speedPicked: true }));
    if (o) localStorage.setItem("full-plate:save:v1", o);
  }, save);
  await page.reload(); await page.waitForTimeout(600);
}
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(100); } return false; };
const check = (ok, what) => { log(ok ? "  ok  " : "  FAIL", what); if (!ok) errors.push(`check failed: ${what}`); };

try {
  const A = await player("u_alice");
  const B = await player("u_bob");
  const a = A.page, b = B.page;

  log("1. share");
  await boot(a, readFileSync(join(SAVES, "owner-planning.json"), "utf8"));
  await a.getByRole("button", { name: /^Continue/ }).first().click(); await a.waitForTimeout(800);
  await a.getByRole("tab", { name: /^Restaurant/ }).click();
  await a.getByRole("button", { name: "Share my restaurant" }).waitFor();
  await shot(a, "owner-restaurant-tab-friends-card");
  await a.getByRole("button", { name: "Share my restaurant" }).click();
  await a.locator(".visitcard .visitcode").waitFor();
  const shareCode = (await a.locator(".visitcard .visitcode").innerText()).trim();
  check(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(shareCode), `share code shown (${shareCode})`);
  await shot(a, "owner-shared-code");

  log("2. visit");
  await boot(b, null);
  await shot(b, "visitor-title");
  await b.getByRole("button", { name: /Visit a friend/ }).click();
  await b.getByLabel("Friend's code").waitFor();
  await shot(b, "visitor-code-form");
  await b.getByLabel("Friend's code").fill(shareCode.toLowerCase());
  await b.getByLabel(/Your nickname/).fill("Bob<b>!!");
  check((await b.getByLabel(/Your nickname/).inputValue()) === "Bobb", "nickname filtered while typing");
  await b.getByRole("button", { name: "Go" }).click();
  await b.locator(".visit").waitFor();
  await b.waitForTimeout(700);
  await shot(b, "visitor-room");
  check(await b.locator("canvas.visitroom__canvas").isVisible(), "room canvas drawn");
  await b.locator(".visit__leave").scrollIntoViewIfNeeded();
  await b.getByRole("button", { name: "4 stars" }).click();
  await b.getByRole("button", { name: "Lovely room" }).click();
  await b.getByRole("button", { name: "I'd come back" }).click();
  await shot(b, "visitor-review-picked");
  await b.getByRole("button", { name: "Send review" }).click();
  await b.getByText(/will see it under Visitors/).waitFor();
  await shot(b, "visitor-review-sent");

  log("3. the owner sees the visitor");
  check(await until(async () => (await a.locator(".visitors__item").count()) === 1), "Visitors list has the review");
  const row = await a.locator(".visitors__item").first().innerText();
  check(/Bobb/.test(row) && /Lovely room/.test(row) && /come back/.test(row), `visitor row: ${row.replace(/\n/g, " | ")}`);
  await a.locator(".visitors").scrollIntoViewIfNeeded();
  await shot(a, "owner-visitors");

  log("4. one review a day");
  await b.getByRole("button", { name: /Leave/ }).click(); await b.waitForTimeout(400);
  await b.getByRole("button", { name: /Visit a friend/ }).click();
  await b.getByLabel("Friend's code").fill(shareCode);
  await b.getByRole("button", { name: "Go" }).click();
  await b.getByText(/You've reviewed .* today/).waitFor();
  await b.locator(".visit__leave").scrollIntoViewIfNeeded();
  await shot(b, "visitor-already-reviewed");
  await b.getByRole("button", { name: /Leave/ }).click(); await b.waitForTimeout(300);

  log("5. co-op: invite");
  await a.locator(".visitcard").getByLabel("Your nickname").fill("Alice");
  await a.getByRole("button", { name: "Invite a friend" }).click();
  await a.locator(".coopdock .visitcode").waitFor();
  const coopCode = (await a.locator(".coopdock .visitcode").innerText()).trim();
  await shot(a, "host-dock-code");

  log("6. co-op: join");
  await b.getByRole("button", { name: /Visit a friend/ }).click();
  await b.getByLabel("Friend's code").fill(coopCode);
  await b.getByRole("button", { name: "Go" }).click();
  await b.locator(".coopguest").waitFor();
  await b.waitForTimeout(600);
  await shot(b, "guest-plan");
  check(await until(async () => /with Bobb/.test(await a.locator(".coopdock").innerText())), "host sees the guest's nickname");
  check(/with Alice/.test(await b.locator(".coopguest__head").innerText()), "guest sees the host's nickname");
  await until(async () => /link \d+ ms/.test(await a.locator(".coopdock").innerText()));
  await shot(a, "host-dock-joined");

  log("7. co-op: plan");
  const firstDish = b.locator(".coopguest__list").first().locator(".coopguest__toggle").first();
  const dishLabel = (await firstDish.innerText()).trim();
  await firstDish.click();
  await b.locator(".coopguest__list").first().getByRole("button", { name: /^Increase price/ }).nth(1).click();
  await b.locator(".coopguest__list").nth(1).locator(".coopguest__toggle").first().click().catch(() => {});
  await shot(b, "guest-plan-edited");
  await b.getByRole("button", { name: /Send plan to Alice/ }).click();
  check(await until(async () => (await a.getByRole("button", { name: "Use it" }).count()) > 0), "host gets the plan");
  await shot(a, "host-plan-in");
  await a.getByRole("button", { name: "Use it" }).click();
  check(await until(async () => /used your plan/.test(await b.locator(".coopguest").innerText())), "guest hears the plan was used");
  await shot(b, "guest-plan-used");
  await a.getByRole("tab", { name: /^Menu/ }).click(); await a.waitForTimeout(400);
  await shot(a, "host-menu-after-plan");
  log(`  (toggled: ${dishLabel})`);

  log("8. emotes");
  await b.getByRole("button", { name: /Send “Nice one”/ }).click();
  check(await until(async () => /Bobb: Nice one/.test(await a.locator(".coopdock").innerText())), "host sees the guest's emote");
  await shot(a, "host-hears-emote");
  await a.locator(".coopdock").getByRole("button", { name: /Send “On fire”/ }).click();
  check(await until(async () => /Alice: On fire/.test(await b.locator(".coopguest").innerText())), "guest sees the host's emote");
  await shot(b, "guest-hears-emote");

  log("9. service → evening");
  await a.locator("button.btn--xl.btn--primary").last().click();
  const anyway = a.getByRole("button", { name: "Open anyway" }); if (await anyway.count()) await anyway.click();
  check(await until(async () => /running tonight's service/.test(await b.locator(".coopguest").innerText())), "guest sees the service stage");
  await shot(b, "guest-during-service");
  await a.waitForTimeout(800);
  await shot(a, "host-service-with-dock");
  await a.getByRole("button", { name: /Skip to evening/ }).click();
  check(await until(async () => /Tonight at/.test(await b.locator(".coopguest").innerText()), 15000), "guest sees the evening");
  await b.waitForTimeout(400);
  await shot(b, "guest-evening");
  await shot(a, "host-evening-with-dock");

  log("10. end");
  await a.getByRole("button", { name: "End the co-op day" }).click();
  check(await until(async () => /ended the co-op day/.test(await b.locator(".coopguest").innerText())), "guest sees the end");
  check((await a.locator(".coopdock").count()) === 0, "host dock gone");
  await shot(b, "guest-ended");
  const rtt = await a.evaluate(() => window.__fpCoopRtt ?? []);
  log(`  round trips (mock, latency ${process.env.FP_LATENCY ?? 30} ms per call, ${120} ms poll): ${rtt.join(", ")} ms`);

  log("11. no db (GitHub Pages)");
  const C = await player("none", false);
  await boot(C.page, null);
  await C.page.getByRole("button", { name: /Visit a friend/ }).click();
  await C.page.getByText(/Sharing needs the Claude link/).waitFor();
  await shot(C.page, "no-db-visit-a-friend");
  await boot(C.page, readFileSync(join(SAVES, "owner-planning.json"), "utf8"));
  await C.page.getByRole("button", { name: /^Continue/ }).first().click(); await C.page.waitForTimeout(800);
  await C.page.getByRole("tab", { name: /^Restaurant/ }).click();
  await C.page.getByText(/Sharing needs the Claude link/).waitFor();
  await shot(C.page, "no-db-restaurant-tab");

  log(`db calls: ${JSON.stringify(store.stats)}; documents: ${store.docs.size}`);
  log(`share paths: ${[...store.docs.keys()].filter((k) => !k.startsWith("data/users/")).join(", ")}`);
} catch (e) {
  errors.push(`script: ${String(e).split("\n")[0]}`);
} finally {
  await browser.close();
  stop();
}
log(errors.length ? `\n${errors.length} problem(s):\n${errors.join("\n")}` : "\n0 page errors, every check passed");
process.exit(errors.length ? 1 : 0);
