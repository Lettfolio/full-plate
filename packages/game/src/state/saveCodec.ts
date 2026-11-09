/**
 * Round 9: packing a save for the device cache, the account and save files — gzip (CompressionStream) then base64,
 * or plain base64 of the UTF-8 where the browser has no CompressionStream. A lazy chunk (saveStore.ts loads it on
 * the first save or the first packed read).
 */
import { hasCompression, type Encoding } from "./saveStore";

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function pipe(bytes: Uint8Array, stream: { writable: WritableStream<BufferSource>; readable: ReadableStream<Uint8Array> }): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(bytes as BufferSource).catch(() => {}); void w.close().catch(() => {});
  const r = stream.readable.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); n += value.length; }
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

export async function unpack(encoding: Encoding, data: string): Promise<string> {
  if (encoding === "json") return data;
  const bytes = fromB64(data);
  if (encoding === "b64") return new TextDecoder().decode(bytes);
  if (!hasCompression()) throw new Error("This browser can't open compressed saves");
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream("gzip")));
}
