// KYC port schemas for DigiLocker (PR-UDF-040, R1-D-193): the start request and its return address;
// for Aadhaar OTP e-KYC (PR-UDF-041, R1-D-194): the number check and the two requests; and for the
// bank account check (PR-UDF-043, R1-D-196): the mode, the status set and the funding statement;
// and for liveness and face match (PR-UDF-044, R1-D-197): the mode, the score and the retention;
// and for the RE-hosted V-CIP launcher (PR-UDF-045, R1-D-198): the hand-off, its bound and the codes;
// and for webhook verification without a vendor call (PR-UDF-046, R1-D-199): the order and labels.
import { describe, expect, it } from "vitest";
import { payloadClass } from "./payload-class.js";
import { verhoeffValid } from "../search-refusal.js";
import { findAadhaarLike } from "../aadhaar.js";
import { toProblem, PortError } from "../errors.js";
import {
  AADHAAR_OTP_REFUSALS,
  BANK_ACCOUNT_MODE_UNSUPPORTED,
  BANK_ACCOUNT_MODES,
  BANK_ACCOUNT_STATUSES,
  BankAccountCheck,
  KYC_ADAPTER_FUNDING,
  kycAdapterFunding,
  FaceMatch,
  KYC_ADAPTER_RETENTION,
  KYC_MODE_UNSUPPORTED,
  KYC_SCORE_OUT_OF_RANGE,
  kycAdapterRetention,
  kycScoreValid,
  LIVENESS_MODES,
  LivenessCheck,
  AadhaarOtpRequest,
  AadhaarOtpVerify,
  KYC_METHODS,
  aadhaarUidValid,
  DIGILOCKER_RETURN_URL_REFUSED,
  DigilockerPull,
  StartDigilocker,
  digilockerReturnUrlAllowed,
  LaunchVcip,
  KYC_WEBHOOK_MAX_BODY_BYTES,
  KYC_WEBHOOK_REFUSALS,
  kycWebhookRefused,
  verifyKycWebhookWith,
  type KycWebhookCheck,
  VCIP_HANDOFF_MAX_LIFETIME_SECONDS,
  VCIP_HANDOFF_REFUSALS,
  VCIP_LAUNCH_URL_REFUSED,
  VCIP_REASON_CODES,
  VcipHandoffContext,
  VcipSession,
  vcipHandoffFailure,
  vcipHandoffTimeRefusal,
  vcipLaunchUrlAllowed,
} from "./kyc.js";

const hosts = ["kyc.example.com"];

describe("PR-UDF-040: startDigilocker and its return address", () => {
  it("StartDigilocker takes the document types and a return address, nothing else", () => {
    expect(
      StartDigilocker.parse({ docTypes: ["PANCR"], returnUrl: "https://kyc.example.com/done" }),
    ).toEqual({ docTypes: ["PANCR"], returnUrl: "https://kyc.example.com/done" });
    for (const bad of [
      { docTypes: [], returnUrl: "https://kyc.example.com/done" },
      { docTypes: ["XXXXX"], returnUrl: "https://kyc.example.com/done" },
      { docTypes: ["PANCR"] },
      { docTypes: ["PANCR"], returnUrl: "https://kyc.example.com/done", consentSession: "x" },
      { docTypes: ["PANCR"], returnUrl: `https://kyc.example.com/${"a".repeat(2048)}` },
    ])
      expect(StartDigilocker.safeParse(bad).success).toBe(false);
    expect(payloadClass(StartDigilocker).bodyHighest).toBe("CONFIDENTIAL");
    expect(payloadClass(DigilockerPull).bodyHighest).toBe("REGULATED");
  });

  it("a return address is https, without user information or a 12-digit run, on a listed host", () => {
    expect(digilockerReturnUrlAllowed("https://kyc.example.com/done?j=abc", hosts)).toBe(true);
    expect(digilockerReturnUrlAllowed("https://KYC.example.com/done", hosts)).toBe(true);
    expect(digilockerReturnUrlAllowed("https://kyc.example.com:8443/done", hosts)).toBe(true);
    for (const bad of [
      "http://kyc.example.com/done",
      "https://other.example.com/done",
      "https://evil.kyc.example.com/done",
      "https://kyc.example.com.evil.test/done",
      "https://user:pw@kyc.example.com/done",
      "https://user@kyc.example.com/done",
      "https://kyc.example.com/done?ref=234567890123",
      "javascript:alert(1)",
      "not a url",
    ])
      expect(digilockerReturnUrlAllowed(bad, hosts)).toBe(false);
    expect(digilockerReturnUrlAllowed("https://kyc.example.com/done", [])).toBe(false);
    expect(DIGILOCKER_RETURN_URL_REFUSED).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });
});

