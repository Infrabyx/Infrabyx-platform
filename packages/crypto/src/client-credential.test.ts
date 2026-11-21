// The platform's outbound mTLS client credential check (PR-UDF-069, R1-D-250). Every certificate
// and key is made at test time by `@infrabyx/crypto/mtls-test` or node:crypto; none is committed.
import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CLIENT_CREDENTIAL_REFUSALS,
  checkClientCredential,
  type ClientCredentialResult,
} from "./client-credential.js";
import { mtlsTestAuthority } from "./mtls-test.js";
import { ALGORITHMS } from "./registry.js";

const DAY = 86_400_000;
const root = mtlsTestAuthority({ CN: "Platform Client Test Root" });
const notBefore = new Date(Math.floor((Date.now() - DAY) / 1000) * 1000);
const notAfter = new Date(Math.floor((Date.now() + 30 * DAY) / 1000) * 1000);
const leaf = root.issue({ CN: "platform-client" }, { notBefore, notAfter });
const refused = (r: ClientCredentialResult) => (r.ok ? "ok" : r.reason);
const pem = (k: { privateKey: { export(o: object): string | Buffer } }) =>
  k.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("checkClientCredential", () => {
  it("answers the dates and the binding values of a usable P-256 credential, never the key", () => {
    const r = checkClientCredential(leaf.certPem, leaf.keyPem);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const digest = createHash("sha256").update(leaf.der).digest();
    expect(r.credential).toEqual({
      notBefore: notBefore.toISOString(),
      notAfter: notAfter.toISOString(),
      x5tS256: digest.toString("base64url"),
      fingerprintSha256: digest.toString("hex"),
    });
    expect(JSON.stringify(r)).not.toContain("PRIVATE KEY");
  });

  it("accepts a chain after the leaf (the leaf is the first certificate)", () => {
    expect(refused(checkClientCredential(leaf.certPem + root.certPem, leaf.keyPem))).toBe("ok");
  });

  it("refuses an unparsable certificate or key", () => {
    expect(refused(checkClientCredential("not a certificate", leaf.keyPem))).toBe(
      "certificate_unparsable",
    );
    expect(refused(checkClientCredential(leaf.certPem, "not a key"))).toBe("key_unparsable");
    const encrypted = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .privateKey.export({
        type: "pkcs8",
        format: "pem",
        cipher: "aes-256-cbc",
        passphrase: "test-only-passphrase",
      })
      .toString();
    expect(refused(checkClientCredential(leaf.certPem, encrypted))).toBe("key_unparsable");
  });

  it("refuses a key that is not P-256 (owner question #180)", () => {
    const rsa = pem(generateKeyPairSync("rsa", { modulusLength: 2048 }));
    const p384 = pem(generateKeyPairSync("ec", { namedCurve: "secp384r1" }));
    const ed = pem(generateKeyPairSync("ed25519"));
    for (const k of [rsa, p384, ed])
      expect(refused(checkClientCredential(leaf.certPem, k))).toBe("key_type");
  });

  it("refuses a key that is not the certificate's", () => {
    const other = root.issue({ CN: "someone-else" });
    expect(refused(checkClientCredential(leaf.certPem, other.keyPem))).toBe("key_mismatch");
  });

  it("refuses a leaf whose extended key usage excludes client authentication", () => {
    const serverOnly = root.issue({ CN: "server" }, { extendedKeyUsage: ["serverAuth"] });
    expect(refused(checkClientCredential(serverOnly.certPem, serverOnly.keyPem))).toBe(
      "not_client_certificate",
    );
    const noEku = root.issue({ CN: "no-eku" }, { extendedKeyUsage: [] });
    expect(refused(checkClientCredential(noEku.certPem, noEku.keyPem))).toBe("ok");
  });

  it("refuses a certificate outside its validity window by the given clock", () => {
    expect(
      refused(checkClientCredential(leaf.certPem, leaf.keyPem, { now: notBefore.getTime() - 1 })),
    ).toBe("not_yet_valid");
    expect(refused(checkClientCredential(leaf.certPem, leaf.keyPem, { now: notAfter }))).toBe(
      "expired",
    );
  });

  it("lists every refusal label", () => {
    expect(CLIENT_CREDENTIAL_REFUSALS).toEqual([
      "certificate_unparsable",
      "key_unparsable",
      "key_type",
      "key_mismatch",
      "not_client_certificate",
      "not_yet_valid",
      "expired",
    ]);
  });

  it("records the use under the approved ECDSA P-256 entry", () => {
    const used = ALGORITHMS.find((a) => a.id === "ecdsa-p256-sha256")!.usedFor.join("\n");
    expect(used).toContain("outbound partner mTLS client authentication");
  });
});
