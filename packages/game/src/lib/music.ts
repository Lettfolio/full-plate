/**
 * Round 12 (A): the synthesiser behind lib/sfx.ts — sound effects and a three-piece soundtrack, all made on the fly with
 * Web Audio oscillators and one noise buffer (no audio files, no licensed music). Lazy: sfx.ts imports this the first
 * time sound is needed after a gesture, so none of it is in the main chunk.
 *
 * The pieces (16 bars each, looping):
 * - planning: calm, F major, 84 bpm — soft keys arpeggio, a bass on 1 and 3, a slow tune every other bar.
 * - service: brisk, A minor, 112 bpm — syncopated bass, off-beat stabs, kick and backbeat. A rush (sfx.setRush) eases
 *   it up to 124 bpm and adds a sixteenth-note hat line.
 * - evening: warm, E-flat major, 72 bpm — held chords, a slow tune, a bass on 1.
 * The room's Music decor item picks the instrument palette (PALETTES): a kitchen radio is tinny and square, jazz
 * speakers swing on soft keys with brushes, the jukebox swings hardest on an organ with a full kit, the grand piano is
 * plucked keys and no drums, a quiet room plays clean keys.
 *
 * Volumes: Settings › Sound is the master; Music and Sound effects scale their own buses. At music volume 0 (or Sound
 * off, or no scene) the scheduler stops, so nothing is scheduled at all. Never touches the sim.
 */
import { getSettings } from "./settings";
import { devSwitches } from "./perfMeter";
import type { MusicWant, Scene, Sfx } from "./sfx";

/** Music bus level at volume 1 (modest: the default 0.4 puts it well under the effects). */
const MUSIC_LEVEL = 0.32;
const SFX_LEVEL = 1;

// ───────────────────────── palettes ─────────────────────────
interface Palette {
  /** Chord/arp voice, tune voice, bass voice. */
  keys: OscillatorType; lead: OscillatorType; bass: OscillatorType;
  /** Delay of each off-beat eighth as a share of a sixteenth (0 = straight, 0.67 = triplet swing). */
  swing: number;
  /** Drum kit level (0 = none) and whether the backbeat is brushes (noise) or a clap. */
  drums: number; brushes: boolean;
  /** Low-pass on the music bus (Hz); `band` adds a high-pass for the radio's tinny sound. */
  cutoff: number; band?: number;
  /** Seconds a keys note rings (a piano plucks, an organ holds). */
  ring: number;
  /** A second keys oscillator detuned by this many cents (0 = none): chorus for soft keys / organ. */
  detune: number;
}
export const PALETTES: Record<string, Palette> = {
  music_none: { keys: "triangle", lead: "sine", bass: "triangle", swing: 0, drums: 0.7, brushes: false, cutoff: 3600, ring: 0.5, detune: 0 },
  music_radio: { keys: "square", lead: "square", bass: "triangle", swing: 0.1, drums: 0.6, brushes: false, cutoff: 2200, band: 420, ring: 0.3, detune: 0 },
  music_speakers: { keys: "sine", lead: "triangle", bass: "sine", swing: 0.5, drums: 0.6, brushes: true, cutoff: 3000, ring: 0.7, detune: 7 },
  music_jukebox: { keys: "sawtooth", lead: "square", bass: "triangle", swing: 0.62, drums: 1, brushes: false, cutoff: 1900, ring: 0.9, detune: 9 },
  music_piano: { keys: "triangle", lead: "triangle", bass: "sine", swing: 0.36, drums: 0, brushes: false, cutoff: 4200, ring: 0.35, detune: 0 },
};
export function paletteFor(id: string): Palette { return PALETTES[id] ?? PALETTES.music_none!; }

// ───────────────────────── the pieces ─────────────────────────
/** A chord: root (MIDI) and intervals in semitones. */
type Chord = [root: number, ...iv: number[]];
const MAJ7 = [0, 4, 7, 11], MIN7 = [0, 3, 7, 10], DOM7 = [0, 4, 7, 10], SIX = [0, 4, 7, 9], SUS = [0, 5, 7, 10], HALF = [0, 3, 6, 10];
const ch = (root: number, iv: number[]): Chord => [root, ...iv];

