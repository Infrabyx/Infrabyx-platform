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
  payloadClass,
  type DigilockerDocument,
  type KycPort,
} from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import {
  DIGILOCKER_CONTRACT_RETURN_URL,
  type AadhaarOtpFixtures,
  type KycFixtures,
} from "@infrabyx/fakes";
export {
  type AadhaarOtpFixtures,
  type KycFixtures,
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
