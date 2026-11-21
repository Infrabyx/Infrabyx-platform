// SSH key handling for the FILE_TRANSFER `sftp` adapter (C-29: Ed25519 SSH client authentication and
// the SSH transport, used on the owner's instruction of 21 Nov 2026 07:30 IST, R1-D-249, R1-D-254).
// The SSH protocol itself (key exchange, the transport cipher, the user-authentication signature and
// the host key's signature check) runs inside the `ssh2` library on `node:crypto`, behind the port in
// `@infrabyx/connectors`. What the platform's own code does with keys is here, on `node:crypto` only:
//
//   * `sshHostKeyFingerprint`: the OpenSSH `SHA256:` fingerprint of a public-key blob (RFC 4253 §6.6
//     encoding; SHA-256, unpadded base64, as `ssh-keygen -l -E sha256` prints it);
//   * `sshHostKeyPinned`: whether a host key matches one of the pinned fingerprints, compared in
//     constant time (no trust on first use: nothing is ever learnt from the server);
//   * `assertSshEd25519PrivateKey`: a client key from SECRETS is exactly one unencrypted OpenSSH
//     `ssh-ed25519` private key (PROTOCOL.key: `openssh-key-v1`, cipher and KDF `none`, equal check
//     integers, the public half derived from the seed), else an `SshKeyError` with a fixed reason;
//   * `generateSshEd25519KeyPair`: a new key pair in OpenSSH form, for tests and operators' tooling.
//
// Nothing here logs, returns or puts in an error any key material.
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  timingSafeEqual,
} from "node:crypto";
import { sha256 } from "./hash.js";
import { randomBytes } from "./random.js";

/** The only key type this module accepts or makes. */
export const SSH_ED25519 = "ssh-ed25519";
/** An OpenSSH SHA-256 fingerprint: `SHA256:` and 43 characters of unpadded base64. */
export const SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

const MAGIC = Buffer.from("openssh-key-v1\0", "latin1");
const PEM_BEGIN = "-----BEGIN OPENSSH PRIVATE KEY-----";
const PEM_END = "-----END OPENSSH PRIVATE KEY-----";
/** PKCS #8 prefix of an Ed25519 private key (RFC 8410 §7), followed by the 32-byte seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
/** Largest key file read (an Ed25519 key is about 400 bytes; this bounds the parse). */
const MAX_KEY_CHARS = 8192;

export type SshKeyFailure =
  | "format" // not one OpenSSH private key in PEM armour, or a malformed structure
  | "encrypted" // protected by a passphrase (the key's protection is the vault's, not a passphrase)
  | "key_type" // not ssh-ed25519
  | "key_count" // more than one key in the file
  | "mismatch"; // the check integers differ, or the public half is not the seed's

/** A refused SSH key, with a fixed reason and nothing of the key. */
export class SshKeyError extends Error {
  constructor(readonly reason: SshKeyFailure) {
    super(`ssh key refused: ${reason}`);
    this.name = "SshKeyError";
  }
}

class Reader {
  private at = 0;
  constructor(private readonly b: Buffer) {}
  u32(): number {
    if (this.at + 4 > this.b.length) throw new SshKeyError("format");
    const v = this.b.readUInt32BE(this.at);
    this.at += 4;
    return v;
  }
  string(): Buffer {
    const n = this.u32();
    if (n > this.b.length - this.at) throw new SshKeyError("format");
    const v = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return v;
  }
  rest(): Buffer {
    return this.b.subarray(this.at);
  }
  done(): boolean {
    return this.at === this.b.length;
  }
}

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};
const sshString = (v: Uint8Array | string): Buffer => {
  const b = typeof v === "string" ? Buffer.from(v, "utf8") : Buffer.from(v);
  return Buffer.concat([u32(b.length), b]);
};

/** The RFC 8709 public-key blob of an Ed25519 public key (32 bytes). */
export function sshEd25519PublicBlob(publicKey: Uint8Array): Uint8Array {
  if (publicKey.byteLength !== 32) throw new SshKeyError("format");
  return new Uint8Array(Buffer.concat([sshString(SSH_ED25519), sshString(publicKey)]));
}

/** The key type named at the start of a public-key blob, or null when it is not one. */
export function sshPublicKeyType(blob: Uint8Array): string | null {
  try {
    const t = new Reader(Buffer.from(blob)).string();
    return /^[a-z0-9@.-]{1,64}$/.test(t.toString("latin1")) ? t.toString("latin1") : null;
  } catch {
    return null;
  }
}

/** OpenSSH's SHA-256 fingerprint of a public-key blob: `SHA256:` + unpadded base64. */
export function sshHostKeyFingerprint(blob: Uint8Array): string {
  return `SHA256:${Buffer.from(sha256(blob)).toString("base64").replace(/=+$/, "")}`;
}

/**
 * Whether the host key `blob` matches one of `pins` (OpenSSH `SHA256:` fingerprints). Every pin is
 * compared in constant time; a malformed pin never matches. No pin, no match: there is no first use.
 */
export function sshHostKeyPinned(blob: Uint8Array, pins: readonly string[]): boolean {
  const fp = Buffer.from(sshHostKeyFingerprint(blob), "latin1");
  let ok = false;
  for (const p of pins) {
    if (typeof p !== "string" || !SSH_FINGERPRINT.test(p)) continue;
    const b = Buffer.from(p, "latin1");
    if (b.length === fp.length && timingSafeEqual(b, fp)) ok = true;
  }
  return ok;
}

