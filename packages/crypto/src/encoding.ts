// Byte helpers. No cryptography here; kept beside it so callers import one package.
export type BytesLike = string | Uint8Array;

const enc = new TextEncoder();

/** UTF-8 encode strings; pass bytes through. */
export function toBytes(v: BytesLike): Uint8Array {
  return typeof v === "string" ? enc.encode(v) : v;
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("hex");
}

export function fromHex(h: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(h)) throw new Error("invalid hex");
  return new Uint8Array(Buffer.from(h, "hex"));
}

export function toBase64Url(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("base64url");
}

export function fromBase64Url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}