export interface Piece {
  bpm: number; rushBpm: number;
  /** 16 chords, one a bar. */
  bars: Chord[];
  /** Per sixteenth step of a bar: which voices play (k = keys, b = bass, s = stab, m = tune, K = kick, S = backbeat, h = hat). */
  grid: string[];
  /** Fixed seed for the tune's walk over chord tones (deterministic: the same tune every loop). */
  seed: number;
  /** Bars where the tune rests (it answers rather than talks over everything). */
  tuneBars: (bar: number) => boolean;
  /** Seconds keys notes are held (pads) — 0 = the palette's ring. */
  hold: number;
}

const P = (s: string) => s.split(" ");
export const PIECES: Record<Exclude<Scene, "off">, Piece> = {
  planning: {
    bpm: 84, rushBpm: 84, seed: 11, hold: 0,
    bars: [ch(53, MAJ7), ch(57, MIN7), ch(58, MAJ7), ch(48, SIX), ch(53, MAJ7), ch(50, MIN7), ch(55, MIN7), ch(48, DOM7),
      ch(58, MAJ7), ch(57, MIN7), ch(55, MIN7), ch(53, MAJ7), ch(58, MAJ7), ch(57, MIN7), ch(55, MIN7), ch(48, SUS)],
    grid: P("kbm - k - km - k - kbm - k - km - k -"),
    tuneBars: (b) => b % 2 === 1,
  },
  service: {
    bpm: 112, rushBpm: 124, seed: 29, hold: 0,
    bars: [ch(45, MIN7), ch(50, DOM7), ch(43, MAJ7), ch(48, MAJ7), ch(41, MAJ7), ch(47, HALF), ch(40, DOM7), ch(45, MIN7),
      ch(45, MIN7), ch(50, DOM7), ch(43, MAJ7), ch(48, MAJ7), ch(41, MAJ7), ch(47, HALF), ch(40, DOM7), ch(40, DOM7)],
    grid: P("bKh h sh bmh Sh h bsh h bKmh h sh bh Sh mh bsh h"),
    tuneBars: (b) => b >= 4 && b % 4 !== 3,
  },
  evening: {
    bpm: 72, rushBpm: 72, seed: 5, hold: 2.4,
    bars: [ch(51, MAJ7), ch(48, MIN7), ch(56, MAJ7), ch(46, DOM7), ch(55, MIN7), ch(48, MIN7), ch(53, MIN7), ch(46, DOM7),
      ch(56, MAJ7), ch(55, MIN7), ch(53, MIN7), ch(51, MAJ7), ch(56, MAJ7), ch(55, MIN7), ch(53, MIN7), ch(46, SUS)],
    grid: P("kbm - - - - - - - m - - - - - - -"),
    tuneBars: (b) => b % 4 !== 3,
  },
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** The tune's note at (bar, step): a seeded walk over the bar's chord tones, an octave and a bit above the root. */
export function tuneNote(piece: Piece, bar: number, step: number): number {
  const c = piece.bars[bar % piece.bars.length]!;
  const tones = c.slice(1) as number[];
  let x = (piece.seed * 9301 + bar * 49297 + step * 233) % 233280;
  x = (x * 9301 + 49297) % 233280;
  const i = Math.floor((x / 233280) * (tones.length + 1)) % tones.length;
  return c[0] + tones[i]! + 12 + (c[0] < 48 ? 12 : 0);
}

// ───────────────────────── engine state ─────────────────────────
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let tone: BiquadFilterNode | null = null;
let band: BiquadFilterNode | null = null;
let sfxBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let current: MusicWant = { scene: "off", rush: false, palette: "music_none" };
let nextTime = 0;
let step = 0;
let bpm = 84;
let notes = 0;

function buses(c: AudioContext) {
  if (ctx === c && master) return;
  ctx = c;
  master = c.createGain(); master.gain.value = 1;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(c.destination);
  musicBus = c.createGain(); musicBus.gain.value = 0;
  tone = c.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 3600; tone.Q.value = 0.4;
  band = c.createBiquadFilter(); band.type = "highpass"; band.frequency.value = 20;
  musicBus.connect(tone).connect(band).connect(master);
  sfxBus = c.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
  const len = Math.floor(c.sampleRate * 0.5);
  noiseBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < len; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
  if (devSwitches()) (window as unknown as { __fpMusic?: unknown }).__fpMusic = status;
}

/** What the engine is doing (tests; and `window.__fpMusic()` in a playtest, dev switch only). */
export function musicStatus() { return status(); }
function status() {
  return { scene: current.scene, rush: current.rush, palette: current.palette, bpm: Math.round(bpm), running: timer !== null, notes, gain: musicBus?.gain.value ?? 0, sfxGain: sfxBus?.gain.value ?? 0, state: ctx?.state ?? "none" };
}

/** Bring the engine in line with what the game wants and with Settings (volumes, master). */
export function sync(c: AudioContext, want: MusicWant): void {
  try {
    buses(c);
    const s = getSettings();
    const vol = s.sound ? s.musicVolume : 0;
    const playing = vol > 0 && want.scene !== "off";
    const now = c.currentTime;
    const changed = want.scene !== current.scene;
    current = { ...want };
    const pal = paletteFor(want.palette);
    tone!.frequency.setTargetAtTime(pal.cutoff, now, 0.05);
    band!.frequency.setTargetAtTime(pal.band ?? 20, now, 0.05);
    sfxBus!.gain.setTargetAtTime((s.sound ? s.sfxVolume : 0) * SFX_LEVEL, now, 0.02);
    const g = musicBus!.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(playing ? vol * MUSIC_LEVEL : 0, now + (playing ? 0.6 : 0.12));
    if (!playing) { stop(); return; }
    if (changed || !timer) { step = 0; nextTime = now + 0.08; bpm = PIECES[want.scene as Exclude<Scene, "off">].bpm; }
    if (!timer) timer = setInterval(schedule, 50);
  } catch { /* never break the game */ }
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Look-ahead scheduler: queue every sixteenth that starts in the next 0.2 s. */
function schedule() {
  const c = ctx;
  if (!c || current.scene === "off") return;
  const piece = PIECES[current.scene];
  const target = current.rush ? piece.rushBpm : piece.bpm;
  bpm += (target - bpm) * 0.08; // ease the tempo (a rush comes in over a couple of bars)
  if (c.currentTime > nextTime + 1) nextTime = c.currentTime + 0.05; // tab was asleep: don't burst
  while (nextTime < c.currentTime + 0.2) {
    playStep(c, piece, step, nextTime);
    nextTime += 60 / bpm / 4;
    step = (step + 1) % (piece.bars.length * 16);
  }
}

function playStep(c: AudioContext, piece: Piece, n: number, t0: number) {
  const pal = paletteFor(current.palette);
  const bar = Math.floor(n / 16), s = n % 16;
  const sixteenth = 60 / bpm / 4;
  // swing: the off-beat eighth ("and") is late; odd sixteenths a little
  const t = t0 + (s % 4 === 2 ? pal.swing : s % 2 === 1 ? pal.swing / 2 : 0) * sixteenth;
  const chord = piece.bars[bar]!;
  const cell = piece.grid[s] ?? "-";
  const root = chord[0];
  const tones = chord.slice(1) as number[];
  for (const v of cell) {
    switch (v) {
      case "k": { // keys: an arpeggio (or a held pad)
        if (piece.hold) for (const iv of tones) voice(c, pal.keys, hz(root + 12 + iv), t, piece.hold, 0.05, 0.4, pal.detune);
        else voice(c, pal.keys, hz(root + 12 + tones[(s / 2) % tones.length]!), t, pal.ring, 0.07, 0.01, pal.detune);
        break;
      }
      case "b": voice(c, pal.bass, hz(root - 12 + (s >= 8 && current.scene === "service" && s % 4 === 2 ? 7 : 0)), t, current.scene === "service" ? 0.22 : 0.6, 0.16, 0.01, 0); break;
      case "s": for (const iv of tones.slice(1)) voice(c, pal.keys, hz(root + 12 + iv), t, 0.12, 0.045, 0.005, pal.detune); break;
      case "m": if (piece.tuneBars(bar)) voice(c, pal.lead, hz(tuneNote(piece, bar, s)), t, piece.hold ? 1.4 : 0.45, 0.06, 0.02, 0); break;
      case "K": if (pal.drums) kick(c, t, 0.5 * pal.drums); break;
      case "S": if (pal.drums) hit(c, t, pal.brushes ? 0.18 : 0.09, pal.brushes ? 0.07 * pal.drums : 0.12 * pal.drums, pal.brushes ? 1800 : 1200); break;
      case "h": if (pal.drums && (current.rush || s % 4 === 2)) hit(c, t, 0.03, (current.rush ? 0.05 : 0.035) * pal.drums, 7000); break;
    }
  }
  // the rush adds a second kick on the "and" of 3
  if (current.rush && pal.drums && s === 10) kick(c, t, 0.35 * pal.drums);
}

/** One note: an oscillator (plus an optional detuned twin) through a short envelope into the music bus. */
function voice(c: AudioContext, type: OscillatorType, f: number, t: number, dur: number, vel: number, attack: number, detune: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vel, t + Math.max(0.005, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  g.connect(musicBus!);
  const oscs = detune ? [0, detune] : [0];
  for (const d of oscs) {
    const o = c.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = d;
    o.connect(g); o.start(t); o.stop(t + attack + dur + 0.05);
  }
  notes++;
}

function kick(c: AudioContext, t: number, vel: number) {
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  o.connect(g).connect(musicBus!); o.start(t); o.stop(t + 0.2);
  notes++;
}

/** A noise hit through a high-pass: hats (short, bright), claps, brushes (longer, darker). */
function hit(c: AudioContext, t: number, dur: number, vel: number, hp: number, dest: AudioNode = musicBus!) {
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = hp;
  g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest); src.start(t, (t * 7.3) % 0.4); src.stop(t + dur + 0.02);
  notes++;
}

// ───────────────────────── effects ─────────────────────────
/** [type, frequency Hz, start s, length s, level] per note. */
type Blip = [OscillatorType, number, number, number, number];
export const SFX: Record<Sfx, Blip[]> = {
  tap: [["triangle", 660, 0, 0.22, 0.05]],
  good: [["triangle", 523.25, 0, 0.22, 0.09], ["triangle", 783.99, 0.09, 0.22, 0.09]],
  open: [["triangle", 392, 0, 0.22, 0.09], ["triangle", 523.25, 0.08, 0.22, 0.09], ["triangle", 659.25, 0.16, 0.22, 0.09]],
  win: [["triangle", 523.25, 0, 0.5, 0.09], ["triangle", 659.25, 0.12, 0.5, 0.09], ["triangle", 783.99, 0.24, 0.5, 0.09], ["triangle", 1046.5, 0.38, 0.5, 0.09]],
  // the pass bell: a bright strike with an overtone
  orderUp: [["sine", 1318.5, 0, 0.35, 0.06], ["sine", 2637, 0, 0.18, 0.025]],
  // the till: a click (noise, below) and two quick high notes
  paid: [["triangle", 1567.98, 0.02, 0.12, 0.05], ["triangle", 2093, 0.07, 0.2, 0.05]],
  // a five-star review: three soft rising notes
  review: [["sine", 1046.5, 0, 0.18, 0.05], ["sine", 1318.5, 0.07, 0.18, 0.05], ["sine", 1567.98, 0.14, 0.3, 0.05]],
  // 86: two low, falling, muted notes
  eightySix: [["square", 392, 0, 0.1, 0.03], ["square", 329.63, 0.09, 0.16, 0.03]],
  // a rush starts: a quick rising pair; ends: the same pair falling, softer
  rushOn: [["sawtooth", 440, 0, 0.1, 0.03], ["sawtooth", 659.25, 0.08, 0.16, 0.03]],
  rushOff: [["triangle", 659.25, 0, 0.12, 0.04], ["triangle", 440, 0.1, 0.2, 0.04]],
};

export function sfx(c: AudioContext, kind: Sfx): void {
  try {
    buses(c);
    const s = getSettings();
    sfxBus!.gain.setValueAtTime((s.sound ? s.sfxVolume : 0) * SFX_LEVEL, c.currentTime);
    const t0 = c.currentTime + 0.01;
    for (const [type, f, at, dur, vel] of SFX[kind]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(vel, t0 + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(sfxBus!); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
    }
    if (kind === "paid") hit(c, t0, 0.04, 0.06, 3000, sfxBus!);
  } catch { /* never break the game */ }
}