function ed25519PublicFromSeed(seed: Uint8Array): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x?: string };
  return Buffer.from(jwk.x ?? "", "base64url");
}

/** What a checked client key tells the caller: its public half, never the private one. */
export interface SshEd25519KeyInfo {
  /** `ssh-ed25519 <base64>` (an authorized_keys line without a comment). */
  publicKey: string;
  /** The public key's OpenSSH SHA-256 fingerprint. */
  fingerprint: string;
}

/**
 * Check that `text` is exactly one unencrypted OpenSSH `ssh-ed25519` private key; throws an
 * `SshKeyError` otherwise. The key itself is not returned: the caller passes `text` to the SSH
 * library unchanged.
 */
export function assertSshEd25519PrivateKey(text: string): SshEd25519KeyInfo {
  if (typeof text !== "string" || text.length > MAX_KEY_CHARS) throw new SshKeyError("format");
  const t = text.trim();
  if (!t.startsWith(PEM_BEGIN) || !t.endsWith(PEM_END)) throw new SshKeyError("format");
  const body = t.slice(PEM_BEGIN.length, t.length - PEM_END.length).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new SshKeyError("format");
  const raw = Buffer.from(body, "base64");
  if (raw.length < MAGIC.length || !raw.subarray(0, MAGIC.length).equals(MAGIC))
    throw new SshKeyError("format");
  const r = new Reader(raw.subarray(MAGIC.length));
  const cipher = r.string().toString("latin1");
  const kdf = r.string().toString("latin1");
  r.string(); // KDF options
  if (cipher !== "none" || kdf !== "none") throw new SshKeyError("encrypted");
  const count = r.u32();
  if (count !== 1) throw new SshKeyError(count === 0 ? "format" : "key_count");
  const pubBlob = r.string();
  const priv = r.string();
  if (!r.done()) throw new SshKeyError("format");
  const pub = new Reader(pubBlob);
  if (pub.string().toString("latin1") !== SSH_ED25519) throw new SshKeyError("key_type");
  const pk = pub.string();
  if (!pub.done() || pk.length !== 32) throw new SshKeyError("format");

  if (priv.length % 8 !== 0) throw new SshKeyError("format");
  const p = new Reader(priv);
  if (p.u32() !== p.u32()) throw new SshKeyError("mismatch");
  if (p.string().toString("latin1") !== SSH_ED25519) throw new SshKeyError("key_type");
  const pk2 = p.string();
  const sk = p.string(); // seed (32) || public key (32)
  p.string(); // comment
  const pad = p.rest();
  if (pad.length >= 8 || !pad.every((x, i) => x === i + 1)) throw new SshKeyError("format");
  if (sk.length !== 64 || !pk2.equals(pk) || !sk.subarray(32).equals(pk))
    throw new SshKeyError("mismatch");
  if (!ed25519PublicFromSeed(sk.subarray(0, 32)).equals(pk)) throw new SshKeyError("mismatch");
  const blob = sshEd25519PublicBlob(pk);
  return {
    publicKey: `${SSH_ED25519} ${Buffer.from(blob).toString("base64")}`,
    fingerprint: sshHostKeyFingerprint(blob),
  };
}

/** A new Ed25519 key pair in OpenSSH form. */
export interface SshEd25519KeyPair extends SshEd25519KeyInfo {
  /** The unencrypted OpenSSH private key (PEM armour). Store it in SECRETS; never log it. */
  privateKey: string;
  /** The public key's RFC 8709 blob (what a server presents as its host key). */
  publicBlob: Uint8Array;
}

/** Make an Ed25519 key pair in OpenSSH form (`ssh-keygen -t ed25519 -N ''` equivalent). */
export function generateSshEd25519KeyPair(comment = ""): SshEd25519KeyPair {
  if (!/^[\x20-\x7e]{0,64}$/.test(comment)) throw new SshKeyError("format");
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as { d?: string; x?: string };
  const seed = Buffer.from(jwk.d ?? "", "base64url");
  const pk = Buffer.from(jwk.x ?? "", "base64url");
  const blob = sshEd25519PublicBlob(pk);
  const check = randomBytes(4);
  let priv = Buffer.concat([
    Buffer.from(check),
    Buffer.from(check),
    sshString(SSH_ED25519),
    sshString(pk),
    sshString(Buffer.concat([seed, pk])),
    sshString(comment),
  ]);
  const padLen = (8 - (priv.length % 8)) % 8;
  priv = Buffer.concat([priv, Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1))]);
  const raw = Buffer.concat([
    MAGIC,
    sshString("none"),
    sshString("none"),
    sshString(""),
    u32(1),
    sshString(blob),
    sshString(priv),
  ]);
  const b64 = raw.toString("base64");
  const lines = b64.match(/.{1,70}/g) ?? [];
  seed.fill(0);
  priv.fill(0);
  raw.fill(0);
  return {
    privateKey: `${PEM_BEGIN}\n${lines.join("\n")}\n${PEM_END}\n`,
    publicKey: `${SSH_ED25519} ${Buffer.from(blob).toString("base64")}${comment ? ` ${comment}` : ""}`,
    fingerprint: sshHostKeyFingerprint(blob),
    publicBlob: blob,
  };
}
