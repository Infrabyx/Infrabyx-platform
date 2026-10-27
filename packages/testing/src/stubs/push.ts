// Expo push API v2 and FCM HTTP v1 stubs (PL3 plan §6.7), from the vendors' published request and
// response shapes (expo-server-sdk 6.0.0; FCM v1 REST reference). [VERIFY] until the sandbox legs.
// The FCM stub includes Google's token endpoint and checks the RS256 assertion (C-24) against the
// service account's public key with the openssl CLI, so the adapter's signing is proven end to end
// (a throwaway key per run, as for the SNS signer; nothing is committed).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromBase64Url } from "@infrabyx/crypto";
import { startStub, stubCredential, type VendorStub } from "./http.js";

export interface ExpoStub extends VendorStub {
  /** Tokens Expo no longer knows (tickets come back `DeviceNotRegistered`). */
  unregistered: Set<string>;
  readonly sent: Array<{ to: string; title: string; data: Record<string, string> }>;
  accessToken: string | null;
}

let seq = 0;

export async function startExpoStub(accessToken: string | null = null): Promise<ExpoStub> {
  const sent: ExpoStub["sent"] = [];
  const unregistered = new Set<string>();
  const receipts = new Map<string, { status: "ok" | "error"; details?: { error: string } }>();
  const ref: { s?: ExpoStub } = {};
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (s.accessToken && r.headers.authorization !== `Bearer ${s.accessToken}`)
      return { status: 401, body: { errors: [{ code: "UNAUTHORIZED" }] } };
    if (r.method === "POST" && r.path === "/--/api/v2/push/send") {
      const msgs = r.json<Array<{ to: string; title: string; data: Record<string, string> }>>();
      if (!Array.isArray(msgs) || msgs.length > 100)
        return { status: 400, body: { errors: [{ code: "PUSH_TOO_MANY_NOTIFICATIONS" }] } };
      return {
        status: 200,
        body: {
          data: msgs.map((m) => {
            if (unregistered.has(m.to))
              return {
                status: "error",
                message: "not registered",
                details: { error: "DeviceNotRegistered" },
              };
            sent.push(m);
            const id = `stub-ticket-${++seq}`;
            receipts.set(id, { status: "ok" });
            return { status: "ok", id };
          }),
        },
      };
    }
    if (r.method === "POST" && r.path === "/--/api/v2/push/getReceipts") {
      const { ids } = r.json<{ ids: string[] }>();
      return {
        status: 200,
        body: {
          data: Object.fromEntries(
            ids.filter((i) => receipts.has(i)).map((i) => [i, receipts.get(i)]),
          ),
        },
      };
    }
    return { status: 404, body: {} };
  });
  ref.s = Object.assign(stub, { unregistered, sent, accessToken });
  return ref.s;
}

export interface FcmStub extends VendorStub {
  projectId: string;
  clientEmail: string;
  /** PKCS#8 PEM of a fresh test service-account key (generated per run, never committed). */
  privateKeyPem: string;
  readonly sent: Array<Record<string, unknown>>;
  /** Number of access tokens the token endpoint has issued. */
  tokensIssued: number;
  unregistered: Set<string>;
}

export async function startFcmStub(projectId = "ipb-test-project"): Promise<FcmStub> {
  const dir = mkdtempSync(join(tmpdir(), "ipb-fcm-"));
  const keyFile = join(dir, "k.pem");
  const pubFile = join(dir, "p.pem");
  execFileSync(
    "openssl",
    ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", keyFile],
    {
      stdio: "ignore",
    },
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
        {
          stdio: "ignore",
        },
      );
      return true;
    } catch {
      return false;
    }
  };
  const clientEmail = `push@${projectId}.iam.example`;
  const issued = new Set<string>();
  const sent: Array<Record<string, unknown>> = [];
  const unregistered = new Set<string>();
  const ref: { s?: FcmStub } = {};
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.method === "POST" && r.path === "/token") {
      const f = r.form();
      const jwt = f.get("assertion") ?? "";
      const [h, c, sig] = jwt.split(".");
      if (f.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || !h || !c || !sig)
        return { status: 400, body: { error: "invalid_grant" } };
      const ok = verifyRs256(`${h}.${c}`, fromBase64Url(sig));
      const claims = JSON.parse(Buffer.from(fromBase64Url(c)).toString("utf8")) as {
        iss?: string;
        scope?: string;
      };
      if (!ok || claims.iss !== clientEmail || !claims.scope?.includes("firebase.messaging"))
        return { status: 400, body: { error: "invalid_grant" } };
      const token = stubCredential();
      issued.add(token);
      s.tokensIssued += 1;
      return { status: 200, body: { access_token: token, expires_in: 3599, token_type: "Bearer" } };
    }
    if (r.method === "POST" && r.path === `/v1/projects/${s.projectId}/messages:send`) {
      const bearer = r.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (!issued.has(bearer))
        return { status: 401, body: { error: { status: "UNAUTHENTICATED" } } };
      const { message } = r.json<{ message: Record<string, unknown> }>();
      const token = message.token as string | undefined;
      if (token && unregistered.has(token))
        return {
          status: 404,
          body: { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } },
        };
      sent.push(message);
      return { status: 200, body: { name: `projects/${s.projectId}/messages/${++seq}` } };
    }
    return { status: 404, body: {} };
  });
  const close = stub.close.bind(stub);
  ref.s = Object.assign(stub, {
    close: async () => {
      await close();
      rmSync(dir, { recursive: true, force: true });
    },
    projectId,
    clientEmail,
    privateKeyPem: readFileSync(keyFile, "utf8"),
    sent,
    tokensIssued: 0,
    unregistered,
  });
  return ref.s;
}
