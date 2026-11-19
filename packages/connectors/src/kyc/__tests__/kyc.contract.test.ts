// KYC contract legs (R1-plan M16, R1-D-24). Hermetic: the Digio KYC stub. The sandbox leg waits
// for the owner's Digio account (OWNER-QUESTIONS #87) and the adapter stays `unproven` and off.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryReplayStore, sha256Hex } from "@infrabyx/crypto";
import {
  defineContractSuite,
  DIGILOCKER_CONTRACT_RETURN_URL,
  kycContractCases,
  KYC_FAKE_FIXTURES,
  MemoryStorage,
  startDigioKycStub,
  type DigioKycStub,
  type KycFixtures,
} from "@infrabyx/testing";
import {
  DigioKyc,
  digioAadhaarOtpRequestBody,
  mapDigioAadhaarOtpRefusal,
  mapDigioAadhaarOtpVerify,
  mapDigioDigilockerStart,
} from "../digio.js";
import { MemoryDigilockerPullStore } from "../digilocker-pulls.js";
import { holdsAadhaarNumber, MemoryAadhaarOtpVerifyStore } from "../aadhaar-otp.js";

let dg: DigioKycStub;
const storage = new MemoryStorage();
let fixtures: KycFixtures;
beforeAll(async () => {
  dg = await startDigioKycStub();
  const key = "tenant/tnt_kyc/kyc/01JA0000000000000000000001.zip";
  await storage.put(key, dg.offlineZip, {
    bucketClass: "REGULATED",
    contentType: "application/zip",
  });
  fixtures = {
    ...KYC_FAKE_FIXTURES,
    aadhaar: {
      file: { storageKey: key, sha256: sha256Hex(dg.offlineZip) },
      shareCode: dg.shareCode,
      wrongShareCode: "0000",
    },
    digilockerConsent: () => dg.completedDigilocker(["PANCR", "ADHAR"]),
    aadhaarOtp: {
      ...dg.aadhaarOtp,
      notNotified: () => ({ port: digio(), vendorCalls: () => dg.requests.length }),
      vendorCalls: () => dg.requests.length,
      expire: (_p, txn) => dg.expireAadhaarOtp(txn),
    },
  };
});
afterAll(async () => {
  await dg?.close();
});

let enabled = true;
const returnHost = new URL(DIGILOCKER_CONTRACT_RETURN_URL).hostname;
const digio = (over: Partial<ConstructorParameters<typeof DigioKyc>[0]> = {}) =>
  new DigioKyc({
    storage,
    consents: new MemoryReplayStore(),
    enabled: () => enabled,
    clientId: () => dg.clientId,
    clientSecret: () => dg.clientSecret,
    currentTenant: () => "tnt_kyc",
    digilockerReturnHosts: [returnHost],
    digilockerTemplate: () => dg.digilockerTemplate,
    baseUrl: dg.url,
    allowLoopbackHttp: true,
    ...over,
  });

describe("@IPB-01-15 KYC hermetic leg (Digio KYC stub)", () => {
  // The fixtures are built once the stub is up, so the cases are read lazily.
  const cases = kycContractCases(
    new Proxy({} as KycFixtures, { get: (_t, k) => fixtures[k as keyof KycFixtures] }),
  );
  // Built for a notified entity, so the Aadhaar OTP cases run (PR-UDF-041); they build their own
  // adapter without it.
  defineContractSuite("KYC", () => digio({ notifiedEntity: true }), cases, { leg: "hermetic" });
});

