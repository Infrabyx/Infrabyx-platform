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
  type KycPort,
} from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { type KycFixtures } from "@infrabyx/fakes";
export { type KycFixtures, KYC_FAKE_FIXTURES, FakeKyc } from "@infrabyx/fakes";
const AADHAAR_LIKE = /(?<![0-9])[0-9]{12}(?![0-9])/;

/** The KYC contract: one list for the fake now and for every adapter later. */
export function kycContractCases(fx: KycFixtures): Array<ContractCase<KycPort>> {
  const noAadhaar = (v: unknown) => expect(JSON.stringify(v)).not.toMatch(AADHAAR_LIKE);
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
