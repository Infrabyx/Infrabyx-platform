// Partner mTLS client certificates (PR-UDF-064, R1-D-238; IPB-10-16, IPB-10-17; RFC 8705 §3.1).
// Every certificate is made at test time by `@infrabyx/crypto/mtls-test`; no key is committed.
import { createHash, X509Certificate } from "node:crypto";
import { once } from "node:events";
import { connect, createServer, type TLSSocket } from "node:tls";
import { describe, expect, it } from "vitest";
import {
  CLIENT_CERT_MAX_HEADER_BYTES,
  CLIENT_CERT_REFUSALS,
  PinnedCaSet,
  readClientCertificate,
  type ClientCertResult,
} from "./client-cert.js";
import { ALGORITHMS } from "./registry.js";
import { edgeHeaderValueForTest, mtlsTestAuthority } from "./mtls-test.js";

const root = mtlsTestAuthority({ CN: "Partner Test Root", O: "Partner Test", C: "IN" });
const leaf = root.issue({ CN: "partner-client-01", O: "Partner Test" });
const enc = edgeHeaderValueForTest;

const refused = (r: ClientCertResult) => (r.ok ? "ok" : r.reason);

describe("readClientCertificate: the edge header (pem-url)", () => {
  it("reads x5t#S256, the validity window, subject, issuer and serial from one leaf", () => {
    const r = readClientCertificate({ header: enc(leaf.certPem) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const digest = createHash("sha256").update(leaf.der).digest();
    const x = new X509Certificate(leaf.der);
    expect(r.certificate).toEqual({
      x5tS256: digest.toString("base64url"),
      fingerprintSha256: digest.toString("hex"),
      notBefore: x.validFromDate.toISOString(),
      notAfter: x.validToDate.toISOString(),
      subject: "O=Partner Test\nCN=partner-client-01",
      issuer: "C=IN\nO=Partner Test\nCN=Partner Test Root",
      serialNumber: x.serialNumber.toUpperCase(),
      source: "edge",
      tlsAuthorized: null,
      chain: "not_checked",
    });
    // RFC 8705 §3.1: base64url, no padding, 43 characters for SHA-256.
    expect(r.certificate.x5tS256).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("percent-decodes only: a literal + stays a base64 character (ALB's +=/ safe characters)", () => {
    // A leaf whose base64 holds a "+" (most do; the key is random).
    let plus = leaf;
    while (!plus.certPem.includes("+")) plus = root.issue({ CN: "partner-client-01" });
    const albStyle = encodeURIComponent(plus.certPem)
      .replace(/%2B/g, "+")
      .replace(/%3D/g, "=")
      .replace(/%2F/g, "/");
    expect(readClientCertificate({ header: albStyle }).ok).toBe(true);
    // A form-decoder would turn + into a space; the PEM would then not round-trip.
    expect(refused(readClientCertificate({ header: albStyle.replace(/\+/g, " ") }))).not.toBe("ok");
  });

  it("accepts the header as a one-element array (Node's headersDistinct)", () => {
    expect(readClientCertificate({ header: [enc(leaf.certPem)] }).ok).toBe(true);
  });

  it("refuses with fixed labels and never echoes the value", () => {
    const other = root.issue({ CN: "partner-client-02" });
    const cases: [string | readonly string[] | undefined, string][] = [
      [undefined, "no_certificate"],
      ["", "no_certificate"],
      ["   ", "no_certificate"],
      [[], "no_certificate"],
      ["x".repeat(CLIENT_CERT_MAX_HEADER_BYTES + 1), "too_large"],
      [[enc(leaf.certPem), enc(other.certPem)], "multiple_certificates"],
      [enc(leaf.certPem + other.certPem), "multiple_certificates"],
      [enc(leaf.certPem + root.certPem), "multiple_certificates"], // a forwarded chain
      ["%E0%A4%A", "unparsable"], // broken percent-encoding
      [enc("not a certificate"), "unparsable"],
      [
        enc(`${leaf.certPem}\n-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n`),
        "unparsable",
      ],
      [enc(leaf.certPem.replace("MII", "MI!")), "unparsable"],
      [enc("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"), "unparsable"],
    ];
    for (const [header, reason] of cases) {
      const r = readClientCertificate({ header });
      expect(refused(r), String(header).slice(0, 40)).toBe(reason);
      expect(Object.keys(r)).toEqual(["ok", "reason"]);
    }
    for (const r of cases.map((c) => c[1])) expect(CLIENT_CERT_REFUSALS).toContain(r);
  });

  it("refuses a certificate not yet valid or expired by the given clock", () => {
    const now = new Date();
    const future = root.issue(
      { CN: "future" },
      {
        notBefore: new Date(now.getTime() + 3_600_000),
        notAfter: new Date(now.getTime() + 7_200_000),
      },
    );
    const past = root.issue(
      { CN: "past" },
      {
        notBefore: new Date(now.getTime() - 7_200_000),
        notAfter: new Date(now.getTime() - 3_600_000),
      },
    );
    expect(refused(readClientCertificate({ header: enc(future.certPem) }, { now }))).toBe(
      "not_yet_valid",
    );
    expect(refused(readClientCertificate({ header: enc(past.certPem) }, { now }))).toBe("expired");
    // The clock is the caller's: the same certificate is valid at a time inside its window.
    expect(
      readClientCertificate(
        { header: enc(past.certPem) },
        { now: new Date(now.getTime() - 5_400_000) },
      ).ok,
    ).toBe(true);
  });

  it("refuses a CA certificate and a certificate whose extended key usage is server-only", () => {
    expect(refused(readClientCertificate({ header: enc(root.certPem) }))).toBe(
      "not_client_certificate",
    );
    const server = root.issue({ CN: "server" }, { extendedKeyUsage: ["serverAuth"] });
    expect(refused(readClientCertificate({ header: enc(server.certPem) }))).toBe(
      "not_client_certificate",
    );
    const noEku = root.issue({ CN: "no-eku" }, { extendedKeyUsage: [] });
    expect(readClientCertificate({ header: enc(noEku.certPem) }).ok).toBe(true);
  });
});

describe("readClientCertificate: Envoy XFCC", () => {
  const xfcc = (cert: string) =>
    `By=spiffe://edge.test/gw;Hash=abc;Cert="${enc(cert)}";Subject="O=Partner Test,CN=partner-client-01";URI=`;

  it("reads Cert from a single element, quoted or not", () => {
    expect(readClientCertificate({ header: xfcc(leaf.certPem), format: "xfcc" }).ok).toBe(true);
    expect(
      readClientCertificate({ header: `Hash=abc;Cert=${enc(leaf.certPem)}`, format: "xfcc" }).ok,
    ).toBe(true);
  });

  it("refuses two elements (two hops), two Cert keys, no Cert and broken quoting", () => {
    const two = `${xfcc(leaf.certPem)},${xfcc(leaf.certPem)}`;
    expect(refused(readClientCertificate({ header: two, format: "xfcc" }))).toBe(
      "multiple_certificates",
    );
    const twoCerts = `Cert="${enc(leaf.certPem)}";Cert="${enc(leaf.certPem)}"`;
    expect(refused(readClientCertificate({ header: twoCerts, format: "xfcc" }))).toBe(
      "multiple_certificates",
    );
    expect(refused(readClientCertificate({ header: "By=x;Hash=abc", format: "xfcc" }))).toBe(
      "no_certificate",
    );
    expect(refused(readClientCertificate({ header: 'Cert="abc', format: "xfcc" }))).toBe(
      "unparsable",
    );
    expect(refused(readClientCertificate({ header: "Cert", format: "xfcc" }))).toBe("unparsable");
    // A Cert value that happens to spell a refusal label is just unparsable PEM.
    expect(refused(readClientCertificate({ header: "Cert=expired", format: "xfcc" }))).toBe(
      "unparsable",
    );
  });
});

describe("PinnedCaSet: the optional pinned-CA check", () => {
  const now = new Date();

  it("passes a leaf issued by a pinned CA and refuses one from another CA", () => {
    const trust = PinnedCaSet.fromPem([root.certPem]);
    const r = readClientCertificate({ header: enc(leaf.certPem) }, { trust, now });
    expect(r.ok && r.certificate.chain).toBe("pinned");
    const stranger = mtlsTestAuthority({ CN: "Partner Test Root", O: "Partner Test", C: "IN" });
    const forged = stranger.issue({ CN: "partner-client-01", O: "Partner Test" });
    // Same issuer name, different key: checkIssued matches the name, verify refuses the signature.
    expect(refused(readClientCertificate({ header: enc(forged.certPem) }, { trust, now }))).toBe(
      "untrusted_issuer",
    );
    const other = mtlsTestAuthority({ CN: "Other Root" }).issue({ CN: "c" });
    expect(refused(readClientCertificate({ header: enc(other.certPem) }, { trust, now }))).toBe(
      "untrusted_issuer",
    );
  });

  it("walks configured intermediates (never a chain from the request), at most two", () => {
    const i1 = root.intermediate({ CN: "Partner Issuing CA 1" });
    const i2 = i1.intermediate({ CN: "Partner Issuing CA 2" });
    const i3 = i2.intermediate({ CN: "Partner Issuing CA 3" });
    const viaOne = i1.issue({ CN: "via-one" });
    const viaTwo = i2.issue({ CN: "via-two" });
    const viaThree = i3.issue({ CN: "via-three" });
    const bare = PinnedCaSet.fromPem([root.certPem]);
    expect(
      refused(readClientCertificate({ header: enc(viaOne.certPem) }, { trust: bare, now })),
    ).toBe("untrusted_issuer");
    const trust = PinnedCaSet.fromPem([root.certPem], {
      intermediates: [i1.certPem, i2.certPem, i3.certPem],
    });
    expect(readClientCertificate({ header: enc(viaOne.certPem) }, { trust, now }).ok).toBe(true);
    expect(readClientCertificate({ header: enc(viaTwo.certPem) }, { trust, now }).ok).toBe(true);
    expect(refused(readClientCertificate({ header: enc(viaThree.certPem) }, { trust, now }))).toBe(
      "untrusted_issuer",
    );
    // The intermediate pinned directly as an anchor needs no walk.
    expect(
      readClientCertificate(
        { header: enc(viaThree.certPem) },
        { trust: PinnedCaSet.fromPem([i3.certPem]), now },
      ).ok,
    ).toBe(true);
  });

  it("refuses an expired pinned CA or intermediate", () => {
    const old = mtlsTestAuthority(
      { CN: "Old Root" },
      {
        notBefore: new Date(now.getTime() - 10 * 86_400_000),
        notAfter: new Date(now.getTime() - 86_400_000),
      },
    );
    const c = old.issue({ CN: "c" });
    expect(
      refused(
        readClientCertificate(
          { header: enc(c.certPem) },
          { trust: PinnedCaSet.fromPem([old.certPem]), now },
        ),
      ),
    ).toBe("untrusted_issuer");
    const staleInter = root.intermediate(
      { CN: "Stale Issuing CA" },
      {
        notBefore: new Date(now.getTime() - 10 * 86_400_000),
        notAfter: new Date(now.getTime() - 86_400_000),
      },
    );
    const d = staleInter.issue({ CN: "d" });
    expect(
      refused(
        readClientCertificate(
          { header: enc(d.certPem) },
          {
            trust: PinnedCaSet.fromPem([root.certPem], { intermediates: [staleInter.certPem] }),
            now,
          },
        ),
      ),
    ).toBe("untrusted_issuer");
  });

  it("refuses an issuer signature other than ECDSA P-256 / SHA-256 (owner question #170)", () => {
    const p384 = mtlsTestAuthority({ CN: "P-384 Root" }, { keyType: "p384" });
    const c = p384.issue({ CN: "c" });
    expect(
      refused(
        readClientCertificate(
          { header: enc(c.certPem) },
          { trust: PinnedCaSet.fromPem([p384.certPem]), now },
        ),
      ),
    ).toBe("issuer_algorithm");
    // Without a pinned set the certificate is still read: only the chain check is limited.
    expect(readClientCertificate({ header: enc(c.certPem) }, { now }).ok).toBe(true);
  });

  it("refuses a bad configuration and reports the pinned fingerprints", () => {
    expect(() => PinnedCaSet.fromPem([])).toThrow(RangeError);
    expect(() => PinnedCaSet.fromPem(["not pem"])).toThrow(RangeError);
    expect(() => PinnedCaSet.fromPem([leaf.certPem])).toThrow(/not a CA/);
    expect(() => PinnedCaSet.fromPem([root.certPem], { intermediates: [leaf.certPem] })).toThrow(
      /not a CA/,
    );
    const bundle = PinnedCaSet.fromPem([root.certPem + root.intermediate({ CN: "x" }).certPem]);
    expect(bundle.fingerprints).toHaveLength(2);
    expect(bundle.fingerprints[0]).toBe(
      createHash("sha256").update(new X509Certificate(root.certPem).raw).digest("hex"),
    );
  });
});

describe("readClientCertificate: the platform's own TLS socket (IPB-10-16 handshake)", () => {
  const serverCert = root.issue({ CN: "localhost" }, { extendedKeyUsage: ["serverAuth"] });

  /** A TLS server on loopback that requests a client certificate; resolves the server-side socket. */
  async function handshake(client?: { certPem: string; keyPem: string }, ca = [root.certPem]) {
    const server = createServer({
      cert: serverCert.certPem,
      key: serverCert.keyPem,
      ca,
      requestCert: true,
      rejectUnauthorized: false,
      minVersion: "TLSv1.3",
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const accepted = once(server, "secureConnection") as Promise<[TLSSocket]>;
    const socket = connect({
      host: "127.0.0.1",
      port,
      // The test server's own certificate is not what is under test.
      rejectUnauthorized: false,
      ...(client ? { cert: client.certPem, key: client.keyPem } : {}),
    });
    const [peer] = await accepted;
    return {
      peer,
      close: async () => {
        socket.destroy();
        peer.destroy();
        server.close();
        await once(server, "close");
      },
    };
  }

  it("reads the authorised peer's leaf and says the TLS layer authorised it", async () => {
    const { peer, close } = await handshake(leaf);
    try {
      const r = readClientCertificate({ socket: peer });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.certificate.source).toBe("tls");
      expect(r.certificate.tlsAuthorized).toBe(true);
      expect(r.certificate.x5tS256).toBe(createHash("sha256").update(leaf.der).digest("base64url"));
      const pinned = readClientCertificate(
        { socket: peer },
        { trust: PinnedCaSet.fromPem([root.certPem]) },
      );
      expect(pinned.ok && pinned.certificate.chain).toBe("pinned");
    } finally {
      await close();
    }
  });

  it("refuses an unauthorised peer unless the caller asks only for a report", async () => {
    const stranger = mtlsTestAuthority({ CN: "Stranger Root" }).issue({ CN: "stranger" });
    const { peer, close } = await handshake(stranger);
    try {
      expect(peer.authorized).toBe(false);
      expect(refused(readClientCertificate({ socket: peer }))).toBe("tls_unauthorized");
      const r = readClientCertificate({ socket: peer }, { tlsAuthorization: "reported" });
      expect(r.ok && r.certificate.tlsAuthorized).toBe(false);
      // ...and the pinned check still refuses it.
      expect(
        refused(
          readClientCertificate(
            { socket: peer },
            { tlsAuthorization: "reported", trust: PinnedCaSet.fromPem([root.certPem]) },
          ),
        ),
      ).toBe("untrusted_issuer");
    } finally {
      await close();
    }
  });

  it("refuses a peer that presented no certificate", async () => {
    const { peer, close } = await handshake();
    try {
      expect(refused(readClientCertificate({ socket: peer }))).toBe("no_certificate");
    } finally {
      await close();
    }
  });
});

describe("registry", () => {
  it("records the uses under the approved SHA-256 and ECDSA P-256 entries", () => {
    const used = (id: string) => ALGORITHMS.find((a) => a.id === id)!.usedFor.join("\n");
    expect(used("sha-256")).toContain("x5t#S256");
    expect(used("ecdsa-p256-sha256")).toContain("pinned-CA");
  });
});
