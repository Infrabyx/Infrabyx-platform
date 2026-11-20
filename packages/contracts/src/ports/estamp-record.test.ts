// Recording a stamp the regulated entity already paid for (PR-UDF-054, R1-D-245): the record's
// rules, its classes, and the pack evidence made from a recorded certificate.
import { describe, expect, it } from "vitest";
import { PackStampEvidence, stampEvidenceOf } from "../events/documents.js";
import {
  STAMP_PURCHASE_NOT_PERMITTED,
  STAMP_RECORD_CHANNELS,
  STAMP_VERIFICATIONS,
  StampCertificateRecord,
  assertStampRecord,
  type EstampCertificate,
} from "./estamp.js";
import { payloadClass } from "./payload-class.js";
import { STAMP_MODES } from "../events/documents.js";

const sha = "b".repeat(64);
const eStamp = {
  channel: "E_STAMP",
  state: "MH",
  instrument: "5(h)",
  certificateNumber: "IN-MH12345678901234X",
  dutyMinor: 50_000,
  issuedAt: "2026-11-20T10:00:00+05:30",
  purchaser: { partyRef: "p1", name: "Party p1" },
  stampedDocument: { storageKey: "tenant/tnt_x/los/DOC.pdf", sha256: sha },
  recordedBy: { principalId: "usr_ops_1", principalType: "user" },
} as const;
const paper = {
  ...eStamp,
  channel: "PHYSICAL_PAPER",
  certificateNumber: "AB/123456",
  vendorLicence: "SV-MUM-0042",
  certificateDocumentId: "doc_stamp_scan_1",
} as const;
const ok = (r: unknown) => StampCertificateRecord.safeParse(r).success;

describe("@IPB-01-15 ESTAMP stamp records (R1-D-245)", () => {
  it("uses the evidence's channel names and fixed labels", () => {
    expect([...STAMP_RECORD_CHANNELS]).toEqual([...STAMP_MODES]);
    expect(STAMP_VERIFICATIONS).toEqual(["ISSUER_READBACK", "MANUAL_RECORD"]);
    expect(STAMP_PURCHASE_NOT_PERMITTED).toBe("purchase_not_permitted");
  });

  it("takes an e-stamp record, and paper or franking only with the licence and the scan", () => {
    expect(ok(eStamp)).toBe(true);
    expect(ok(paper)).toBe(true);
    expect(ok({ ...paper, channel: "FRANKING" })).toBe(true);
    const { vendorLicence: _l, ...noLicence } = paper;
    const { certificateDocumentId: _c, ...noScan } = paper;
    expect(ok(noLicence)).toBe(false);
    expect(ok(noScan)).toBe(false);
  });

  it("refuses deficient stamping, an agent recorder, a bad number or time and extra fields", () => {
    expect(ok({ ...eStamp, statedDutyMinor: 50_000 })).toBe(true);
    expect(ok({ ...eStamp, statedDutyMinor: 50_001 })).toBe(false);
    expect(
      ok({ ...eStamp, recordedBy: { principalId: "agt_vidhi", principalType: "agent" } }),
    ).toBe(false);
    expect(ok({ ...eStamp, certificateNumber: "a b" })).toBe(false);
    expect(ok({ ...eStamp, issuedAt: "2026-11-20" })).toBe(false);
    expect(ok({ ...eStamp, state: "IN-MH" })).toBe(false);
    expect(ok({ ...eStamp, authorisation: {} })).toBe(false);
  });

  it("refuses alike in every adapter: an agent, deficient stamping, a bad record or key", () => {
    expect(assertStampRecord("ESTAMP", eStamp, "record-key-0001").certificateNumber).toBe(
      eStamp.certificateNumber,
    );
    const agent = { ...eStamp, recordedBy: { principalId: "agt_vidhi", principalType: "agent" } };
    expect(() => assertStampRecord("ESTAMP", agent, "record-key-0001")).toThrow(
      expect.objectContaining({ code: "IPB-SEC-004" }),
    );
    expect(() =>
      assertStampRecord("ESTAMP", { ...eStamp, statedDutyMinor: 60_000 }, "record-key-0001"),
    ).toThrow(
      expect.objectContaining({ meta: expect.objectContaining({ reason: "deficient_stamping" }) }),
    );
    for (const [r, k] of [
      [{ ...eStamp, state: "Maharashtra" }, "record-key-0001"],
      [eStamp, "short"],
      [eStamp, undefined],
    ] as const)
      expect(() => assertStampRecord("ESTAMP", r, k)).toThrow(
        expect.objectContaining({
          code: "IPB-PORT-001",
          meta: expect.objectContaining({ reason: "invalid_request" }),
        }),
      );
  });

  it("classes the record REGULATED (duty and parties)", () => {
    expect(payloadClass(StampCertificateRecord).bodyHighest).toBe("REGULATED");
  });

  it("makes pack evidence from a recorded certificate, and refuses incomplete evidence", () => {
    const cert: EstampCertificate = {
      certificateId: "est_1",
      certificateNumber: "AB/123456",
      state: "issued",
      stateCode: "MH",
      instrument: "5(h)",
      dutyMinor: 50_000,
      purchaserRef: "p1",
      file: null,
      vendorRef: "manual:est_1",
      adapter: "manual-paper",
      issuedAt: "2026-11-20T04:30:00.000Z",
      channel: "PHYSICAL_PAPER",
      statedDutyMinor: 40_000,
      stampedDocumentSha256: sha,
      certificateDocumentId: "doc_stamp_scan_1",
      vendorLicence: "SV-MUM-0042",
      verification: "MANUAL_RECORD",
    };
    const ev = stampEvidenceOf(cert);
    expect(ev).toEqual({
      channel: "PHYSICAL_PAPER",
      certificate_no: "AB/123456",
      state: "IN-MH",
      duty_paise: 50_000,
      stated_duty_paise: 40_000,
      stamped_document_sha256: sha,
      issued_at: "2026-11-20T04:30:00.000Z",
      certificate_document_id: "doc_stamp_scan_1",
    });
    expect(PackStampEvidence.safeParse(ev).success).toBe(true);
    const { stampedDocumentSha256: _s, ...noHash } = cert;
    expect(() => stampEvidenceOf(noHash)).toThrow();
    expect(() => stampEvidenceOf({ ...cert, statedDutyMinor: 60_000 })).toThrow();
    expect(() => stampEvidenceOf({ ...cert, certificateNumber: null })).toThrow();
  });
});