/** A test number: `body` with its Verhoeff check digit appended (no real number is committed). */
const withCheck = (body: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${body}${d}`)) return `${body}${d}`;
  throw new Error("no check digit");
};
/** The same number with its last digit changed: the Verhoeff check then fails. */
const badCheck = (n: string): string => `${n.slice(0, -1)}${(Number(n.at(-1)) + 1) % 10}`;

describe("PR-UDF-041: Aadhaar OTP e-KYC schemas and the number check", () => {
  const uid = withCheck("99990000011");
  const vid = withCheck("919900000000001");

  it("an Aadhaar number is 12 digits, first 2 to 9, Verhoeff-valid", () => {
    expect(aadhaarUidValid(uid, "AADHAAR")).toBe(true);
    expect(aadhaarUidValid(badCheck(uid), "AADHAAR")).toBe(false);
    for (const first of ["0", "1"]) {
      const n = withCheck(`${first}9990000011`);
      expect(verhoeffValid(n)).toBe(true);
      expect(aadhaarUidValid(n, "AADHAAR")).toBe(false);
    }
    expect(aadhaarUidValid(withCheck("9999000001"), "AADHAAR")).toBe(false);
    expect(aadhaarUidValid(withCheck("999900000111"), "AADHAAR")).toBe(false);
    // A VID is not an Aadhaar number, nor the reverse.
    expect(aadhaarUidValid(vid, "AADHAAR")).toBe(false);
    expect(aadhaarUidValid(uid, "VID")).toBe(false);
  });

  it("a VID is 16 digits, Verhoeff-valid, any first digit", () => {
    expect(aadhaarUidValid(vid, "VID")).toBe(true);
    expect(aadhaarUidValid(withCheck("019900000000001"), "VID")).toBe(true);
    expect(aadhaarUidValid(badCheck(vid), "VID")).toBe(false);
    expect(aadhaarUidValid(withCheck("91990000000001"), "VID")).toBe(false);
  });

  it("grouped, padded or non-digit forms are refused, not normalised", () => {
    const grouped = [
      `${uid.slice(0, 4)} ${uid.slice(4, 8)} ${uid.slice(8)}`,
      `${uid.slice(0, 4)}-${uid.slice(4, 8)}-${uid.slice(8)}`,
      ` ${uid}`,
      `${uid}\n`,
      uid.replace(/^9/, "\uff19"),
      "",
    ];
    for (const g of grouped) expect(aadhaarUidValid(g, "AADHAAR")).toBe(false);
    expect(
      aadhaarUidValid(
        `${vid.slice(0, 4)} ${vid.slice(4, 8)} ${vid.slice(8, 12)} ${vid.slice(12)}`,
        "VID",
      ),
    ).toBe(false);
  });

  it("the request carries the number, its kind and the consent; nothing else", () => {
    const consent = { version: "1.0", textHash: "a".repeat(64), at: "2026-11-19T05:00:00Z" };
    expect(AadhaarOtpRequest.parse({ uid, uidKind: "AADHAAR", consent })).toEqual({
      uid,
      uidKind: "AADHAAR",
      consent,
    });
    for (const bad of [
      { uid, uidKind: "PAN", consent },
      { uid, uidKind: "AADHAAR" },
      { uid, uidKind: "AADHAAR", consent: { ...consent, textHash: "x" } },
      { uid, uidKind: "AADHAAR", consent: { ...consent, at: "yesterday" } },
      { uid, uidKind: "AADHAAR", consent: { ...consent, extra: 1 } },
      { uid, uidKind: "AADHAAR", consent, mobile: "9999999999" },
      { uid: 1, uidKind: "AADHAAR", consent },
    ])
      expect(AadhaarOtpRequest.safeParse(bad).success).toBe(false);
    // A Zod refusal never carries the number.
    const r = AadhaarOtpRequest.safeParse({
      uid: `${uid}${"9".repeat(60)}`,
      uidKind: "AADHAAR",
      consent,
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).not.toContain(uid);
    expect(payloadClass(AadhaarOtpRequest).bodyHighest).toBe("REGULATED");
    expect(payloadClass(AadhaarOtpRequest).complete).toBe(true);
  });

  it("the verify takes the transaction and a six-digit code", () => {
    expect(AadhaarOtpVerify.parse({ txn: "AOT0000000001", otp: "123456" })).toEqual({
      txn: "AOT0000000001",
      otp: "123456",
    });
    for (const otp of ["12345", "1234567", "12345a", " 123456"])
      expect(AadhaarOtpVerify.safeParse({ txn: "AOT0000000001", otp }).success).toBe(false);
    expect(AadhaarOtpVerify.safeParse({ txn: "short", otp: "123456" }).success).toBe(false);
    expect(payloadClass(AadhaarOtpVerify).bodyHighest).toBe("REGULATED");
  });

  it("the refusal labels are fixed and the method is routable", () => {
    expect([...AADHAAR_OTP_REFUSALS]).toEqual([
      "uid_invalid",
      "mobile_not_linked",
      "otp_invalid",
      "otp_expired",
      "not_configured",
    ]);
    for (const r of AADHAAR_OTP_REFUSALS) expect(r).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    expect(KYC_METHODS).toContain("aadhaar_otp");
  });
});

describe("PR-UDF-043: the bank account check's mode, status set and funding statement", () => {
  const check = { ifsc: "HDFC0000001", accountNumber: "000123456789" };

  it("the mode is optional, one of two, and INTERNAL; the request stays REGULATED", () => {
    expect([...BANK_ACCOUNT_MODES]).toEqual(["pennyless", "penny_drop"]);
    expect(BankAccountCheck.parse(check)).toEqual(check);
    for (const mode of BANK_ACCOUNT_MODES)
      expect(BankAccountCheck.parse({ ...check, mode })).toEqual({ ...check, mode });
    for (const mode of ["PENNYLESS", "penny-drop", "", "none", 1])
      expect(BankAccountCheck.safeParse({ ...check, mode }).success).toBe(false);
    expect(BankAccountCheck.safeParse({ ...check, amount: 1 }).success).toBe(false);
    expect(payloadClass(BankAccountCheck).bodyHighest).toBe("REGULATED");
    expect(payloadClass(BankAccountCheck)).toMatchObject({ complete: true, unannotated: [] });
  });

  it("the status set is unchanged and the refusal label is fixed and leaves as the problem's reason", () => {
    expect([...BANK_ACCOUNT_STATUSES]).toEqual(["valid", "invalid", "closed", "not_found"]);
    expect(BANK_ACCOUNT_MODE_UNSUPPORTED).toBe("mode_unsupported");
    const p = toProblem(
      new PortError("IPB-PORT-002", "KYC", { meta: { reason: BANK_ACCOUNT_MODE_UNSUPPORTED } }),
    );
    expect(p).toMatchObject({ code: "IPB-PORT-002", reason: "mode_unsupported" });
  });

  it("every adapter states who funds a penny drop, with its source; the real adapters are unknown until verified", () => {
    for (const [adapter, f] of Object.entries(KYC_ADAPTER_FUNDING)) {
      expect(["provider", "tenant", "unknown"]).toContain(f.pennyDrop);
      expect(f.source.length).toBeGreaterThan(10);
      if (adapter !== "fake-kyc") {
        expect(f.pennyDrop).toBe("unknown");
        expect(f.source).toContain("[VERIFY]");
      }
    }
    expect(Object.keys(KYC_ADAPTER_FUNDING).sort()).toEqual(["digio-kyc", "fake-kyc", "idfy-kyc"]);
    expect(kycAdapterFunding("digio-kyc")).toBe(KYC_ADAPTER_FUNDING["digio-kyc"]);
    expect(kycAdapterFunding("someone-else").pennyDrop).toBe("unknown");
  });

  it("the fixtures' account number is not Aadhaar-like, so the no-Aadhaar sweep is meaningful", () => {
    // Twelve digits, but a leading 0 is never an Aadhaar number (first digit 2 to 9).
    expect(findAadhaarLike(check.accountNumber)).toEqual([]);
    expect(findAadhaarLike(`acct ${check.accountNumber} ifsc ${check.ifsc}`)).toEqual([]);
  });
});

describe("PR-UDF-044: the liveness mode, the score and the retention statement", () => {
  const ref = { storageKey: "tenant/tnt_kyc/kyc/f1.jpg", sha256: "a".repeat(64) };

  it("the liveness mode is optional, one of three, and INTERNAL; the requests stay REGULATED", () => {
    expect([...LIVENESS_MODES]).toEqual(["passive", "active_gesture", "active_voice"]);
    expect(LivenessCheck.parse({ frames: [ref] })).toEqual({ frames: [ref] });
    for (const mode of LIVENESS_MODES)
      expect(LivenessCheck.parse({ frames: [ref], mode })).toEqual({ frames: [ref], mode });
    for (const mode of ["blink", "PASSIVE", "active", "", 1])
      expect(LivenessCheck.safeParse({ frames: [ref], mode }).success).toBe(false);
    expect(LivenessCheck.safeParse({ frames: [ref], threshold: 0.5 }).success).toBe(false);
    expect(FaceMatch.safeParse({ a: ref, b: ref, mode: "passive" }).success).toBe(false);
    for (const s of [LivenessCheck, FaceMatch]) {
      expect(payloadClass(s).bodyHighest).toBe("REGULATED");
      expect(payloadClass(s)).toMatchObject({ complete: true, unannotated: [] });
    }
  });

  it("one mode_unsupported label for every mode, and the score label, leave as the problem's reason", () => {
    expect(KYC_MODE_UNSUPPORTED).toBe("mode_unsupported");
    expect(BANK_ACCOUNT_MODE_UNSUPPORTED).toBe(KYC_MODE_UNSUPPORTED);
    expect(KYC_SCORE_OUT_OF_RANGE).toBe("score_out_of_range");
    const p = toProblem(
      new PortError("IPB-PORT-003", "KYC", { meta: { reason: KYC_SCORE_OUT_OF_RANGE } }),
    );
    expect(p).toMatchObject({ code: "IPB-PORT-003", reason: "score_out_of_range" });
  });

  it("a score is a finite number from 0 to 1, never anything else", () => {
    for (const ok of [0, 0.5, 0.8, 1]) expect(kycScoreValid(ok)).toBe(true);
    for (const bad of [-0.01, 1.0001, 87, NaN, Infinity, -Infinity, "0.9", null, undefined])
      expect(kycScoreValid(bad)).toBe(false);
  });

  it("every adapter states whether its vendor keeps a template; the real adapters are unknown until a written statement", () => {
    for (const [adapter, r] of Object.entries(KYC_ADAPTER_RETENTION)) {
      expect(["none", "kept", "unknown"]).toContain(r.template);
      expect(r.source.length).toBeGreaterThan(10);
      if (adapter !== "fake-kyc") {
        expect(r.template).toBe("unknown");
        expect(r.source).toContain("[VERIFY]");
      }
    }
    expect(Object.keys(KYC_ADAPTER_RETENTION).sort()).toEqual([
      "digio-kyc",
      "fake-kyc",
      "idfy-kyc",
    ]);
    expect(KYC_ADAPTER_RETENTION["fake-kyc"]!.template).toBe("none");
    expect(kycAdapterRetention("idfy-kyc")).toBe(KYC_ADAPTER_RETENTION["idfy-kyc"]);
    expect(kycAdapterRetention("someone-else").template).toBe("unknown");
  });
});

describe("PR-UDF-045: the V-CIP hand-off, its lifetime bound, the launch address and the reason codes", () => {
  const issued = new Date("2026-11-19T10:00:00Z");
  const ctx = (over: Record<string, unknown> = {}) => ({
    tenantId: "tnt_kyc",
    reId: "re_nbfc_one",
    lspId: "lsp_udofin",
    customerRef: "cus_01JD00000000000000000000AB",
    journeyId: "jrn_01JD00000000000000000000CD",
    issuedAt: issued.toISOString(),
    expiresAt: new Date(issued.getTime() + 10 * 60_000).toISOString(),
    nonce: "n0nce-AAAAAAAAAAAAAAAAAAAA",
    ...over,
  });
  /** A synthetic Aadhaar-like number: never committed as a literal. */
  const aadhaarLike = (() => {
    for (let d = 0; d < 10; d++) if (verhoeffValid(`99990000011${d}`)) return `99990000011${d}`;
    throw new Error("no check digit");
  })();

  it("the context is ids and times only, strict, and every field is classed", () => {
    expect(VcipHandoffContext.parse(ctx())).toEqual(ctx());
    expect(Object.keys(VcipHandoffContext.shape).sort()).toEqual(
      [
        "customerRef",
        "expiresAt",
        "issuedAt",
        "journeyId",
        "lspId",
        "nonce",
        "reId",
        "tenantId",
      ].sort(),
    );
    for (const bad of [
      ctx({ name: "Asha Rao" }),
      ctx({ pan: "AAAPZ1234C" }),
      ctx({ customerRef: "Asha Rao" }),
      ctx({ customerRef: "cus/1" }),
      ctx({ journeyId: "" }),
      ctx({ nonce: "short" }),
      ctx({ issuedAt: "yesterday" }),
      ctx({ tenantId: undefined }),
    ])
      expect(VcipHandoffContext.safeParse(bad).success).toBe(false);
    expect(payloadClass(VcipHandoffContext)).toMatchObject({ complete: true, unannotated: [] });
    expect(payloadClass(LaunchVcip)).toMatchObject({ complete: true, unannotated: [] });
    expect(LaunchVcip.safeParse({ context: ctx(), jws: "a.b.c", extra: 1 }).success).toBe(false);
  });

  it(`a hand-off lives at most ${VCIP_HANDOFF_MAX_LIFETIME_SECONDS} s and expires after its issue`, () => {
    expect(VCIP_HANDOFF_MAX_LIFETIME_SECONDS).toBe(900);
    const at = (s: number) => new Date(issued.getTime() + s * 1000).toISOString();
    expect(VcipHandoffContext.safeParse(ctx({ expiresAt: at(900) })).success).toBe(true);
    for (const s of [901, 3600, 0, -60])
      expect(VcipHandoffContext.safeParse(ctx({ expiresAt: at(s) })).success).toBe(false);
  });

  it("no field may carry a 12-digit run or an Aadhaar-like number", () => {
    const good = ctx();
    expect(findAadhaarLike(JSON.stringify(good))).toEqual([]);
    for (const k of ["tenantId", "reId", "lspId", "customerRef", "journeyId"] as const) {
      for (const v of [
        `cus_${aadhaarLike}`,
        `x-${aadhaarLike.slice(0, 4)}-${aadhaarLike.slice(4, 8)}-${aadhaarLike.slice(8)}`,
        `c.123456789012`,
      ])
        expect(VcipHandoffContext.safeParse(ctx({ [k]: v })).success, `${k}=${v}`).toBe(false);
    }
    expect(VcipHandoffContext.safeParse(ctx({ nonce: `AAAAAAAAAA${aadhaarLike}` })).success).toBe(
      false,
    );
  });

  it("the time checks, the JWS failure labels and the fixed refusal labels", () => {
    expect([...VCIP_HANDOFF_REFUSALS]).toEqual([
      "handoff_invalid",
      "handoff_replayed",
      "handoff_expired",
    ]);
    const c = ctx();
    expect(vcipHandoffTimeRefusal(c, issued)).toBeUndefined();
    expect(vcipHandoffTimeRefusal(c, new Date(issued.getTime() + 9 * 60_000))).toBeUndefined();
    expect(vcipHandoffTimeRefusal(c, new Date(issued.getTime() + 10 * 60_000))).toBe(
      "handoff_expired",
    );
    expect(vcipHandoffTimeRefusal(c, new Date(issued.getTime() - 2 * 60_000))).toBe(
      "handoff_invalid",
    );
    expect(vcipHandoffFailure("replay")).toBe("handoff_replayed");
    expect(vcipHandoffFailure("stale")).toBe("handoff_expired");
    for (const r of ["format", "header", "alg", "typ", "kid", "signature", "future"])
      expect(vcipHandoffFailure(r)).toBe("handoff_invalid");
    const p = toProblem(
      new PortError("IPB-PORT-001", "KYC", {
        meta: { reason: "handoff_replayed", definite: true },
      }),
    );
    expect(p).toMatchObject({ code: "IPB-PORT-001", reason: "handoff_replayed" });
  });

  it("a launch address is https, on the hosts, with no user information and no number", () => {
    const h = ["vcip.re.example.com"];
    expect(VCIP_LAUNCH_URL_REFUSED).toBe("launch_url_invalid");
    expect(vcipLaunchUrlAllowed("https://vcip.re.example.com/v/vcp_01JD", h)).toBe(true);
    for (const bad of [
      "http://vcip.re.example.com/v/1",
      "https://user:pw@vcip.re.example.com/v/1",
      "https://other.example.com/v/1",
      "https://vcip.re.example.com.evil.example/v/1",
      `https://vcip.re.example.com/v/${aadhaarLike}`,
      `https://vcip.re.example.com/v/x${aadhaarLike.slice(0, 4)} ${aadhaarLike.slice(4)}`,
      "javascript:alert(1)",
      "not a url",
    ])
      expect(vcipLaunchUrlAllowed(bad, h), bad).toBe(false);
  });

  it("the reason codes are fixed; a scheduled session's id is optional on VcipSession", () => {
    expect(VCIP_REASON_CODES).toContain("official_rejected");
    expect(VCIP_REASON_CODES).toContain("launch_expired");
    expect(VCIP_REASON_CODES).toContain("other");
    expect(new Set(VCIP_REASON_CODES).size).toBe(VCIP_REASON_CODES.length);
    for (const c of VCIP_REASON_CODES) expect(c).toMatch(/^[a-z_]+$/);
    const s = {
      sessionId: "sess_1",
      tenantId: "tnt_kyc",
      customerRef: "cus_1",
      officialRef: "usr_official",
      roomId: "room_1",
      documents: [],
    };
    expect(VcipSession.parse(s)).toEqual(s);
    expect(VcipSession.parse({ ...s, vcipId: "vcp_1" })).toEqual({ ...s, vcipId: "vcp_1" });
  });
});

