// C-29 (PR-UDF-071, R1-D-254): SSH key parsing, fingerprints and host-key pins for FILE_TRANSFER sftp.
import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { algorithmInfo, assertApproved } from "./registry.js";
import {
  SSH_FINGERPRINT,
  SshKeyError,
  assertSshEd25519PrivateKey,
  generateSshEd25519KeyPair,
  sshEd25519PublicBlob,
  sshHostKeyFingerprint,
  sshHostKeyPinned,
  sshPublicKeyType,
} from "./ssh.js";

const reason = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof SshKeyError ? e.reason : `other: ${(e as Error).message}`;
  }
  return undefined;
};

/** Rebuild the PEM with the decoded body changed by `edit`. */
function rewrap(pem: string, edit: (raw: Buffer) => Buffer): string {
  const body = pem
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/\s+/g, "")
    .trim();
  const raw = edit(Buffer.from(body, "base64"));
  const lines = raw.toString("base64").match(/.{1,70}/g) ?? [];
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

describe("SSH keys (C-29)", () => {
  it("makes an OpenSSH Ed25519 key that checks, with a matching public key and fingerprint", () => {
    const k = generateSshEd25519KeyPair("contract");
    expect(k.privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
    expect(k.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+=* contract$/);
    expect(k.fingerprint).toMatch(SSH_FINGERPRINT);
    const info = assertSshEd25519PrivateKey(k.privateKey);
    expect(info.fingerprint).toBe(k.fingerprint);
    expect(k.publicKey.startsWith(info.publicKey)).toBe(true);
    expect(sshPublicKeyType(k.publicBlob)).toBe("ssh-ed25519");
    // The fingerprint is ssh-keygen's: SHA-256 of the blob, unpadded base64.
    const expected = createHash("sha256").update(k.publicBlob).digest("base64").replace(/=+$/, "");
    expect(k.fingerprint).toBe(`SHA256:${expected}`);
    expect(JSON.stringify(info)).not.toContain(k.privateKey.slice(40, 80));
  });

  it("pins host keys by fingerprint only, in constant time; no pin, no match", () => {
    const a = generateSshEd25519KeyPair();
    const b = generateSshEd25519KeyPair();
    expect(sshHostKeyPinned(a.publicBlob, [a.fingerprint])).toBe(true);
    expect(sshHostKeyPinned(a.publicBlob, [b.fingerprint, a.fingerprint])).toBe(true);
    expect(sshHostKeyPinned(a.publicBlob, [b.fingerprint])).toBe(false);
    expect(sshHostKeyPinned(a.publicBlob, [])).toBe(false);
    expect(sshHostKeyPinned(a.publicBlob, [a.fingerprint.toLowerCase()])).toBe(false);
    expect(sshHostKeyPinned(a.publicBlob, [`${a.fingerprint}=`])).toBe(false);
    expect(sshHostKeyFingerprint(sshEd25519PublicBlob(new Uint8Array(32)))).toMatch(
      SSH_FINGERPRINT,
    );
  });

  it("refuses anything but one unencrypted ssh-ed25519 key, with fixed reasons", () => {
    const k = generateSshEd25519KeyPair();
    expect(reason(() => assertSshEd25519PrivateKey("not a key"))).toBe("format");
    expect(reason(() => assertSshEd25519PrivateKey("x".repeat(9000)))).toBe("format");
    // A PKCS #8 Ed25519 key is not the OpenSSH form.
    const pkcs8 = generateKeyPairSync("ed25519")
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    expect(reason(() => assertSshEd25519PrivateKey(pkcs8))).toBe("format");
    // Encrypted (cipher aes256-ctr, KDF bcrypt): refused before anything else is read.
    const enc = rewrap(k.privateKey, (raw) => {
      const magic = raw.subarray(0, 15);
      const rest = raw.subarray(15 + 4 + 4 + 4 + 4 + 4); // after none, none, ""
      const s = (v: string) => {
        const b = Buffer.from(v);
        const l = Buffer.alloc(4);
        l.writeUInt32BE(b.length);
        return Buffer.concat([l, b]);
      };
      return Buffer.concat([magic, s("aes256-ctr"), s("bcrypt"), s(""), rest]);
    });
    expect(reason(() => assertSshEd25519PrivateKey(enc))).toBe("encrypted");
    // A changed check integer, and a public half that is not the seed's.
    const badCheck = rewrap(k.privateKey, (raw) => {
      const r = Buffer.from(raw);
      const at = raw.length - findPrivLen(raw);
      r[at] = (r[at] ?? 0) ^ 0xff;
      return r;
    });
    expect(reason(() => assertSshEd25519PrivateKey(badCheck))).toBe("mismatch");
    const other = generateSshEd25519KeyPair();
    const swapped = rewrap(k.privateKey, (raw) => {
      // Put another key's public half in both public fields (outer blob and inner copy).
      const pk = publicOf(raw);
      const pk2 = publicOf(Buffer.from(bodyOf(other.privateKey), "base64"));
      return replaceAll(replaceFirstN(raw, pk, pk2, 3), pk, pk2);
    });
    expect(reason(() => assertSshEd25519PrivateKey(swapped))).toBe("mismatch");
  });

  it("registers SSH Ed25519, X25519 and ChaCha20-Poly1305 for SSH only; generic ed25519 stays planned", () => {
    expect(assertApproved("ssh-ed25519", "signature").usedFor.join(" ")).toContain("C-29");
    expect(assertApproved("curve25519-sha256", "key-agreement").usedFor.join(" ")).toContain(
      "C-29",
    );
    expect(assertApproved("chacha20-poly1305", "aead").usedFor.join(" ")).toContain("C-29");
    expect(algorithmInfo("ed25519")?.status).toBe("planned");
    expect(() => assertApproved("ed25519", "signature")).toThrow(/not approved/);
    for (const id of ["aes-256-gcm", "sha-256", "sha-512", "hmac-sha-256"])
      expect(algorithmInfo(id)?.usedFor.some((u) => u.includes("C-29"))).toBe(true);
  });
});

function bodyOf(pem: string): string {
  return pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
}
/** Length of the private section (the last string of the file). */
function findPrivLen(raw: Buffer): number {
  // magic(15) | none | none | "" | nkeys | pubblob | priv
  let at = 15;
  for (let i = 0; i < 3; i++) at += 4 + raw.readUInt32BE(at);
  at += 4;
  at += 4 + raw.readUInt32BE(at);
  return raw.length - (at + 4);
}
function publicOf(raw: Buffer): Buffer {
  let at = 15;
  for (let i = 0; i < 3; i++) at += 4 + raw.readUInt32BE(at);
  at += 4 + 4; // nkeys, blob length
  at += 4 + raw.readUInt32BE(at); // "ssh-ed25519"
  return raw.subarray(at + 4, at + 4 + 32);
}
function replaceFirstN(b: Buffer, from: Buffer, to: Buffer, n: number): Buffer {
  const out = Buffer.from(b);
  let i = 0;
  let at = out.indexOf(from);
  while (at >= 0 && i < n) {
    to.copy(out, at);
    at = out.indexOf(from, at + from.length);
    i++;
  }
  return out;
}
function replaceAll(b: Buffer, from: Buffer, to: Buffer): Buffer {
  return replaceFirstN(b, from, to, 10);
}
