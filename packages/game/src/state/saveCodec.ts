/**
 * Round 9: packing a save for the device cache, the account and save files — gzip (CompressionStream) then base64,
 * or plain base64 of the UTF-8 where the browser has no CompressionStream. A lazy chunk (saveStore.ts loads it on
 * the first save or the first packed read).
 */
import { hasCompression, MAX_UNPACKED, type Encoding } from "./saveStore";

/** Round 11 (S4): the text is bigger than a save can be (a gzip bomb, or a base64 blob too big to decode). */
export class TooBig extends Error {}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}
function fromB64(b64: string, max: number): Uint8Array {
  // Checked before atob: base64 is 4 characters per 3 bytes.
  if (b64.length > Math.ceil(max / 3) * 4) throw new TooBig("too big");
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function pipe(bytes: Uint8Array, stream: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> }, maxBytes = Infinity): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  let stop = false;
  // Round 11 (S4): the input goes in small slices, so a bomb can't inflate far past the cap inside the stream either.
  void (async () => {
    try {
      for (let i = 0; i < bytes.length && !stop; i += 0x4000) await w.write(bytes.subarray(i, i + 0x4000) as BufferSource);
      if (!stop) await w.close();
    } catch { /* aborted */ }
  })();
  const r = stream.readable.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    // Stop inflating the moment it passes the cap (a 1.4 MB file used to become 1 GiB here).
    if (n > maxBytes) { stop = true; void r.cancel().catch(() => {}); void w.abort().catch(() => {}); throw new TooBig("too big"); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  n = 0;
  for (const p of parts) { out.set(p, n); n += p.length; }
  return out;
}

/** Raw envelope → packed text. gzip where the browser has CompressionStream, else plain base64. */
export async function pack(raw: string, compress = hasCompression()): Promise<{ encoding: "gzip-b64" | "b64"; data: string }> {
  const bytes = new TextEncoder().encode(raw);
  if (compress) {
    try { return { encoding: "gzip-b64", data: toB64(await pipe(bytes, new CompressionStream("gzip"))) }; } catch { /* fall through */ }
  }
  return { encoding: "b64", data: toB64(bytes) };
}

/** Packed text → raw envelope, at most `maxBytes` of it (default: a save file's cap). Throws TooBig past it. */
export async function unpack(encoding: Encoding, data: string, maxBytes = MAX_UNPACKED): Promise<string> {
  if (encoding === "json") { if (data.length > maxBytes) throw new TooBig("too big"); return data; }
  const bytes = fromB64(data, maxBytes);
  if (encoding === "b64") return new TextDecoder().decode(bytes);
  if (!hasCompression()) throw new Error("This browser can't open compressed saves");
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream("gzip"), maxBytes));
}