describe("verifyKycWebhookWith (PR-UDF-046)", () => {
  const enc = (v: unknown) =>
    new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));
  const now = new Date("2026-11-19T06:00:00Z");
  const ts = String(now.getTime() / 1000);
  const headers = { "Webhook-Id": "msg_1", "webhook-timestamp": ts, "webhook-signature": "v1,x" };
  const make = (over: Partial<KycWebhookCheck> = {}) => {
    const seen = new Set<string>();
    const calls: string[] = [];
    const o: KycWebhookCheck = {
      adapter: "test-kyc",
      rawBody: enc({ vcipId: "vcip_1" }),
      headers,
      verify: () => (calls.push("verify"), null),
      replay: {
        claim: async (k) => (calls.push("claim"), seen.has(k) ? false : (seen.add(k), true)),
      },
      vcipIdOf: (b) => (calls.push("parse"), (b as { vcipId?: unknown }).vcipId),
      now,
      ...over,
    };
    return { o, calls };
  };
  const refused = (reason: string) => ({
    code: "IPB-API-018",
    meta: { reason, definite: true },
  });

  it("returns the delivery id, the session and the time only, checking in order", async () => {
    const { o, calls } = make();
    const r = await verifyKycWebhookWith(o);
    expect(r).toEqual({ eventId: "msg_1", vcipId: "vcip_1", receivedAt: now.toISOString() });
    expect(calls).toEqual(["verify", "claim", "parse"]);
    expect(findAadhaarLike(JSON.stringify(r))).toEqual([]);
  });

  it("refuses an oversize body before reading a header, and replays, stale and bad signatures before parsing", async () => {
    const big = make({ rawBody: new Uint8Array(KYC_WEBHOOK_MAX_BODY_BYTES + 1) });
    await expect(verifyKycWebhookWith(big.o)).rejects.toMatchObject(refused("body_too_large"));
    expect(big.calls).toEqual([]);
    const edge = make({
      rawBody: enc(`{"vcipId":"vcip_1","pad":"${"x".repeat(KYC_WEBHOOK_MAX_BODY_BYTES - 30)}"}`),
    });
    expect(edge.o.rawBody.byteLength).toBeLessThanOrEqual(KYC_WEBHOOK_MAX_BODY_BYTES);
    await expect(verifyKycWebhookWith(edge.o)).resolves.toMatchObject({ vcipId: "vcip_1" });
    for (const missing of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      const h = Object.fromEntries(
        Object.entries(headers).filter(([k]) => k.toLowerCase() !== missing),
      );
      const m = make({ headers: h });
      await expect(verifyKycWebhookWith(m.o)).rejects.toMatchObject(refused("signature_invalid"));
      expect(m.calls).toEqual([]);
    }
    for (const [failure, reason] of [
      ["signature", "signature_invalid"],
      ["headers", "signature_invalid"],
      ["timestamp", "timestamp_stale"],
    ] as const) {
      const m = make({ verify: () => failure });
      await expect(verifyKycWebhookWith(m.o)).rejects.toMatchObject(refused(reason));
      expect(m.calls).toEqual([]);
    }
    const once = make();
    await verifyKycWebhookWith(once.o);
    await expect(verifyKycWebhookWith(once.o)).rejects.toMatchObject(refused("event_replayed"));
    expect(once.calls).toEqual(["verify", "claim", "parse", "verify", "claim"]);
    // A provider's retry: the same id with a new timestamp is a new delivery.
    await expect(
      verifyKycWebhookWith({
        ...once.o,
        headers: { ...headers, "webhook-timestamp": String(Number(ts) - 30) },
      }),
    ).resolves.toMatchObject({ eventId: "msg_1" });
  });

  it("a verified body naming no well-formed session is malformed_event, definite", async () => {
    for (const body of [
      "not json",
      "{}",
      { vcipId: 7 },
      { vcipId: "x" },
      { vcipId: "vcip 1" },
      { vcipId: "vcip_123456789012" },
    ]) {
      const m = make({ rawBody: enc(body) });
      await expect(verifyKycWebhookWith(m.o)).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "malformed_event", definite: true },
      });
    }
    const bad = make({ rawBody: new Uint8Array([0x7b, 0xff, 0x7d]) });
    await expect(verifyKycWebhookWith(bad.o)).rejects.toMatchObject({ code: "IPB-PORT-001" });
  });

  it("the labels are fixed and the refusal is a 401 that carries no body", () => {
    expect(KYC_WEBHOOK_REFUSALS).toEqual([
      "body_too_large",
      "signature_invalid",
      "timestamp_stale",
      "event_replayed",
    ]);
    const e = kycWebhookRefused("test-kyc", "signature_invalid");
    expect(e).toBeInstanceOf(PortError);
    expect(toProblem(e).status).toBe(401);
  });
});
