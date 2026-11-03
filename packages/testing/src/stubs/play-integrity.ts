// Google Play Integrity `decodeIntegrityToken` stub with Google's token endpoint (Udofin
// PR-UDF-028; owner answer #99; R1-D-59), from the published v1 REST shapes ([VERIFY] until the
// owner's Google Cloud project exists). The token endpoint checks the C-24 RS256 assertion with
// the openssl CLI against a throwaway service-account key made per run (nothing is committed), and
// only for the Play Integrity scope. `mint` makes a token whose decoded payload the test chooses.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromBase64Url, randomBytes, toBase64Url, toHex } from "@infrabyx/crypto";
import { startStub, stubCredential, type VendorStub } from "./http.js";

export interface PlayIntegrityMint {
  packageName: string;
  /** The request hash the app passed (the binding's value). */
  requestHash: string;
  verdicts?: string[];
  licensed?: boolean;
  recognised?: boolean;
  /** Milliseconds since the epoch the token says it was made (default now). */
  timestampMillis?: number;
}

export interface PlayIntegrityStub extends VendorStub {
  clientEmail: string;
  /** PKCS#8 PEM of a fresh test service-account key (generated per run, never committed). */
  privateKeyPem: string;
  /** The app signing certificate digest (base64url) every minted token names. */
  certDigest: string;
  mint(o: PlayIntegrityMint): string;
}

export async function startPlayIntegrityStub(): Promise<PlayIntegrityStub> {
  const dir = mkdtempSync(join(tmpdir(), "ipb-play-"));
  const keyFile = join(dir, "k.pem");
  const pubFile = join(dir, "p.pem");
  execFileSync(
    "openssl",
    ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", keyFile],
    { stdio: "ignore" },
  );
  execFileSync("openssl", ["pkey", "-in", keyFile, "-pubout", "-out", pubFile], {
    stdio: "ignore",
  });
  const verifyRs256 = (data: string, sig: Uint8Array): boolean => {
    writeFileSync(join(dir, "d"), data);
    writeFileSync(join(dir, "s"), sig);
    try {
      execFileSync(
        "openssl",
        ["dgst", "-sha256", "-verify", pubFile, "-signature", join(dir, "s"), join(dir, "d")],
        { stdio: "ignore" },
      );
      return true;
    } catch {
      return false;
    }
  };
  const clientEmail = "integrity@ipb-test-project.iam.example";
  const certDigest = toBase64Url(randomBytes(32));
  const issued = new Set<string>();
  const tokens = new Map<string, Record<string, unknown>>();
  const stub = await startStub((r) => {
    if (r.method === "POST" && r.path === "/token") {
      const f = r.form();
      const [h, c, sig] = (f.get("assertion") ?? "").split(".");
      if (f.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || !h || !c || !sig)
        return { status: 400, body: { error: "invalid_grant" } };
      const claims = JSON.parse(Buffer.from(fromBase64Url(c)).toString("utf8")) as {
        iss?: string;
        scope?: string;
      };
      if (
        !verifyRs256(`${h}.${c}`, fromBase64Url(sig)) ||
        claims.iss !== clientEmail ||
        claims.scope !== "https://www.googleapis.com/auth/playintegrity"
      )
        return { status: 400, body: { error: "invalid_grant" } };
      const token = stubCredential();
      issued.add(token);
      return { status: 200, body: { access_token: token, expires_in: 3599, token_type: "Bearer" } };
    }
    const m = /^\/v1\/([^/]+):decodeIntegrityToken$/.exec(r.path);
    if (r.method === "POST" && m) {
      if (!issued.has(r.headers.authorization?.replace(/^Bearer /, "") ?? ""))
        return { status: 401, body: { error: { status: "UNAUTHENTICATED" } } };
      const payload = tokens.get(r.json<{ integrity_token?: string }>().integrity_token ?? "");
      if (!payload) return { status: 400, body: { error: { status: "INVALID_ARGUMENT" } } };
      return { status: 200, body: { tokenPayloadExternal: payload } };
    }
    return { status: 404, body: {} };
  });
  const close = stub.close.bind(stub);
  return Object.assign(stub, {
    close: async () => {
      await close();
      rmSync(dir, { recursive: true, force: true });
    },
    clientEmail,
    privateKeyPem: readFileSync(keyFile, "utf8"),
    certDigest,
    mint(o: PlayIntegrityMint) {
      const t = `pi.${toHex(randomBytes(24))}`;
      tokens.set(t, {
        requestDetails: {
          requestPackageName: o.packageName,
          requestHash: o.requestHash,
          timestampMillis: String(o.timestampMillis ?? Date.now()),
        },
        appIntegrity: {
          appRecognitionVerdict:
            o.recognised === false ? "UNRECOGNIZED_VERSION" : "PLAY_RECOGNIZED",
          packageName: o.packageName,
          certificateSha256Digest: [certDigest],
          versionCode: "42",
        },
        deviceIntegrity: { deviceRecognitionVerdict: o.verdicts ?? ["MEETS_DEVICE_INTEGRITY"] },
        accountDetails: { appLicensingVerdict: o.licensed === false ? "UNLICENSED" : "LICENSED" },
      });
      return t;
    },
  });
}
