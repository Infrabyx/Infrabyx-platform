// KYC port contract cases and an in-memory fake (IPB-01-15; PR-FBX-01, R1-D-21). Adapters do not
// exist yet (OWNER-QUESTIONS #87); a future adapter runs `kycContractCases(itsSandboxFixtures)`
// with defineContractSuite("KYC", …). The fake lets products build their KYC flows now. It keeps
// nothing but what a test asks for, returns files as STORAGE references, and never returns an
// Aadhaar number.
// KYC port contract cases and an in-memory fake (IPB-01-15; PR-FBX-01, R1-D-21). Adapters do not
// exist yet (OWNER-QUESTIONS #87); a future adapter runs `kycContractCases(itsSandboxFixtures)`
// with defineContractSuite("KYC", …). The fake lets products build their KYC flows now. It keeps
// nothing but what a test asks for, returns files as STORAGE references, and never returns an
// Aadhaar number.
import { expect } from "vitest";
import {
  AadhaarOfflineCheck,
  AadhaarOtpRequest,
  AadhaarOtpVerify,
  AmlParty,
  BankAccountCheck,
  CkycDownload,
  CkycSearch,
  DigilockerPull,
  FaceMatch,
  LivenessCheck,
  OvdOcr,
  PanCheck,
  BANK_ACCOUNT_STATUSES,
  LIVENESS_MODES,
  LaunchVcip,
  KYC_WEBHOOK_MAX_BODY_BYTES,
  KYC_WEBHOOK_REFUSALS,
  VCIP_HANDOFF_MAX_LIFETIME_SECONDS,
  VCIP_REASON_CODES,
  kycScoreValid,
  payloadClass,
  vcipLaunchUrlAllowed,
  type BankAccountMode,
  type DigilockerDocument,
  type KycFileRef,
  type KycPort,
  type LivenessMode,
  type ScoreResult,
  type VcipHandoffContext,
  type VcipManifest,
} from "@infrabyx/contracts/ports";
import { findAadhaarLike } from "@infrabyx/contracts/aadhaar";
import type { ContractCase } from "../contract.js";
import {
  DIGILOCKER_CONTRACT_RETURN_URL,
  type AadhaarOtpFixtures,
  type BankAccountFixtures,
  type KycFixtures,
  type KycWebhookFixtures,
  type ScoreFixtures,
  type VcipLaunchFixtures,
} from "@infrabyx/fakes";
export {
  type KycWebhookFixtures,
  FAKE_KYC_WEBHOOK,
  signFakeKycWebhook,
  type AadhaarOtpFixtures,
  type BankAccountFixtures,
  type KycFixtures,
  type ScoreFixtures,
  type VcipLaunchFixtures,
  FAKE_VCIP_HANDOFF,
  fakeVcipHandoffContext,
  fakeVcipHandoffKeys,
  signFakeVcipHandoff,
  FAKE_AADHAAR_OTP,
  syntheticUid,
  DIGILOCKER_CONTRACT_RETURN_URL,
  KYC_FAKE_FIXTURES,
  FakeKyc,
} from "@infrabyx/fakes";
const AADHAAR_LIKE = /(?<![0-9])[0-9]{12}(?![0-9])/;
/** A 12-digit (Aadhaar) or 16-digit (VID) run (PR-UDF-041). */
const UID_LIKE = /(?<![0-9])(?:[0-9]{12}|[0-9]{16})(?![0-9])/;
const SHA256_HEX = /[0-9a-f]{64}/g;
let dlKey = 0;
let otpKey = 0;
let bankKey = 0;
let scoreKey = 0;

/** What an error shows anywhere: message, stack and every own field (code, detail, meta, cause). */
const errorText = (e: unknown): string => {
  const x = e as { message?: unknown; stack?: unknown; cause?: unknown };
  return JSON.stringify({
    message: x?.message,
    stack: x?.stack,
    cause: x?.cause === undefined ? undefined : String(x.cause),
    ...(typeof e === "object" && e !== null ? e : { value: String(e) }),
  });
};

