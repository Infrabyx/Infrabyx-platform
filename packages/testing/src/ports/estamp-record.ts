// Contract cases of ESTAMP's optional `recordCertificate` (Udofin PR-UDF-054, R1-D-245): a stamp
// the regulated entity already paid for through its own channel, recorded against the stamped
// instrument. Every recording adapter (and the fake) passes them: once per key, a certificate
// number once per State and channel, read back, attached to one document, the same refusals, and
// evidence the pack takes as `PackStampEvidence`.
import { expect } from "vitest";
import { stampEvidenceOf } from "@infrabyx/contracts/events";
import {
  STAMP_VERIFICATIONS,
  StampCertificateRecord,
  payloadClass,
  type DocFileRef,
  type EstampPort,
  type StampRecordChannel,
} from "@infrabyx/contracts/ports";
import { ulid } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

/** A stamp the RE bought outside the platform, as the adapter's issuer knows it. */
export interface BoughtStamp {
  certificateNumber: string;
  /** RFC 3339 with offset. */
  issuedAt: string;
  dutyMinor: number;
  /** The channel's own id, where the adapter reads the certificate back by it. */
  vendorCertificateId?: string;
}

export interface StampRecordFixtures {
  channel: StampRecordChannel;
  /** A State the adapter's issuer covers, e.g. `MH`. */
  state: string;
  /** A stamped PDF in the adapter's STORAGE. */
  stampedDocument: DocFileRef;
  /** Makes a new certificate exist at the issuer (the stub's hook; nothing for a manual record). */
  bought: (p: EstampPort) => Promise<BoughtStamp> | BoughtStamp;
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; meta?: { reason?: string } }) =>
      `${e.code ?? "error"}${e.meta?.reason ? `/${e.meta.reason}` : ""}`,
  );

export function estampRecordContractCases(
  fx: StampRecordFixtures,
): Array<ContractCase<EstampPort>> {
  const key = (tag: string) => `contract-record-${tag}-${ulid()}`;
  const record = (b: BoughtStamp, over: Record<string, unknown> = {}) => ({
    channel: fx.channel,
    state: fx.state,
    instrument: "loan_agreement",
    certificateNumber: b.certificateNumber,
    dutyMinor: b.dutyMinor,
    issuedAt: b.issuedAt,
    purchaser: { partyRef: "p1", name: "Party p1" },
    stampedDocument: fx.stampedDocument,
    ...(fx.channel !== "E_STAMP"
      ? { vendorLicence: "SV-0042/2026", certificateDocumentId: "doc_stamp_scan_1" }
      : {}),
    ...(b.vendorCertificateId !== undefined ? { vendorCertificateId: b.vendorCertificateId } : {}),
    recordedBy: { principalId: "usr_ops_1", principalType: "user" },
    ...over,
  });
  const rec = (p: EstampPort) => {
    if (!p.recordCertificate) throw new Error(`${p.descriptor.adapter} has no recordCertificate`);
    // Loosely typed on purpose: the refusal cases send what the schema refuses.
    const f = p.recordCertificate.bind(p);
    return (r: unknown, k: string) => f(r as never, k);
  };
  return [
    {
      name: "declares recordCertificate, classes the record REGULATED and stays IN",
      async run(p) {
        expect(typeof p.recordCertificate).toBe("function");
        expect(p.descriptor.capabilities?.recordCertificate ?? "native").not.toBe("unsupported");
        expect(payloadClass(StampCertificateRecord).bodyHighest).toBe("REGULATED");
        expect(p.descriptor.residency).toBe("IN");
      },
    },
    {
      name: "records a paid stamp once per key, reads it back, attaches it to one document, and its evidence is the pack's",
      async run(p) {
        const b = await fx.bought(p);
        const k = key("once");
        const a = await rec(p)(record(b), k);
        expect(a.certificateId).toMatch(/^[A-Za-z0-9_.:-]{3,128}$/);
        expect((await rec(p)(record(b), k)).certificateId).toBe(a.certificateId);
        expect(await code(rec(p)(record(b, { instrument: "5(h)" }), k))).toMatch(/^IPB-PORT-004/);
        expect(a).toMatchObject({
          state: "issued",
          channel: fx.channel,
          certificateNumber: b.certificateNumber,
          stateCode: fx.state,
          dutyMinor: b.dutyMinor,
          purchaserRef: "p1",
          stampedDocumentSha256: fx.stampedDocument.sha256,
        });
        expect(STAMP_VERIFICATIONS).toContain(a.verification);
        // The party's name is printed on the paper, never kept on the record.
        expect(JSON.stringify(a)).not.toContain("Party p1");
        expect((await p.verify(a.certificateId)).certificateNumber).toBe(b.certificateNumber);
        await p.attach(a.certificateId, "doc_contract_record_1");
        await p.attach(a.certificateId, "doc_contract_record_1");
        expect(await code(p.attach(a.certificateId, "doc_contract_record_2"))).toMatch(
          /^IPB-PORT-004/,
        );
        const ev = stampEvidenceOf(a);
        expect(ev).toMatchObject({
          channel: fx.channel,
          certificate_no: b.certificateNumber,
          state: `IN-${fx.state}`,
          duty_paise: b.dutyMinor,
          stamped_document_sha256: fx.stampedDocument.sha256,
        });
      },
    },
    {
      name: "a stamp is used once: the same certificate under another key is refused",
      async run(p) {
        const b = await fx.bought(p);
        await rec(p)(record(b), key("first"));
        expect(await code(rec(p)(record(b), key("second")))).toBe(
          "IPB-PORT-004/certificate_reused",
        );
      },
    },
    {
      name: "refuses an agent recorder, deficient stamping and a malformed record or key, keeping nothing",
      async run(p) {
        const b = await fx.bought(p);
        const k = key("refused");
        expect(
          await code(
            rec(p)(
              record(b, { recordedBy: { principalId: "agt_vidhi", principalType: "agent" } }),
              k,
            ),
          ),
        ).toBe("IPB-SEC-004");
        expect(await code(rec(p)(record(b, { statedDutyMinor: b.dutyMinor + 1 }), k))).toBe(
          "IPB-PORT-001/deficient_stamping",
        );
        expect(await code(rec(p)(record(b, { state: "Maharashtra" }), k))).toBe(
          "IPB-PORT-001/invalid_request",
        );
        expect(await code(rec(p)(record(b), "short"))).toBe("IPB-PORT-001/invalid_request");
        // Nothing was kept under the key or the number: the valid record goes through.
        expect((await rec(p)(record(b), k)).certificateNumber).toBe(b.certificateNumber);
      },
    },
  ];
}

/** Fixtures for `FakeEstamp` (it reads no STORAGE and asks no issuer). */
export function fakeStampRecordFixtures(): StampRecordFixtures {
  let n = 0;
  return {
    channel: "E_STAMP",
    state: "MH",
    stampedDocument: {
      storageKey: "tenant/tnt_contract/dms/STAMPED.pdf",
      sha256: "c".repeat(64),
    },
    bought: () => ({
      certificateNumber: `IN-MH${ulid().slice(0, 10)}${++n}`,
      issuedAt: "2026-11-02T11:00:00+05:30",
      dutyMinor: 50_000,
    }),
  };
}
