#!/usr/bin/env node
/**
 * Round 13 (A): sums a Chromium trace (perf-floor.mjs --trace) by event name per thread — complete ("X") events and
 * B/E pairs, self time not separated — so you can see where a frame's time goes outside the rAF callback (style,
 * layout, paint, raster, canvas flush, GC). `node scripts/perf-trace.mjs trace.json [top=25]`.
 */
import { readFileSync } from "node:fs";
const [file, topArg] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(file, "utf8"));
const events = Array.isArray(raw) ? raw : raw.traceEvents;
const names = new Map();
for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
const sums = new Map(); const open = new Map();
let t0 = Infinity, t1 = 0;
for (const e of events) {
  const th = names.get(`${e.pid}:${e.tid}`) ?? `${e.pid}:${e.tid}`;
  if (e.ts) { t0 = Math.min(t0, e.ts); t1 = Math.max(t1, e.ts); }
  let dur;
  if (e.ph === "X") dur = e.dur ?? 0;
  else if (e.ph === "B") { open.set(`${th}|${e.name}`, e.ts); continue; }
  else if (e.ph === "E") { const b = open.get(`${th}|${e.name}`); if (b === undefined) continue; dur = e.ts - b; open.delete(`${th}|${e.name}`); }
  else continue;
  const k = `${th} | ${e.name}`;
  const v = sums.get(k) ?? { ms: 0, n: 0 }; v.ms += dur / 1000; v.n++; sums.set(k, v);
}
const secs = (t1 - t0) / 1e6;
console.log(`${file}: ${secs.toFixed(2)} s`);
for (const [k, v] of [...sums].sort((a, b) => b[1].ms - a[1].ms).slice(0, Number(topArg ?? 25))) console.log(`${v.ms.toFixed(1).padStart(8)} ms  ${String(v.n).padStart(6)}×  ${k}`);