/** The KYC contract: one list for the fake now and for every adapter later. */
export function kycContractCases(fx: KycFixtures): Array<ContractCase<KycPort>> {
  const noAadhaar = (v: unknown) => expect(JSON.stringify(v)).not.toMatch(AADHAAR_LIKE);
  const returnUrl = () => fx.digilockerReturnUrl ?? DIGILOCKER_CONTRACT_RETURN_URL;
  const start = (p: KycPort) => {
    expect(typeof p.startDigilocker).toBe("function");
    return (p.startDigilocker as NonNullable<KycPort["startDigilocker"]>).bind(p);
  };
  // A fresh key per run (the platform adapters keep a key for 24 hours).
  const key = () => `dl-contract-${Date.now().toString(36)}-${++dlKey}`;
  const refusal = (p: Promise<unknown>) =>
    p.then(
      () => ({ code: "resolved", reason: undefined }),
      (e: { code?: string; meta?: { reason?: string } }) => ({
        code: e.code,
        reason: e.meta?.reason,
      }),
    );
  // PR-UDF-041: Aadhaar OTP e-KYC.
  const otpFx = (): AadhaarOtpFixtures => {
    expect(fx.aadhaarOtp, "KycFixtures.aadhaarOtp for an adapter with Aadhaar OTP").toBeDefined();
    return fx.aadhaarOtp!;
  };
  const otpReq = (p: KycPort) => {
    expect(typeof p.aadhaarOtpRequest).toBe("function");
    return (p.aadhaarOtpRequest as NonNullable<KycPort["aadhaarOtpRequest"]>).bind(p);
  };
  const otpVerify = (p: KycPort) => {
    expect(typeof p.aadhaarOtpVerify).toBe("function");
    return (p.aadhaarOtpVerify as NonNullable<KycPort["aadhaarOtpVerify"]>).bind(p);
  };
  const consent = () => ({
    version: "contract-1.0",
    textHash: "ab".repeat(32),
    at: new Date().toISOString(),
  });
  const aadhaar = (uid: string) => ({ uid, uidKind: "AADHAAR" as const, consent: consent() });
  const otpCallKey = () => `otp-contract-${Date.now().toString(36)}-${++otpKey}`;
  const definite = (reason: string) => ({ code: "IPB-PORT-001", meta: { reason, definite: true } });
  /** No 12- or 16-digit run (SHA-256 hex aside) and none of the numbers given, anywhere in `v`. */
  const noUid = (v: unknown, numbers: readonly string[]) => {
    const text = typeof v === "string" ? v : JSON.stringify(v);
    expect(text.replace(SHA256_HEX, "")).not.toMatch(UID_LIKE);
    for (const n of numbers) expect(text).not.toContain(n);
  };
  // PR-UDF-043: the bank account check's mode and keyed retries.
  const bankFx = (): BankAccountFixtures => {
    expect(
      fx.bankAccount,
      "KycFixtures.bankAccount for an adapter with bank accounts",
    ).toBeDefined();
    return fx.bankAccount!;
  };
  const bankCallKey = () => `bank-contract-${Date.now().toString(36)}-${++bankKey}`;
  const account = (mode?: BankAccountMode) => ({
    ifsc: fx.bank.ifsc,
    accountNumber: fx.bank.accountNumber,
    name: fx.bank.name,
    ...(mode ? { mode } : {}),
  });
  const modeUnsupported = { code: "IPB-PORT-002", meta: { reason: "mode_unsupported" } };
  const idemConflict = { code: "IPB-PORT-004", meta: { reason: "idempotency_conflict" } };
  // PR-UDF-044: liveness and face match by mode, threshold and key.
  const scoreFx = (): ScoreFixtures => {
    expect(fx.scores, "KycFixtures.scores for an adapter with liveness").toBeDefined();
    return fx.scores!;
  };
  const scoreCallKey = () => `score-contract-${Date.now().toString(36)}-${++scoreKey}`;
  const frames = (mode?: LivenessMode, files: readonly KycFileRef[] = fx.frames) => ({
    frames: [...files],
    ...(mode ? { mode } : {}),
  });
  /** A score from 0 to 1, the threshold applied from 0 to 1, and the pass that follows from both. */
  const scoredWell = (r: ScoreResult, p: KycPort) => {
    expect(kycScoreValid(r.score), `score ${r.score} is a finite number from 0 to 1`).toBe(true);
    expect(kycScoreValid(r.threshold), `threshold ${r.threshold} is from 0 to 1`).toBe(true);
    expect(r.passed).toBe(r.score >= r.threshold!);
    expect(r.adapter).toBe(p.descriptor.adapter);
    expect(r.vendorRef).not.toBe("");
    expect(r.modelVersion).not.toBe("");
  };
  const offScale = { code: "IPB-PORT-003", meta: { reason: "score_out_of_range" } };
  // PR-UDF-045: the RE-hosted V-CIP launcher.
  const launchFx = (): VcipLaunchFixtures => {
    expect(fx.vcipLaunch, "KycFixtures.vcipLaunch for an adapter with launchVcip").toBeDefined();
    return fx.vcipLaunch!;
  };
  const launcher = (p: KycPort) => {
    expect(typeof p.launchVcip).toBe("function");
    return (p.launchVcip as NonNullable<KycPort["launchVcip"]>).bind(p);
  };
  /** A well-formed hand-off for the unsupported check: it never reaches a verifier. */
  const staticHandoff = (): VcipHandoffContext => {
    const at = new Date();
    return {
      tenantId: "tnt_kyc",
      reId: "re_contract",
      lspId: "lsp_contract",
      customerRef: "cus_contract",
      journeyId: "jrn_contract",
      issuedAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + 60_000).toISOString(),
      nonce: "contract-nonce-AAAAAAAAAA",
    };
  };
  const handoffRefused = (reason: string) => ({
    code: "IPB-PORT-001",
    meta: { reason, definite: true },
  });
  // PR-UDF-046: webhook verification without a vendor call.
  const hookFx = (): KycWebhookFixtures => {
    expect(fx.webhook, "KycFixtures.webhook for an adapter with verifyWebhook").toBeDefined();
    return fx.webhook!;
  };
  const verifier = (p: KycPort) => {
    expect(typeof p.verifyWebhook).toBe("function");
    return (p.verifyWebhook as NonNullable<KycPort["verifyWebhook"]>).bind(p);
  };
  const hookRefused = (reason: string) => ({
    code: "IPB-API-018",
    meta: { reason, definite: true },
  });
  const minutes = (n: number) => new Date(Date.now() + n * 60_000);
  // PR-UDF-040: the strings the contract promises carry no 12-digit run (a SHA-256 may).
  const noRunInKeys = (docs: DigilockerDocument[]) => {
    for (const d of docs)
      for (const s of [
        d.file.storageKey,
        d.issuer,
        d.issuedAt ?? "",
        ...Object.values(d.evidence ?? {}),
      ])
        expect(s).not.toMatch(AADHAAR_LIKE);
  };
  return [
    {
      name: "every request schema classes its identity fields REGULATED; the adapter stays IN",
      async run(p) {
        for (const s of [
          PanCheck,
          AadhaarOfflineCheck,
          DigilockerPull,
          CkycSearch,
          CkycDownload,
          LivenessCheck,
          FaceMatch,
          BankAccountCheck,
          OvdOcr,
          AmlParty,
          AadhaarOtpRequest,
          AadhaarOtpVerify,
        ])
          expect(payloadClass(s).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("REGULATED");
      },
    },
    {
      name: "verifyPan: a valid PAN with its name, a partial name, an unknown PAN; a malformed PAN never reaches the vendor",
      method: "verifyPan",
      invoke: (p) => p.verifyPan({ pan: fx.pan.pan, name: fx.pan.name }),
      async run(p) {
        expect(await p.verifyPan({ pan: fx.pan.pan, name: fx.pan.name })).toMatchObject({
          status: "valid",
          nameMatch: "match",
        });
        expect(
          (await p.verifyPan({ pan: fx.pan.pan, name: `${fx.pan.name.split(" ")[0]} X` }))
            .nameMatch,
        ).not.toBe("match");
        expect((await p.verifyPan({ pan: fx.pan.unknownPan, name: fx.pan.name })).status).not.toBe(
          "valid",
        );
        await expect(p.verifyPan({ pan: "abc", name: fx.pan.name })).rejects.toThrow();
      },
    },
    {
      name: "verifyAadhaarOffline: the signature, the last four digits only, and a wrong share code refused",
      method: "verifyAadhaarOffline",
      invoke: (p) =>
        p.verifyAadhaarOffline({ file: fx.aadhaar.file, shareCode: fx.aadhaar.shareCode }),
      async run(p) {
        const r = await p.verifyAadhaarOffline({
          file: fx.aadhaar.file,
          shareCode: fx.aadhaar.shareCode,
        });
        expect(r.signatureValid).toBe(true);
        expect(r.aadhaarLast4).toMatch(/^[0-9]{4}$/);
        noAadhaar(r);
        await expect(
          p.verifyAadhaarOffline({ file: fx.aadhaar.file, shareCode: fx.aadhaar.wrongShareCode }),
        ).rejects.toMatchObject({ code: "IPB-PORT-001" });
        expect(r.kind ?? "xml_zip").toBe("xml_zip");
      },
    },
    {
      name: "verifyAadhaarOffline (PR-UDF-039): the ZIP needs its share code, a Secure QR has none and is verified or refused as unsupported",
      method: "verifyAadhaarOffline",
      invoke: (p) =>
        p.verifyAadhaarOffline({ file: fx.aadhaar.file, shareCode: fx.aadhaar.shareCode }),
      async run(p) {
        await expect(p.verifyAadhaarOffline({ file: fx.aadhaar.file })).rejects.toThrow();
        await expect(
          p.verifyAadhaarOffline({
            kind: "secure_qr",
            file: fx.aadhaar.file,
            shareCode: fx.aadhaar.shareCode,
          }),
        ).rejects.toThrow();
        const qr = await p.verifyAadhaarOffline({ kind: "secure_qr", file: fx.aadhaar.file }).then(
          (v) => ({ ok: true as const, v }),
          (e: { code?: string; meta?: { reason?: string } }) => ({ ok: false as const, e }),
        );
        if (qr.ok) {
          expect(qr.v.kind).toBe("secure_qr");
          expect(qr.v.aadhaarLast4).toMatch(/^[0-9]{4}$/);
          noAadhaar(qr.v);
        } else {
          expect(qr.e).toMatchObject({ code: "IPB-PORT-001", meta: { reason: "unsupported" } });
        }
      },
    },
    {
      name: "digilockerPull: documents by STORAGE reference; a consent session is single use",
      method: "digilockerPull",
      invoke: (p) =>
        p.digilockerPull({ consentSession: fx.digilockerConsent(), docTypes: ["PANCR"] }),
      async run(p) {
        const consentSession = fx.digilockerConsent();
        const docs = await p.digilockerPull({ consentSession, docTypes: ["PANCR", "ADHAR"] });
        expect(docs.map((d) => d.docType).sort()).toEqual(["ADHAR", "PANCR"]);
        for (const d of docs) expect(d.file.sha256).toMatch(/^[0-9a-f]{64}$/);
        noAadhaar(docs);
        await expect(p.digilockerPull({ consentSession, docTypes: ["PANCR"] })).rejects.toThrow();
      },
    },
    {
      name: "startDigilocker (PR-UDF-040): a consent session, an https sign-in address and its expiry; a return address that is not https or not on the allowed hosts is refused",
      method: "startDigilocker",
      invoke: (p) => start(p)({ docTypes: ["PANCR"], returnUrl: returnUrl() }),
      async run(p) {
        const s = await start(p)({ docTypes: ["PANCR", "ADHAR"], returnUrl: returnUrl() });
        expect(s.consentSession.length).toBeGreaterThanOrEqual(8);
        expect(s.consentSession.length).toBeLessThanOrEqual(200);
        expect(new URL(s.signInUrl).protocol).toBe("https:");
        expect(Date.parse(s.expiresAt)).toBeGreaterThan(Date.now());
        expect(s.vendorRef).not.toBe("");
        expect(s.adapter).toBe(p.descriptor.adapter);
        noAadhaar(s);
        const ok = new URL(returnUrl());
        for (const bad of [
          returnUrl().replace(/^https:/, "http:"),
          `https://not-listed.example.net${ok.pathname}`,
          `https://${ok.hostname}.not-listed.example.net${ok.pathname}`,
          `https://user:pw@${ok.host}${ok.pathname}`,
        ])
          await expect(start(p)({ docTypes: ["PANCR"], returnUrl: bad })).rejects.toMatchObject({
            code: "IPB-PORT-001",
            meta: { reason: "return_url_not_allowed" },
          });
        // Not completed yet: refused, and the product may try again within the session.
        for (let i = 0; i < 2; i++)
          expect(
            await refusal(
              p.digilockerPull({ consentSession: s.consentSession, docTypes: ["PANCR"] }),
            ),
          ).toEqual({ code: "IPB-PORT-001", reason: "consent_incomplete" });
      },
    },
    {
      name: "digilockerPull (PR-UDF-040): each document carries its evidence and the issuer's signature result; no storage key or issuer carries a 12-digit run",
      method: "digilockerPull",
      invoke: (p) =>
        p.digilockerPull({ consentSession: fx.digilockerConsent(), docTypes: ["PANCR"] }),
      async run(p) {
        const docs = await p.digilockerPull({
          consentSession: fx.digilockerConsent(),
          docTypes: ["PANCR", "ADHAR"],
        });
        expect(docs.length).toBeGreaterThan(0);
        for (const d of docs) {
          expect(d.evidence).toMatchObject({ adapter: p.descriptor.adapter });
          expect(d.evidence?.vendorRef).not.toBe("");
          expect(d.evidence?.modelVersion).not.toBe("");
          expect(Number.isNaN(Date.parse(d.evidence?.checkedAt ?? ""))).toBe(false);
          expect(d.signatureValid === null || typeof d.signatureValid === "boolean").toBe(true);
        }
        noRunInKeys(docs);
      },
    },
    {
      name: "digilockerPull (PR-UDF-040): a retry with the same key returns the same documents; the same key with another session or other types is IPB-PORT-004",
      method: "digilockerPull",
      invoke: (p) =>
        p.digilockerPull({ consentSession: fx.digilockerConsent(), docTypes: ["PANCR"] }),
      async run(p) {
        const idempotencyKey = key();
        const consentSession = fx.digilockerConsent();
        const first = await p.digilockerPull(
          { consentSession, docTypes: ["PANCR", "ADHAR"] },
          { idempotencyKey },
        );
        const again = await p.digilockerPull(
          { consentSession, docTypes: ["ADHAR", "PANCR"] },
          { idempotencyKey },
        );
        expect(again).toEqual(first);
        // Without the key the session is still single use.
        expect(
          await refusal(p.digilockerPull({ consentSession, docTypes: ["PANCR", "ADHAR"] })),
        ).toEqual({ code: "IPB-PORT-001", reason: "consent_used" });
        await expect(
          p.digilockerPull(
            { consentSession: fx.digilockerConsent(), docTypes: ["PANCR", "ADHAR"] },
            { idempotencyKey },
          ),
        ).rejects.toMatchObject({ code: "IPB-PORT-004" });
        await expect(
          p.digilockerPull({ consentSession, docTypes: ["PANCR"] }, { idempotencyKey }),
        ).rejects.toMatchObject({ code: "IPB-PORT-004" });
        // A new key on a used session is refused, never served from another key's pull.
        expect(
          await refusal(
            p.digilockerPull(
              { consentSession, docTypes: ["PANCR", "ADHAR"] },
              { idempotencyKey: key() },
            ),
          ),
        ).toEqual({ code: "IPB-PORT-001", reason: "consent_used" });
      },
    },
    {
      name: "aadhaarOtpRequest and aadhaarOtpVerify (PR-UDF-041): an OTP for an Aadhaar number and a VID; the e-KYC by STORAGE reference, the signature result and the last four digits only",
      method: "aadhaarOtpRequest",
      invoke: (p) => otpReq(p)(aadhaar(otpFx().uid)),
      async run(p) {
        const o = otpFx();
        const s = await otpReq(p)(aadhaar(o.uid));
        expect(s.txn.length).toBeGreaterThanOrEqual(8);
        expect(s.txn.length).toBeLessThanOrEqual(200);
        expect(Date.parse(s.expiresAt)).toBeGreaterThan(Date.now());
        expect(s.adapter).toBe(p.descriptor.adapter);
        expect(s.vendorRef).not.toBe("");
        const r = await otpVerify(p)({ txn: s.txn, otp: o.otp });
        expect(r.adapter).toBe(p.descriptor.adapter);
        expect(r.vendorRef).not.toBe("");
        expect(r.modelVersion).not.toBe("");
        expect(Number.isNaN(Date.parse(r.checkedAt))).toBe(false);
        expect(r.ekyc.storageKey).not.toBe("");
        expect(r.ekyc.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(r.signatureValid === null || typeof r.signatureValid === "boolean").toBe(true);
        expect(r.uidLast4).toBe(o.uid.slice(-4));
        expect(Object.keys(r).sort()).toEqual([
          "adapter",
          "checkedAt",
          "ekyc",
          "modelVersion",
          "signatureValid",
          "uidLast4",
          "vendorRef",
        ]);
        noUid([s, r], [o.uid]);
        const v = await otpReq(p)({ uid: o.vid, uidKind: "VID", consent: consent() });
        const rv = await otpVerify(p)({ txn: v.txn, otp: o.otp });
        expect(rv.uidLast4).toMatch(/^[0-9]{4}$/);
        noUid([v, rv], [o.vid, o.uid]);
      },
    },
    {
      name: "Aadhaar OTP (PR-UDF-041): uid_invalid before any vendor call, mobile_not_linked, otp_invalid and otp_expired, each definite",
      method: "aadhaarOtpRequest",
      invoke: (p) => otpReq(p)(aadhaar(otpFx().uid)),
      async run(p) {
        const o = otpFx();
        const before = o.vendorCalls(p);
        const bumped = `${o.uid.slice(0, -1)}${(Number(o.uid.at(-1)) + 1) % 10}`;
        for (const bad of [
          aadhaar(bumped),
          aadhaar(`${o.uid.slice(0, 4)} ${o.uid.slice(4, 8)} ${o.uid.slice(8)}`),
          aadhaar(`1${o.uid.slice(1)}`),
          aadhaar(o.vid),
          { uid: o.uid, uidKind: "VID" as const, consent: consent() },
          aadhaar(""),
        ]) {
          const e = await otpReq(p)(bad).then(
            () => undefined,
            (x: unknown) => x,
          );
          expect(e).toMatchObject(definite("uid_invalid"));
          noUid(errorText(e), [o.uid, o.vid, bumped]);
        }
        expect(o.vendorCalls(p)).toBe(before);
        await expect(otpReq(p)(aadhaar(o.unlinkedUid))).rejects.toMatchObject(
          definite("mobile_not_linked"),
        );
        const s = await otpReq(p)(aadhaar(o.uid));
        await expect(otpVerify(p)({ txn: s.txn, otp: o.wrongOtp })).rejects.toMatchObject(
          definite("otp_invalid"),
        );
        await otpVerify(p)({ txn: s.txn, otp: o.otp });
        // A used transaction, or one the KUA does not know, is no longer live.
        await expect(otpVerify(p)({ txn: s.txn, otp: o.otp })).rejects.toMatchObject(
          definite("otp_expired"),
        );
        await expect(
          otpVerify(p)({ txn: "aotp-contract-unknown", otp: o.otp }),
        ).rejects.toMatchObject(definite("otp_expired"));
        if (o.expire) {
          const t = await otpReq(p)(aadhaar(o.uid));
          await o.expire(p, t.txn);
          await expect(otpVerify(p)({ txn: t.txn, otp: o.otp })).rejects.toMatchObject(
            definite("otp_expired"),
          );
        }
      },
    },
    {
      name: "Aadhaar OTP (PR-UDF-041): an adapter not built for a notified entity refuses every call not_configured, before any vendor call",
      method: "aadhaarOtpRequest",
      invoke: (p) => otpReq(p)(aadhaar(otpFx().uid)),
      async run() {
        const o = otpFx();
        const { port, vendorCalls } = o.notNotified();
        const before = vendorCalls();
        for (const req of [aadhaar(o.uid), aadhaar("not-a-number")])
          await expect(otpReq(port)(req)).rejects.toMatchObject(definite("not_configured"));
        await expect(
          otpVerify(port)(
            { txn: "aotp-contract-any", otp: o.otp },
            { idempotencyKey: otpCallKey() },
          ),
        ).rejects.toMatchObject(definite("not_configured"));
        expect(vendorCalls()).toBe(before);
      },
    },
    {
      name: "aadhaarOtpVerify (PR-UDF-041): a retry with the same key returns the first answer with no vendor call; the same key with another code or transaction is IPB-PORT-004",
      method: "aadhaarOtpVerify",
      invoke: (p) => otpVerify(p)({ txn: "aotp-contract-any", otp: otpFx().otp }),
      async run(p) {
        const o = otpFx();
        const idempotencyKey = otpCallKey();
        const s = await otpReq(p)(aadhaar(o.uid));
        const first = await otpVerify(p)({ txn: s.txn, otp: o.otp }, { idempotencyKey });
        const before = o.vendorCalls(p);
        expect(await otpVerify(p)({ txn: s.txn, otp: o.otp }, { idempotencyKey })).toEqual(first);
        expect(o.vendorCalls(p)).toBe(before);
        const conflict = { code: "IPB-PORT-004", meta: { reason: "idempotency_conflict" } };
        await expect(
          otpVerify(p)({ txn: s.txn, otp: o.wrongOtp }, { idempotencyKey }),
        ).rejects.toMatchObject(conflict);
        const other = await otpReq(p)(aadhaar(o.uid));
        await expect(
          otpVerify(p)({ txn: other.txn, otp: o.otp }, { idempotencyKey }),
        ).rejects.toMatchObject(conflict);
        // Another key on the used transaction is refused, never served from the first key.
        await expect(
          otpVerify(p)({ txn: s.txn, otp: o.otp }, { idempotencyKey: otpCallKey() }),
        ).rejects.toMatchObject(definite("otp_expired"));
        // A refusal is the first answer too.
        const k2 = otpCallKey();
        for (let i = 0; i < 2; i++)
          await expect(
            otpVerify(p)({ txn: other.txn, otp: o.wrongOtp }, { idempotencyKey: k2 }),
          ).rejects.toMatchObject(definite("otp_invalid"));
        await expect(
          otpVerify(p)({ txn: other.txn, otp: o.otp }, { idempotencyKey: k2 }),
        ).rejects.toMatchObject(conflict);
        expect(
          (await otpVerify(p)({ txn: other.txn, otp: o.otp }, { idempotencyKey: otpCallKey() }))
            .uidLast4,
        ).toBe(o.uid.slice(-4));
      },
    },
    {
      name: "Aadhaar OTP (PR-UDF-041): no field of any answer, error or ledger entry carries a 12-digit or 16-digit run, or the number given",
      method: "aadhaarOtpRequest",
      invoke: (p) => otpReq(p)(aadhaar(otpFx().uid)),
      async run(p) {
        const o = otpFx();
        const seen: unknown[] = [];
        const take = async (x: Promise<unknown>) =>
          x.then(
            (v) => seen.push(v),
            (e: unknown) => seen.push(errorText(e)),
          );
        const key = otpCallKey();
        const s = (await otpReq(p)(aadhaar(o.uid))) as { txn: string };
        seen.push(s);
        await take(otpVerify(p)({ txn: s.txn, otp: o.wrongOtp }));
        await take(otpVerify(p)({ txn: s.txn, otp: o.otp }, { idempotencyKey: key }));
        await take(otpVerify(p)({ txn: s.txn, otp: o.otp }, { idempotencyKey: key }));
        await take(otpVerify(p)({ txn: s.txn, otp: o.wrongOtp }, { idempotencyKey: key }));
        await take(otpVerify(p)({ txn: s.txn, otp: o.otp }));
        await take(otpReq(p)({ uid: o.vid, uidKind: "VID", consent: consent() }));
        await take(otpReq(p)(aadhaar(o.unlinkedUid)));
        await take(otpReq(p)(aadhaar(`${o.uid.slice(0, 6)}-${o.uid.slice(6)}`)));
        await take(otpReq(p)({ uid: o.uid, uidKind: "VID", consent: consent() }));
        await take(o.notNotified().port.aadhaarOtpRequest!(aadhaar(o.uid)));
        expect(seen.length).toBe(11);
        noUid(seen, [o.uid, o.vid, o.unlinkedUid]);
        if (o.ledger) noUid(await o.ledger(), [o.uid, o.vid, o.unlinkedUid]);
      },
    },
    {
      name: "ckycSearch then ckycDownload with the authentication factor; a wrong factor is refused",
      method: "ckycDownload",
      invoke: (p) =>
        p.ckycDownload({
          ckycNumber: fx.ckyc.ckycNumber,
          authFactor: fx.ckyc.authFactor,
          consentRef: "consent-ckyc-0",
        }),
      async run(p) {
        const s = await p.ckycSearch({ idType: "PAN", idNumber: fx.ckyc.idNumber });
        expect(s).toMatchObject({ found: true, ckycNumber: fx.ckyc.ckycNumber });
        const rec = await p.ckycDownload({
          ckycNumber: fx.ckyc.ckycNumber,
          authFactor: fx.ckyc.authFactor,
          consentRef: "consent-ckyc-1",
        });
        expect(rec.record.sha256).toMatch(/^[0-9a-f]{64}$/);
        noAadhaar(rec);
        await expect(
          p.ckycDownload({
            ckycNumber: fx.ckyc.ckycNumber,
            authFactor: "0000-00-00",
            consentRef: "consent-ckyc-2",
          }),
        ).rejects.toThrow();
      },
    },
    {
      name: "liveness and face match return a score, a pass against the threshold, and the model version",
      method: "faceMatch",
      invoke: (p) => p.faceMatch({ a: fx.faces.a, b: fx.faces.same }),
      async run(p) {
        const l = await p.livenessCheck({ frames: fx.frames });
        expect(l.score).toBeGreaterThanOrEqual(0);
        expect(l.score).toBeLessThanOrEqual(1);
        expect(l.modelVersion).not.toBe("");
        expect((await p.faceMatch({ a: fx.faces.a, b: fx.faces.same })).passed).toBe(true);
        expect((await p.faceMatch({ a: fx.faces.a, b: fx.faces.other })).passed).toBe(false);
      },
    },
    {
      name: "livenessCheck (PR-UDF-044): the mode asked is the mode used; omitted, the configured mode is reported; the threshold applied is reported and the score is from 0 to 1",
      method: "livenessCheck",
      invoke: (p) => p.livenessCheck(frames()),
      async run(p) {
        const s = scoreFx();
        expect(s.modes).toContain(s.configuredMode);
        for (const mode of s.modes) {
          const r = await p.livenessCheck(frames(mode));
          expect(r.mode).toBe(mode);
          scoredWell(r, p);
          expect(r.passed).toBe(true);
        }
        const plain = await p.livenessCheck(frames());
        expect(plain.mode).toBe(s.configuredMode);
        scoredWell(plain, p);
        // A weak check is scored, not refused, and fails against the threshold applied.
        const weak = await p.livenessCheck(frames(undefined, [fx.faces.other]));
        scoredWell(weak, p);
        expect(weak.passed).toBe(false);
        await expect(
          p.livenessCheck({ ...frames(), mode: "blink" as LivenessMode }),
        ).rejects.toThrow();
      },
    },
    {
      name: "faceMatch (PR-UDF-044): the threshold applied is reported, the score is from 0 to 1, and no liveness mode is set",
      method: "faceMatch",
      invoke: (p) => p.faceMatch({ a: fx.faces.a, b: fx.faces.same }),
      async run(p) {
        const same = await p.faceMatch({ a: fx.faces.a, b: fx.faces.same });
        scoredWell(same, p);
        expect(same.passed).toBe(true);
        const other = await p.faceMatch({ a: fx.faces.a, b: fx.faces.other });
        scoredWell(other, p);
        expect(other.passed).toBe(false);
        for (const r of [same, other]) expect(r.mode).toBeUndefined();
      },
    },
    {
      name: "livenessCheck (PR-UDF-044): a mode the adapter cannot honour is refused mode_unsupported before any vendor call, keyed or not",
      method: "livenessCheck",
      invoke: (p) => p.livenessCheck(frames()),
      async run() {
        const { port, mode, vendorCalls } = scoreFx().refusing();
        const before = vendorCalls();
        const modeUnsupported = { code: "IPB-PORT-002", meta: { reason: "mode_unsupported" } };
        await expect(port.livenessCheck(frames(mode))).rejects.toMatchObject(modeUnsupported);
        const idempotencyKey = scoreCallKey();
        await expect(port.livenessCheck(frames(mode), { idempotencyKey })).rejects.toMatchObject(
          modeUnsupported,
        );
        expect(vendorCalls()).toBe(before);
        // Refused, not used up: the key still serves a mode the adapter honours.
        const ok = await port.livenessCheck(frames(), { idempotencyKey });
        expect(ok.mode).not.toBe(mode);
        expect(vendorCalls()).toBeGreaterThan(before);
      },
    },
    {
      name: "livenessCheck (PR-UDF-044): a retry with the same key returns the first answer with no second vendor call; the same key with other frames or another mode is IPB-PORT-004",
      method: "livenessCheck",
      invoke: (p) => p.livenessCheck(frames()),
      async run(p) {
        const s = scoreFx();
        const idempotencyKey = scoreCallKey();
        const before = s.livenessVendorCalls(p);
        const first = await p.livenessCheck(frames(), { idempotencyKey });
        const after = s.livenessVendorCalls(p);
        expect(after).toBeGreaterThan(before);
        expect(await p.livenessCheck(frames(), { idempotencyKey })).toEqual(first);
        // An omitted mode is the configured one: the same request.
        expect(await p.livenessCheck(frames(s.configuredMode), { idempotencyKey })).toEqual(first);
        expect(s.livenessVendorCalls(p)).toBe(after);
        for (const other of [
          frames(undefined, fx.frames.slice(1)),
          frames(undefined, [...fx.frames, fx.faces.a]),
          ...s.modes.filter((m) => m !== s.configuredMode).map((m) => frames(m)),
        ])
          await expect(p.livenessCheck(other, { idempotencyKey })).rejects.toMatchObject(
            idemConflict,
          );
        expect(s.livenessVendorCalls(p)).toBe(after);
        // A key is scoped to its method: the same key on faceMatch is another check.
        const fBefore = s.faceMatchVendorCalls(p);
        const face = await p.faceMatch({ a: fx.faces.a, b: fx.faces.same }, { idempotencyKey });
        expect(face.mode).toBeUndefined();
        expect(s.faceMatchVendorCalls(p)).toBeGreaterThan(fBefore);
        // Another key is a new check.
        await p.livenessCheck(frames(), { idempotencyKey: scoreCallKey() });
        expect(s.livenessVendorCalls(p)).toBeGreaterThan(after);
      },
    },
    {
      name: "faceMatch (PR-UDF-044): a retry with the same key returns the first answer with no second vendor call; the same key with other images is IPB-PORT-004",
      method: "faceMatch",
      invoke: (p) => p.faceMatch({ a: fx.faces.a, b: fx.faces.same }),
      async run(p) {
        const s = scoreFx();
        const idempotencyKey = scoreCallKey();
        const before = s.faceMatchVendorCalls(p);
        const first = await p.faceMatch({ a: fx.faces.a, b: fx.faces.same }, { idempotencyKey });
        const after = s.faceMatchVendorCalls(p);
        expect(after).toBeGreaterThan(before);
        expect(await p.faceMatch({ a: fx.faces.a, b: fx.faces.same }, { idempotencyKey })).toEqual(
          first,
        );
        expect(s.faceMatchVendorCalls(p)).toBe(after);
        for (const other of [
          { a: fx.faces.a, b: fx.faces.other },
          { a: fx.faces.same, b: fx.faces.a },
          { a: fx.faces.a, b: { ...fx.faces.same, sha256: "0".repeat(64) } },
        ])
          await expect(p.faceMatch(other, { idempotencyKey })).rejects.toMatchObject(idemConflict);
        expect(s.faceMatchVendorCalls(p)).toBe(after);
        // A failed match is the key's first answer too.
        const k2 = scoreCallKey();
        const miss = await p.faceMatch(
          { a: fx.faces.a, b: fx.faces.other },
          { idempotencyKey: k2 },
        );
        expect(miss.passed).toBe(false);
        const calls = s.faceMatchVendorCalls(p);
        expect(
          await p.faceMatch({ a: fx.faces.a, b: fx.faces.other }, { idempotencyKey: k2 }),
        ).toEqual(miss);
        expect(s.faceMatchVendorCalls(p)).toBe(calls);
      },
    },
    {
      name: "livenessCheck and faceMatch (PR-UDF-044): a vendor score off its scale is refused IPB-PORT-003 score_out_of_range, never clamped, and a keyed retry asks again",
      method: "livenessCheck",
      invoke: (p) => p.livenessCheck(frames()),
      async run(p) {
        const s = scoreFx();
        if (!s.offScaleNext) return;
        await s.offScaleNext(p);
        await expect(p.livenessCheck(frames())).rejects.toMatchObject(offScale);
        const idempotencyKey = scoreCallKey();
        await s.offScaleNext(p);
        await expect(
          p.faceMatch({ a: fx.faces.a, b: fx.faces.same }, { idempotencyKey }),
        ).rejects.toMatchObject(offScale);
        // Nothing was kept for the key: its retry is a new vendor call with a score on the scale.
        const calls = s.faceMatchVendorCalls(p);
        const r = await p.faceMatch({ a: fx.faces.a, b: fx.faces.same }, { idempotencyKey });
        scoredWell(r, p);
        expect(s.faceMatchVendorCalls(p)).toBeGreaterThan(calls);
      },
    },
    {
      name: "livenessCheck and faceMatch (PR-UDF-044): no field of any answer or error carries an Aadhaar-like number or a 12-digit run",
      method: "livenessCheck",
      invoke: (p) => p.livenessCheck(frames()),
      async run(p) {
        const s = scoreFx();
        const seen: unknown[] = [];
        const take = async (x: Promise<unknown>) =>
          x.then(
            (v) => seen.push(v),
            (e: unknown) => seen.push(errorText(e)),
          );
        const k = scoreCallKey();
        for (const mode of [undefined, ...s.modes]) await take(p.livenessCheck(frames(mode)));
        await take(p.livenessCheck(frames(), { idempotencyKey: k }));
        await take(p.livenessCheck(frames(), { idempotencyKey: k }));
        await take(p.livenessCheck(frames(undefined, fx.frames.slice(1)), { idempotencyKey: k }));
        await take(p.faceMatch({ a: fx.faces.a, b: fx.faces.same }, { idempotencyKey: k }));
        await take(p.faceMatch({ a: fx.faces.a, b: fx.faces.other }, { idempotencyKey: k }));
        await take(p.faceMatch({ a: fx.faces.a, b: fx.faces.other }));
        const r = s.refusing();
        await take(r.port.livenessCheck(frames(r.mode)));
        if (s.offScaleNext) {
          await s.offScaleNext(p);
          await take(p.livenessCheck(frames()));
        }
        expect(seen.length).toBe(s.modes.length + 8 + (s.offScaleNext ? 1 : 0));
        for (const v of seen) {
          const text = typeof v === "string" ? v : JSON.stringify(v);
          expect(findAadhaarLike(text)).toEqual([]);
          if (typeof v !== "string") noAadhaar(v);
        }
      },
    },
    {
      name: "startVcip opens a session the vendor reports back, with the official named",
      method: "startVcip",
      invoke: (p) =>
        p.startVcip({
          sessionId: "vcs_contract_0",
          tenantId: "tnt_kyc",
          customerRef: "cus:contract",
          officialRef: "usr_official",
          roomId: "room_contract_0",
          documents: [],
        }),
      async run(p) {
        const v = await p.startVcip({
          sessionId: "vcs_contract_1",
          tenantId: "tnt_kyc",
          customerRef: "cus:contract",
          officialRef: "usr_official",
          roomId: "room_contract_1",
          documents: [fx.ovd],
        });
        expect(["scheduled", "in_progress"]).toContain(v.state);
        const m = await p.vcipStatus(v.vcipId);
        expect(m).toMatchObject({
          vcipId: v.vcipId,
          sessionId: "vcs_contract_1",
          officialRef: "usr_official",
        });
        await expect(p.vcipStatus("vcip_missing")).rejects.toMatchObject({ code: "IPB-PORT-001" });
      },
    },
    {
      name: "launchVcip (PR-UDF-045): a signed hand-off schedules a session with an https launch address on the adapter's hosts, lapsing no later than the hand-off; it reads back under the call's tenant only",
      method: "launchVcip",
      invoke: (p) => launcher(p)({ context: staticHandoff(), jws: "e30..c2lnbmF0dXJl" }),
      async run(p) {
        const l = launchFx();
        const launch = launcher(p);
        expect(payloadClass(LaunchVcip)).toMatchObject({ complete: true, unannotated: [] });
        const c = l.context();
        const before = l.vendorCalls(p);
        const r = await launch({ context: c, jws: await l.sign(c) }, { tenantId: c.tenantId });
        expect(l.vendorCalls(p)).toBe(before + 1);
        expect(r.vcipId).not.toBe("");
        expect(vcipLaunchUrlAllowed(r.launchUrl, l.launchHosts), r.launchUrl).toBe(true);
        expect(Date.parse(r.expiresAt)).toBeLessThanOrEqual(Date.parse(c.expiresAt));
        expect(Date.parse(r.expiresAt)).toBeGreaterThan(Date.now());
        expect(r.adapter).toBe(p.descriptor.adapter);
        const m = await p.vcipStatus(r.vcipId, { tenantId: c.tenantId });
        expect(m).toMatchObject({ vcipId: r.vcipId, sessionId: c.journeyId, state: "scheduled" });
        await expect(
          p.vcipStatus(r.vcipId, { tenantId: "tnt_someone_else" }),
        ).rejects.toMatchObject({ code: "IPB-PORT-001" });
        for (const v of [r, m]) expect(findAadhaarLike(JSON.stringify(v))).toEqual([]);
      },
    },
    {
      name: "launchVcip (PR-UDF-045): a replayed, expired, stale, tampered, mismatched, untrusted, other-tenant, other-RE or overlong hand-off is refused with its fixed label, definite, before any vendor call",
      method: "launchVcip",
      invoke: (p) => launcher(p)({ context: staticHandoff(), jws: "e30..c2lnbmF0dXJl" }),
      async run(p) {
        const l = launchFx();
        const launch = launcher(p);
        const now = Date.now();
        const min = 60_000;
        // Replay: the same signed hand-off twice.
        const c1 = l.context();
        const j1 = await l.sign(c1);
        await launch({ context: c1, jws: j1 });
        const calls = l.vendorCalls(p);
        const cases: Array<[string, () => Promise<unknown>]> = [
          ["handoff_replayed", () => launch({ context: c1, jws: j1 })],
          [
            "handoff_expired",
            async () => {
              const c = l.context({}, new Date(now - 20 * min));
              return launch({ context: c, jws: await l.sign(c) });
            },
          ],
          [
            "handoff_expired",
            async () => {
              const c = l.context();
              return launch({ context: c, jws: await l.sign(c, new Date(now - 10 * min)) });
            },
          ],
          [
            "handoff_invalid",
            async () => {
              const c = l.context();
              const j = await l.sign(c);
              const i = j.length - 20;
              const t = `${j.slice(0, i)}${j[i] === "A" ? "B" : "A"}${j.slice(i + 1)}`;
              return launch({ context: c, jws: t });
            },
          ],
          [
            "handoff_invalid",
            async () => {
              const c = l.context();
              const j = await l.sign(c);
              return launch({ context: { ...c, customerRef: "cus_someone_else" }, jws: j });
            },
          ],
          [
            "handoff_invalid",
            async () => {
              const c = l.context();
              return launch({ context: c, jws: await l.signUntrusted(c) });
            },
          ],
          [
            "handoff_invalid",
            async () => {
              const c = l.context();
              return launch({ context: c, jws: await l.sign(c) }, { tenantId: "tnt_someone_else" });
            },
          ],
          [
            "handoff_invalid",
            async () => {
              const c = l.context({ reId: "re_someone_else" });
              return launch({ context: c, jws: await l.sign(c) });
            },
          ],
          [
            "handoff_invalid",
            async () => {
              const c = l.context();
              const long = {
                ...c,
                expiresAt: new Date(
                  Date.parse(c.issuedAt) + (VCIP_HANDOFF_MAX_LIFETIME_SECONDS + 60) * 1000,
                ).toISOString(),
              };
              return launch({ context: long, jws: await l.sign(long) });
            },
          ],
          [
            "handoff_invalid",
            async () => {
              const c = { ...l.context(), name: "Asha Rao" } as VcipHandoffContext;
              return launch({ context: c, jws: await l.sign(c) });
            },
          ],
          ["handoff_invalid", () => launch({ context: l.context(), jws: "not-a-jws" })],
        ];
        for (const [reason, go] of cases) {
          let thrown: unknown;
          await go().then(
            () => undefined,
            (e: unknown) => (thrown = e),
          );
          expect(thrown, reason).toMatchObject(handoffRefused(reason));
          expect(findAadhaarLike(errorText(thrown))).toEqual([]);
        }
        expect(l.vendorCalls(p)).toBe(calls);
      },
    },
    {
      name: "vcipStatus (PR-UDF-045): no manifest field carries a 12-digit run or an Aadhaar-like number; an ended session's reason is a code and its liveness mode one of the modes",
      method: "launchVcip",
      invoke: (p) => launcher(p)({ context: staticHandoff(), jws: "e30..c2lnbmF0dXJl" }),
      async run(p) {
        const l = launchFx();
        const launch = launcher(p);
        const manifests: VcipManifest[] = [];
        const ended = ["completed", "rejected", "dropped"] as const;
        for (const state of [undefined, ...(l.finish ? ended : [])]) {
          const c = l.context();
          const r = await launch({ context: c, jws: await l.sign(c) }, { tenantId: c.tenantId });
          if (state) await l.finish!(p, r.vcipId, state);
          const m = await p.vcipStatus(r.vcipId, { tenantId: c.tenantId });
          if (state) expect(m.state).toBe(state);
          manifests.push(m);
        }
        for (const m of manifests) {
          const text = JSON.stringify(m);
          expect(text.replace(SHA256_HEX, "")).not.toMatch(AADHAAR_LIKE);
          expect(findAadhaarLike(text, { letters: "join" })).toEqual([]);
          if (m.reasonCode !== undefined) expect(VCIP_REASON_CODES).toContain(m.reasonCode);
          if (m.state === "rejected" || m.state === "dropped") expect(m.reasonCode).toBeDefined();
          if (m.liveness?.mode !== undefined) expect(LIVENESS_MODES).toContain(m.liveness.mode);
        }
      },
    },
    {
      name: "verifyWebhook (PR-UDF-046): a signed event answers its delivery id, the session and the time only, with no vendor call; a provider's retry verifies again; handleWebhook verifies, then reads back",
      method: "verifyWebhook",
      invoke: (p) => verifier(p)(new TextEncoder().encode("{}"), {}),
      async run(p) {
        const w = hookFx();
        const verify = verifier(p);
        const vcipId = await w.session(p);
        const body = w.body(vcipId);
        const id = `msg_contract_${Date.now().toString(36)}`;
        const before = w.vendorCalls(p);
        const r = await verify(body, w.sign(body, { id }));
        expect(Object.keys(r).sort()).toEqual(["eventId", "receivedAt", "vcipId"]);
        expect(r).toMatchObject({ eventId: id, vcipId });
        expect(Math.abs(Date.parse(r.receivedAt) - Date.now())).toBeLessThan(60_000);
        expect(w.vendorCalls(p)).toBe(before);
        expect(findAadhaarLike(JSON.stringify(r), { letters: "join" })).toEqual([]);
        // A provider's retry of the same event: the same id, a new timestamp and signature.
        const retry = await verify(body, w.sign(body, { id, at: minutes(-1) }));
        expect(retry.eventId).toBe(id);
        expect(w.vendorCalls(p)).toBe(before);
        const m = await p.handleWebhook(body, w.sign(body));
        expect(m.vcipId).toBe(vcipId);
        expect(w.vendorCalls(p)).toBeGreaterThan(before);
      },
    },
    {
      name: "verifyWebhook (PR-UDF-046): a forged, tampered, unsigned, stale, future, replayed or oversize event is refused IPB-API-018 with its fixed label, definite, by verifyWebhook and handleWebhook alike, with no vendor call",
      method: "verifyWebhook",
      invoke: (p) => verifier(p)(new TextEncoder().encode("{}"), {}),
      async run(p) {
        const w = hookFx();
        const verify = verifier(p);
        const vcipId = await w.session(p);
        const body = w.body(vcipId);
        const replayed = w.sign(body);
        await verify(body, replayed);
        const tampered = new TextEncoder().encode(
          new TextDecoder().decode(body).replace(vcipId, `${vcipId}x`),
        );
        const big = new Uint8Array(KYC_WEBHOOK_MAX_BODY_BYTES + 1).fill(0x20);
        big.set(body);
        const noSignature = Object.fromEntries(
          Object.entries(w.sign(body)).filter(([k]) => k.toLowerCase() !== "webhook-signature"),
        );
        const cases: Array<[string, Uint8Array, Record<string, string>]> = [
          ["signature_invalid", body, w.signUntrusted(body)],
          ["signature_invalid", tampered, w.sign(body)],
          ["signature_invalid", body, {}],
          ["signature_invalid", body, noSignature],
          ["timestamp_stale", body, w.sign(body, { at: minutes(-6) })],
          ["timestamp_stale", body, w.sign(body, { at: minutes(6) })],
          ["event_replayed", body, replayed],
          ["body_too_large", big, w.sign(big)],
        ];
        const calls = w.vendorCalls(p);
        for (const [reason, b, h] of cases) {
          expect(KYC_WEBHOOK_REFUSALS).toContain(reason);
          for (const go of [() => verify(b, h), () => p.handleWebhook(b, h)]) {
            let thrown: unknown;
            await go().then(
              () => undefined,
              (e: unknown) => (thrown = e),
            );
            expect(thrown, reason).toMatchObject(hookRefused(reason));
            const text = errorText(thrown);
            expect(text).not.toContain(vcipId);
            expect(findAadhaarLike(text)).toEqual([]);
          }
        }
        expect(w.vendorCalls(p)).toBe(calls);
        // A verified event that names no session is malformed, and nothing is read back.
        const empty = new TextEncoder().encode("{}");
        await expect(verify(empty, w.sign(empty))).rejects.toMatchObject({
          code: "IPB-PORT-001",
          meta: { reason: "malformed_event", definite: true },
        });
        expect(w.vendorCalls(p)).toBe(calls);
      },
    },
    {
      name: "bankAccountVerify (PR-UDF-043): the mode asked is the mode used; omitted, the configured mode is reported; the status is one of the four",
      method: "bankAccountVerify",
      invoke: (p) => p.bankAccountVerify(account()),
      async run(p) {
        const b = bankFx();
        expect(b.modes).toContain(b.configuredMode);
        for (const mode of b.modes) {
          const r = await p.bankAccountVerify(account(mode));
          expect(r).toMatchObject({ status: "valid", mode, nameMatch: "match" });
          expect(r.nameAtBank).toBeTypeOf("string");
        }
        expect(await p.bankAccountVerify(account())).toMatchObject({
          status: "valid",
          mode: b.configuredMode,
        });
        const unknown = await p.bankAccountVerify({
          ifsc: fx.bank.ifsc,
          accountNumber: b.unknownAccountNumber,
        });
        expect(BANK_ACCOUNT_STATUSES).toContain(unknown.status);
        expect(unknown.status).not.toBe("valid");
        expect(unknown.mode).toBe(b.configuredMode);
        await expect(
          p.bankAccountVerify({ ...account(), mode: "penny" as BankAccountMode }),
        ).rejects.toThrow();
      },
    },
    {
      name: "bankAccountVerify (PR-UDF-043): a mode the adapter cannot honour is refused mode_unsupported before any vendor call, keyed or not",
      method: "bankAccountVerify",
      invoke: (p) => p.bankAccountVerify(account()),
      async run() {
        const { port, mode, vendorCalls } = bankFx().refusing();
        const before = vendorCalls();
        await expect(port.bankAccountVerify(account(mode))).rejects.toMatchObject(modeUnsupported);
        const idempotencyKey = bankCallKey();
        await expect(
          port.bankAccountVerify(account(mode), { idempotencyKey }),
        ).rejects.toMatchObject(modeUnsupported);
        expect(vendorCalls()).toBe(before);
        // Refused, not used up: the key still serves a mode the adapter honours.
        const ok = await port.bankAccountVerify(account(), { idempotencyKey });
        expect(ok.mode).not.toBe(mode);
        expect(vendorCalls()).toBe(before + 1);
      },
    },
    {
      name: "bankAccountVerify (PR-UDF-043): a retry with the same key returns the first answer with exactly one vendor call; the same key with another account, IFSC, name or mode is IPB-PORT-004",
      method: "bankAccountVerify",
      invoke: (p) => p.bankAccountVerify(account()),
      async run(p) {
        const b = bankFx();
        const idempotencyKey = bankCallKey();
        const before = b.vendorCalls(p);
        const first = await p.bankAccountVerify(account(), { idempotencyKey });
        expect(b.vendorCalls(p)).toBe(before + 1);
        expect(await p.bankAccountVerify(account(), { idempotencyKey })).toEqual(first);
        // An omitted mode is the configured one: the same request.
        expect(await p.bankAccountVerify(account(b.configuredMode), { idempotencyKey })).toEqual(
          first,
        );
        expect(b.vendorCalls(p)).toBe(before + 1);
        for (const other of [
          { ...account(), accountNumber: b.unknownAccountNumber },
          { ...account(), ifsc: fx.bank.ifsc.replace(/.$/, (c) => (c === "9" ? "8" : "9")) },
          { ...account(), name: `${fx.bank.name} X` },
          { ifsc: fx.bank.ifsc, accountNumber: fx.bank.accountNumber },
          ...b.modes.filter((m) => m !== b.configuredMode).map((m) => account(m)),
        ])
          await expect(p.bankAccountVerify(other, { idempotencyKey })).rejects.toMatchObject(
            idemConflict,
          );
        expect(b.vendorCalls(p)).toBe(before + 1);
        // Another key is a new check.
        const again = await p.bankAccountVerify(account(), { idempotencyKey: bankCallKey() });
        expect(again.status).toBe(first.status);
        expect(b.vendorCalls(p)).toBe(before + 2);
        // A not-found answer is the key's first answer too.
        const k2 = bankCallKey();
        const nf = { ifsc: fx.bank.ifsc, accountNumber: b.unknownAccountNumber };
        const miss = await p.bankAccountVerify(nf, { idempotencyKey: k2 });
        expect(await p.bankAccountVerify(nf, { idempotencyKey: k2 })).toEqual(miss);
        expect(b.vendorCalls(p)).toBe(before + 3);
      },
    },
    {
      name: "bankAccountVerify (PR-UDF-043): no field of any answer or error carries an Aadhaar-like number, a 12-digit run or the account number",
      method: "bankAccountVerify",
      invoke: (p) => p.bankAccountVerify(account()),
      async run(p) {
        const b = bankFx();
        // The fixtures' accounts are not Aadhaar-like themselves, or the sweep would be empty.
        for (const n of [fx.bank.accountNumber, b.unknownAccountNumber])
          expect(findAadhaarLike(n)).toEqual([]);
        const seen: unknown[] = [];
        const take = async (x: Promise<unknown>) =>
          x.then(
            (v) => seen.push(v),
            (e: unknown) => seen.push(errorText(e)),
          );
        const k = bankCallKey();
        for (const mode of [undefined, ...b.modes]) await take(p.bankAccountVerify(account(mode)));
        await take(p.bankAccountVerify(account(), { idempotencyKey: k }));
        await take(p.bankAccountVerify(account(), { idempotencyKey: k }));
        await take(
          p.bankAccountVerify(
            { ...account(), accountNumber: b.unknownAccountNumber },
            { idempotencyKey: k },
          ),
        );
        await take(
          p.bankAccountVerify({ ifsc: fx.bank.ifsc, accountNumber: b.unknownAccountNumber }),
        );
        const r = b.refusing();
        await take(r.port.bankAccountVerify(account(r.mode)));
        expect(seen.length).toBe(b.modes.length + 6);
        for (const v of seen) {
          const text = typeof v === "string" ? v : JSON.stringify(v);
          expect(findAadhaarLike(text)).toEqual([]);
          expect(text).not.toContain(fx.bank.accountNumber);
          expect(text).not.toContain(b.unknownAccountNumber);
          if (typeof v !== "string") noAadhaar(v);
        }
      },
    },
    {
      name: "bankAccountVerify, ovdOcr and amlScreen",
      method: "amlScreen",
      invoke: (p) => p.amlScreen({ name: fx.aml.cleanName, kind: "individual" }),
      async run(p) {
        expect(
          await p.bankAccountVerify({
            ifsc: fx.bank.ifsc,
            accountNumber: fx.bank.accountNumber,
            name: fx.bank.name,
          }),
        ).toMatchObject({ status: "valid", nameMatch: "match" });
        await expect(
          p.bankAccountVerify({ ifsc: "bad", accountNumber: fx.bank.accountNumber }),
        ).rejects.toThrow();
        const o = await p.ovdOcr({ file: fx.ovd, docType: "PAN" });
        expect(o.confidence).toBeGreaterThan(0);
        expect(
          (await p.amlScreen({ name: fx.aml.listedName, kind: "individual" })).hits.length,
        ).toBeGreaterThan(0);
        const clean = await p.amlScreen({ name: fx.aml.cleanName, kind: "individual" });
        expect(clean.hits).toEqual([]);
        expect(clean.lists.length).toBeGreaterThan(0);
      },
    },
  ];
}