describe("R1-D-24 Digio KYC behind its flag, by reference, without the Aadhaar number", () => {
  it("is off until int.kyc.digio.enabled: no request reaches Digio and health is down", async () => {
    enabled = false;
    try {
      const p = digio();
      const before = dg.requests.length;
      await expect(
        p.digilockerPull({
          consentSession: dg.completedDigilocker(["PANCR"]),
          docTypes: ["PANCR"],
        }),
      ).rejects.toMatchObject({ code: "IPB-PORT-001", meta: { reason: "adapter_disabled" } });
      expect((await p.health()).status).toBe("down");
      expect(dg.requests.length).toBe(before);
    } finally {
      enabled = true;
    }
  });

  it("stores DigiLocker files under the tenant, REGULATED, and refuses an unfinished session without burning it", async () => {
    const p = digio();
    const pending = dg.pendingDigilocker();
    await expect(
      p.digilockerPull({ consentSession: pending, docTypes: ["PANCR"] }),
    ).rejects.toMatchObject({ meta: { reason: "consent_incomplete" } });
    const docs = await p.digilockerPull(
      { consentSession: dg.completedDigilocker(["PANCR", "DRVLC"]), docTypes: ["PANCR"] },
      { tenantId: "tnt_other" },
    );
    expect(docs.map((d) => d.docType)).toEqual(["PANCR"]);
    const o = await storage.get(docs[0]!.file.storageKey);
    expect(docs[0]!.file.storageKey).toMatch(/^tenant\/tnt_other\/kyc\//);
    expect(o.meta.bucketClass).toBe("REGULATED");
    expect(sha256Hex(o.body)).toBe(docs[0]!.file.sha256);
  });

  it("checks the file against its SHA-256 before sending it, and keeps only the last four digits", async () => {
    const p = digio();
    const before = dg.requests.length;
    await expect(
      p.verifyAadhaarOffline({
        file: { ...fixtures.aadhaar.file, sha256: "0".repeat(64) },
        shareCode: dg.shareCode,
      }),
    ).rejects.toMatchObject({ meta: { reason: "hash_mismatch" } });
    expect(dg.requests.length).toBe(before);
    const r = await p.verifyAadhaarOffline({
      file: fixtures.aadhaar.file,
      shareCode: dg.shareCode,
    });
    expect(r).toMatchObject({ aadhaarLast4: "0420", signatureValid: true, gender: "F" });
    expect(r.photo?.storageKey).toMatch(/^tenant\/tnt_kyc\/kyc\/.+\.jpg$/);
    await expect(
      p.verifyAadhaarOffline({ file: fixtures.aadhaar.file, shareCode: "0000" }),
    ).rejects.toMatchObject({ meta: { reason: "share_code" } });
  });

  it("names no tenant, no call: a pull without a tenant is refused", async () => {
    const p = new DigioKyc({
      storage,
      consents: new MemoryReplayStore(),
      enabled: () => true,
      clientId: () => dg.clientId,
      clientSecret: () => dg.clientSecret,
      baseUrl: dg.url,
      allowLoopbackHttp: true,
    });
    await expect(
      p.digilockerPull({ consentSession: dg.completedDigilocker(["PANCR"]), docTypes: ["PANCR"] }),
    ).rejects.toMatchObject({ meta: { reason: "no_tenant" } });
  });
});

describe("PR-UDF-040 Digio DigiLocker start, evidence and keyed pulls", () => {
  it("builds the template request and the gateway address; refuses without hosts or a template", async () => {
    const before = dg.requests.length;
    await expect(
      digio({ digilockerReturnHosts: [] }).startDigilocker({
        docTypes: ["PANCR"],
        returnUrl: DIGILOCKER_CONTRACT_RETURN_URL,
      }),
    ).rejects.toMatchObject({ meta: { reason: "return_url_not_allowed" } });
    await expect(
      digio({ digilockerTemplate: () => undefined }).startDigilocker({
        docTypes: ["PANCR"],
        returnUrl: DIGILOCKER_CONTRACT_RETURN_URL,
      }),
    ).rejects.toMatchObject({ meta: { reason: "not_configured" } });
    expect(dg.requests.length).toBe(before);
    const p = digio({ digilockerReturnHosts: (t) => (t === "tnt_kyc" ? [returnHost] : []) });
    const s = await p.startDigilocker({
      docTypes: ["PANCR"],
      returnUrl: `${DIGILOCKER_CONTRACT_RETURN_URL}?j=abc`,
    });
    const sent = dg.requests.at(-1)!;
    expect(sent.path).toBe("/client/kyc/v2/request/with_template");
    expect(sent.json()).toEqual({
      template_name: dg.digilockerTemplate,
      notify_customer: false,
      generate_access_token: true,
    });
    const u = new URL(s.signInUrl);
    expect(u.host).toBe("ext.digio.in");
    expect(u.hash).toContain(`/gateway/login/${s.consentSession}/`);
    expect(decodeURIComponent(u.hash.split("redirect_url=")[1]!)).toBe(
      `${DIGILOCKER_CONTRACT_RETURN_URL}?j=abc`,
    );
    expect(s).toMatchObject({ adapter: "digio-kyc", vendorRef: s.consentSession });
    await expect(
      p.startDigilocker(
        { docTypes: ["PANCR"], returnUrl: DIGILOCKER_CONTRACT_RETURN_URL },
        { tenantId: "tnt_other" },
      ),
    ).rejects.toMatchObject({ meta: { reason: "return_url_not_allowed" } });
    expect(() =>
      mapDigioDigilockerStart(
        { id: "KID0000000001", access_token: { id: "GWT0000000002", valid_till: "2000-01-01" } },
        { gatewayHost: "ext.digio.in", returnUrl: "https://x.example", now: new Date() },
      ),
    ).toThrow();
  });

  it("the session started is pulled once the customer completes it, with evidence and the signature result", async () => {
    const p = digio();
    const s = await p.startDigilocker({
      docTypes: ["PANCR", "DRVLC"],
      returnUrl: DIGILOCKER_CONTRACT_RETURN_URL,
    });
    await expect(
      p.digilockerPull({ consentSession: s.consentSession, docTypes: ["PANCR", "DRVLC"] }),
    ).rejects.toMatchObject({ meta: { reason: "consent_incomplete" } });
    dg.completeDigilocker(s.consentSession, ["PANCR", "DRVLC"]);
    const docs = await p.digilockerPull({
      consentSession: s.consentSession,
      docTypes: ["PANCR", "DRVLC"],
    });
    expect(docs.map((d) => [d.docType, d.signatureValid])).toEqual([
      ["PANCR", true],
      ["DRVLC", null],
    ]);
    for (const d of docs)
      expect(d.evidence).toMatchObject({
        vendorRef: s.consentSession,
        adapter: "digio-kyc",
        modelVersion: "kyc-v2",
      });
  });

  it("a keyed retry is served from the store with no vendor call; a crashed pull is finished by its retry", async () => {
    const pulls = new MemoryDigilockerPullStore();
    const p = digio({ pulls });
    const consentSession = dg.completedDigilocker(["PANCR"]);
    const first = await p.digilockerPull(
      { consentSession, docTypes: ["PANCR"] },
      { idempotencyKey: "k-retry-1" },
    );
    const before = dg.requests.length;
    expect(
      await p.digilockerPull(
        { consentSession, docTypes: ["PANCR"] },
        { idempotencyKey: "k-retry-1" },
      ),
    ).toEqual(first);
    expect(dg.requests.length).toBe(before);
    // A pull that reserved its key and claimed the session, then died before it finished.
    const crashed = dg.completedDigilocker(["PANCR"]);
    const consents = new MemoryReplayStore();
    const q = digio({ pulls, consents });
    const req = {
      tenantId: "tnt_kyc",
      adapter: "digio-kyc",
      idempotencyKey: "k-crash-1",
      consentSession: crashed,
      docTypes: ["PANCR"] as const,
    };
    expect((await pulls.reserve(req)).kind).toBe("new");
    await consents.claim(`kyc:digio:digilocker:${crashed}`, new Date(Date.now() + 3600_000));
    const docs = await q.digilockerPull(
      { consentSession: crashed, docTypes: ["PANCR"] },
      { idempotencyKey: "k-crash-1" },
    );
    expect(docs).toHaveLength(1);
    expect(await pulls.find(req)).toEqual({ kind: "done", documents: docs });
    // Another key on the same session is refused.
    await expect(
      q.digilockerPull(
        { consentSession: crashed, docTypes: ["PANCR"] },
        { idempotencyKey: "k-crash-2" },
      ),
    ).rejects.toMatchObject({ meta: { reason: "consent_used" } });
  });
});

describe("PR-UDF-041 Digio Aadhaar OTP e-KYC for a notified RE", () => {
  const consent = { version: "1.0", textHash: "cd".repeat(32), at: "2026-11-19T05:00:00Z" };

  it("is off by default: not_configured before the flag, the parse or any request", async () => {
    enabled = false;
    try {
      const before = dg.requests.length;
      const p = digio();
      await expect(
        p.aadhaarOtpRequest({ uid: dg.aadhaarOtp.uid, uidKind: "AADHAAR", consent }),
      ).rejects.toMatchObject({ meta: { reason: "not_configured", definite: true } });
      await expect(
        p.aadhaarOtpVerify({ txn: "AOT0000000001", otp: "123456" }),
      ).rejects.toMatchObject({ meta: { reason: "not_configured" } });
      // Notified but switched off: the flag still holds.
      await expect(
        digio({ notifiedEntity: true }).aadhaarOtpRequest({
          uid: dg.aadhaarOtp.uid,
          uidKind: "AADHAAR",
          consent,
        }),
      ).rejects.toMatchObject({ meta: { reason: "adapter_disabled" } });
      expect(dg.requests.length).toBe(before);
    } finally {
      enabled = true;
    }
  });

  it("sends the number once, in the request body only, and stores the e-KYC under the tenant", async () => {
    const p = digio({ notifiedEntity: true });
    const s = await p.aadhaarOtpRequest(
      { uid: dg.aadhaarOtp.uid, uidKind: "AADHAAR", consent },
      { tenantId: "tnt_other" },
    );
    const sent = dg.requests.at(-1)!;
    expect(sent.path).toBe("/client/kyc/v2/aadhaar_otp/request");
    expect(sent.json()).toEqual({
      id_type: "aadhaar",
      id_number: dg.aadhaarOtp.uid,
      consent: "Y",
      consent_text_version: "1.0",
      consent_text_hash: "cd".repeat(32),
      consent_at: "2026-11-19T05:00:00Z",
    });
    expect(sent.path + sent.query.toString()).not.toContain(dg.aadhaarOtp.uid);
    const r = await p.aadhaarOtpVerify(
      { txn: s.txn, otp: dg.aadhaarOtp.otp },
      { tenantId: "tnt_other" },
    );
    expect(dg.requests.at(-1)!.json()).toEqual({ id: s.txn, otp: dg.aadhaarOtp.otp });
    expect(r).toMatchObject({
      adapter: "digio-kyc",
      signatureValid: true,
      uidLast4: dg.aadhaarOtp.uid.slice(-4),
    });
    expect(r.ekyc.storageKey).toMatch(/^tenant\/tnt_other\/kyc\/.+\.xml$/);
    const o = await storage.get(r.ekyc.storageKey);
    expect(o.meta.bucketClass).toBe("REGULATED");
    expect(sha256Hex(o.body)).toBe(r.ekyc.sha256);
    expect(Buffer.from(o.body).toString("utf8")).toContain("<KycRes");
    expect(digioAadhaarOtpRequestBody({ uid: "x", uidKind: "VID", consent }).id_type).toBe("vid");
  });

  it("refuses to store an e-KYC response that carries the full number, and keeps no copy", async () => {
    const p = digio({ notifiedEntity: true });
    const s = await p.aadhaarOtpRequest({ uid: dg.aadhaarOtp.uid, uidKind: "AADHAAR", consent });
    dg.ekycWithNumberOnce(dg.aadhaarOtp.uid);
    const keys = (await storage.list("tenant/")).keys.length;
    const e = await p.aadhaarOtpVerify({ txn: s.txn, otp: dg.aadhaarOtp.otp }).then(
      () => undefined,
      (x: unknown) => x,
    );
    expect(e).toMatchObject({ code: "IPB-PORT-001", meta: { reason: "ekyc_holds_number" } });
    expect(JSON.stringify(e)).not.toContain(dg.aadhaarOtp.uid);
    expect((await storage.list("tenant/")).keys.length).toBe(keys);
    expect(holdsAadhaarNumber(`uid="${dg.aadhaarOtp.uid}"`)).toBe(true);
    expect(holdsAadhaarNumber(`uid="xxxxxxxx${dg.aadhaarOtp.uid.slice(-4)}"`)).toBe(false);
    expect(holdsAadhaarNumber(`h=ab${dg.aadhaarOtp.uid}cd`)).toBe(false);
    expect(holdsAadhaarNumber(` ${dg.aadhaarOtp.vid} `)).toBe(true);
    // The shared rule (PR-UDF-042, R1-D-195): a grouped number is refused too.
    expect(
      holdsAadhaarNumber(`<uid>${dg.aadhaarOtp.uid.replace(/(\d{4})(?=\d)/g, "$1 ")}</uid>`),
    ).toBe(true);
  });

  it("a keyed retry on another instance with a shared store makes no vendor call", async () => {
    const verifies = new MemoryAadhaarOtpVerifyStore();
    const s = await digio({ notifiedEntity: true }).aadhaarOtpRequest({
      uid: dg.aadhaarOtp.uid,
      uidKind: "AADHAAR",
      consent,
    });
    const first = await digio({
      notifiedEntity: true,
      aadhaarOtpVerifies: verifies,
    }).aadhaarOtpVerify({ txn: s.txn, otp: dg.aadhaarOtp.otp }, { idempotencyKey: "otp-k-1" });
    const before = dg.requests.length;
    expect(
      await digio({ notifiedEntity: true, aadhaarOtpVerifies: verifies }).aadhaarOtpVerify(
        { txn: s.txn, otp: dg.aadhaarOtp.otp },
        { idempotencyKey: "otp-k-1" },
      ),
    ).toEqual(first);
    expect(dg.requests.length).toBe(before);
    // A vendor failure leaves the key pending: the retry goes to the vendor again.
    const t = await digio({ notifiedEntity: true }).aadhaarOtpRequest({
      uid: dg.aadhaarOtp.uid,
      uidKind: "AADHAAR",
      consent,
    });
    const q = digio({ notifiedEntity: true, aadhaarOtpVerifies: verifies });
    dg.failNext(1, 503);
    await expect(
      q.aadhaarOtpVerify({ txn: t.txn, otp: dg.aadhaarOtp.otp }, { idempotencyKey: "otp-k-2" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-002" });
    expect(
      (
        await q.aadhaarOtpVerify(
          { txn: t.txn, otp: dg.aadhaarOtp.otp },
          { idempotencyKey: "otp-k-2" },
        )
      ).uidLast4,
    ).toBe(dg.aadhaarOtp.uid.slice(-4));
  });

  it("maps the stub-shaped answers conservatively", () => {
    expect(mapDigioAadhaarOtpRefusal(400, { code: "INVALID_AADHAAR" })).toBe("uid_invalid");
    expect(mapDigioAadhaarOtpRefusal(400, { code: "MOBILE_NOT_LINKED" })).toBe("mobile_not_linked");
    expect(mapDigioAadhaarOtpRefusal(400, { code: "INVALID_OTP" })).toBe("otp_invalid");
    expect(mapDigioAadhaarOtpRefusal(400, { code: "OTP_EXPIRED" })).toBe("otp_expired");
    expect(mapDigioAadhaarOtpRefusal(404, undefined)).toBe("otp_expired");
    expect(mapDigioAadhaarOtpRefusal(400, { code: "SOMETHING" })).toBeUndefined();
    expect(mapDigioAadhaarOtpRefusal(500, { code: "INVALID_OTP" })).toBeUndefined();
    expect(() => mapDigioAadhaarOtpVerify({ id: "AOT0000000001", details: {} })).toThrow();
    expect(() =>
      mapDigioAadhaarOtpVerify({
        id: "AOT0000000001",
        details: { aadhaar_last_digits: dg.aadhaarOtp.uid, ekyc_xml: "PEt5Yz4=" },
      }),
    ).toThrow();
    expect(
      mapDigioAadhaarOtpVerify({
        id: "AOT0000000001",
        details: { aadhaar_last_digits: "xxxx-xxxx-1234", ekyc_xml: "PEt5Yz4=" },
      }),
    ).toMatchObject({ uidLast4: "1234", signatureValid: null });
  });
});
