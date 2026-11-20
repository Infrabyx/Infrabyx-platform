// GRC contract cases (IPB-01-15; Finbyx PR-FBX-51, R1-D-220, ADR-0013). The fake (here) and the
// `generic-grc` adapter (against its stub, `@infrabyx/connectors`) both pass them: every POST answers
// a receipt for its §9.2 resource, keyed by the caller's key or else the event's own Specification
// key; the same key and body answer the same receipt with one record, and the key with another body
// is `IPB-PORT-004` with none; an Aadhaar-like number or a PAN anywhere in a body, or a call class
// above CONFIDENTIAL, is refused `IPB-PORT-003` before anything is taken; incident updates are taken
// in `update_seq` order; obligations come in cursor pages until `nextCursor` is absent, filtered by
// `updatedSince`, a foreign cursor refused; every answer and refusal holds no Aadhaar-like number.
import { expect } from "vitest";
import { findAadhaarLike, verhoeffValid } from "@infrabyx/contracts/aadhaar";
import {
  GRC_EVENTS,
  grcIdempotencyKey,
  type ComplianceIssueRaisedData,
  type ControlTestResultPublishedData,
  type EvidenceSubmittedData,
  type PolicyAttestedData,
  type ReturnStatusUpdatedData,
  type SecurityIncidentNotifiedData,
} from "@infrabyx/contracts/events";
import {
  GRC_POST_METHODS,
  GrcReceiptSchema,
  portDefaultDataClass,
  type GrcObligation,
  type GrcPort,
  type GrcPostMethod,
  type GrcReceipt,
} from "@infrabyx/contracts/ports";
import { ulid } from "@infrabyx/crypto";
import type { GrcFixtures } from "@infrabyx/fakes";
import type { ContractCase } from "../contract.js";
export { FakeGrc, grcFakeFixtures, type GrcFixtures } from "@infrabyx/fakes";

const H = "c".repeat(64);
const T = "2026-11-20T10:00:00+05:30";

/** A run-unique suffix, so contract runs against one shared stub never collide. */
const uniq = () => ulid().toLowerCase();

/** A valid body for each POST method, with run-unique ids. Test data only. */
export const grcSamples = {
  publishControlTestResult: (): ControlTestResultPublishedData => ({
    control_id: `ctl_kfs_${uniq()}`,
    run_id: `run_${uniq()}`,
    result: "FAIL",
    population_count: 1200,
    sample_count: 25,
    exception_count: 2,
    masked_sample_ids: ["ln_XXXXXXXX4821", "ln_XXXXXXXX0097"],
    evidence: [{ uri: `storage:tenant/tnt_fbx/grc/${ulid()}.json`, sha256: H }],
    tested_at: T,
  }),
  submitEvidence: (): EvidenceSubmittedData => ({
    evidence_id: `evd_${uniq()}`,
    control_id: "ctl_kfs_before_execution",
    artefacts: [{ uri: `storage:tenant/tnt_fbx/grc/${ulid()}.pdf`, sha256: H }],
    signer: { type: "service", id: "svc_compliance" },
    collected_at: T,
  }),
  raiseIssue: (): ComplianceIssueRaisedData => ({
    issue_id: `iss_${uniq()}`,
    source: "TEST",
    severity: "SEV2",
    owner: { role: "COMPLIANCE_OFFICER" },
    due: "2026-12-01",
    raised_at: T,
  }),
  notifyIncident: (): SecurityIncidentNotifiedData => ({
    incident_id: `inc_${uniq()}`,
    update_seq: 1,
    detected_at: T,
    class: "UNAUTHORISED_ACCESS",
    affected_data_categories: ["CONTACT_DETAILS"],
    status: "OPEN",
  }),
  updateReturnStatus: (): ReturnStatusUpdatedData => ({
    return_code: `R${uniq().slice(-10).toUpperCase()}`,
    period: "2026-Q3",
    status: "FILED",
    status_at: T,
  }),
  recordPolicyAttestation: (): PolicyAttestedData => ({
    policy_id: `pol_${uniq()}`,
    version: "3",
    user_ref: "usr_01JA",
    attested_at: T,
  }),
} satisfies Record<GrcPostMethod, () => unknown>;

/** `n` obligations updated a minute apart from `from`. Test data only. */
export function grcObligations(n: number, from = "2026-11-01T00:00:00Z"): GrcObligation[] {
  const t0 = Date.parse(from);
  return Array.from({ length: n }, (_, i) => ({
    obligation_ref: `obl_${ulid()}`,
    version: 1,
    paragraph: `CF para ${i + 1}`,
    text_sha256: H,
    applicability_keys: ["nbfc.base"],
    effective_from: "2026-04-01",
    status: "ACTIVE" as const,
    updated_at: new Date(t0 + i * 60_000).toISOString(),
  }));
}

/** `stem` plus its Verhoeff check digit: an Aadhaar-shaped test value made at run time. */
const withCheck = (stem: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${stem}${d}`)) return `${stem}${d}`;
  throw new RangeError("no check digit");
};

const RECEIPT_KEYS = new Set(["resource", "ref", "idempotencyKey", "adapter", "receivedAt"]);

const post = (
  p: GrcPort,
  m: GrcPostMethod,
  d: unknown,
  call?: Parameters<GrcPort["raiseIssue"]>[1],
) => (p[m] as (d: unknown, c?: unknown) => Promise<GrcReceipt>).call(p, d, call);

export function grcContractCases<P extends GrcPort>(fx: GrcFixtures<P>): Array<ContractCase<P>> {
  const clean = (v: unknown) => {
    expect(findAadhaarLike(JSON.stringify(v), { letters: "join" })).toEqual([]);
  };
  const wellFormed = (p: P, r: GrcReceipt, m: GrcPostMethod) => {
    expect(GrcReceiptSchema.safeParse(r).success, JSON.stringify(r)).toBe(true);
    for (const k of Object.keys(r)) expect(RECEIPT_KEYS.has(k), k).toBe(true);
    expect(r.adapter).toBe(p.descriptor.adapter);
    expect(r.resource).toBe(GRC_POST_METHODS[m].resource);
    clean(r);
  };
  const refusal = (pr: Promise<unknown>) =>
    pr.then(
      () => ({ code: "resolved", reason: undefined as string | undefined }),
      (e: { code?: string; meta?: { reason?: string }; message?: string }) => {
        clean({ code: e.code, meta: e.meta, message: e.message });
        return { code: e.code, reason: e.meta?.reason };
      },
    );
  const methods = Object.keys(GRC_POST_METHODS) as GrcPostMethod[];

  return [
    {
      name: "is IN and at most CONFIDENTIAL, the port's default",
      async run(p) {
        expect(p.descriptor.residency).toBe("IN");
        expect(p.descriptor.maxDataClass).toBe("CONFIDENTIAL");
        expect(portDefaultDataClass("GRC")).toBe("CONFIDENTIAL");
      },
    },
    {
      name: "each POST answers a receipt for its §9.2 resource, keyed by the event's own key by default",
      async run(p) {
        for (const m of methods) {
          const d = grcSamples[m]() as unknown as Record<string, unknown>;
          const r = await post(p, m, d);
          wellFormed(p, r, m);
          expect(r.idempotencyKey).toBe(grcIdempotencyKey(GRC_POST_METHODS[m].event, d));
          expect(GRC_EVENTS[GRC_POST_METHODS[m].event].schema.safeParse(d).success).toBe(true);
        }
      },
    },
    {
      name: "idempotent: the same key and body answer the same receipt with one record",
      async run(p) {
        for (const m of ["publishControlTestResult", "recordPolicyAttestation"] as const) {
          const d = grcSamples[m]();
          const before = fx.accepted(p);
          const a = await post(p, m, d);
          const b = await post(p, m, structuredClone(d));
          expect(b).toEqual(a);
          expect(fx.accepted(p)).toBe(before + 1);
        }
        // A caller's own key works the same way, and another key is another record.
        const d = grcSamples.raiseIssue();
        const k = `grc-contract-${uniq()}`;
        const before = fx.accepted(p);
        const a = await post(p, "raiseIssue", d, { idempotencyKey: k });
        expect(a.idempotencyKey).toBe(k);
        expect(await post(p, "raiseIssue", d, { idempotencyKey: k })).toEqual(a);
        expect(fx.accepted(p)).toBe(before + 1);
      },
    },
    {
      name: "conflict: the same key with another body is IPB-PORT-004 with no record",
      async run(p) {
        const d = grcSamples.publishControlTestResult();
        await post(p, "publishControlTestResult", d);
        const before = fx.accepted(p);
        // The Specification key (control_id, run_id) with another result.
        expect(
          await refusal(post(p, "publishControlTestResult", { ...d, result: "INCONCLUSIVE" })),
        ).toEqual({ code: "IPB-PORT-004", reason: "idempotency_conflict" });
        // A caller's key with another body.
        const k = `grc-contract-${uniq()}`;
        await post(p, "raiseIssue", grcSamples.raiseIssue(), { idempotencyKey: k });
        const after = fx.accepted(p);
        expect(
          await refusal(post(p, "raiseIssue", grcSamples.raiseIssue(), { idempotencyKey: k })),
        ).toEqual({ code: "IPB-PORT-004", reason: "idempotency_conflict" });
        expect(fx.accepted(p)).toBe(after);
        expect(after).toBe(before + 1);
      },
    },
    {
      name: "no raw personal data: an Aadhaar-like number or a PAN anywhere is refused IPB-PORT-003 before anything is taken",
      async run(p) {
        const uid = withCheck("23456789012");
        const before = fx.accepted(p);
        const bad: Array<[GrcPostMethod, Record<string, unknown>]> = [
          [
            "recordPolicyAttestation",
            { ...grcSamples.recordPolicyAttestation(), user_ref: `usr_${uid}` },
          ],
          ["raiseIssue", { ...grcSamples.raiseIssue(), source_ref: "ABCPE1234F" }],
          ["notifyIncident", { ...grcSamples.notifyIncident(), note: `customer ${uid}` }],
          [
            "publishControlTestResult",
            { ...grcSamples.publishControlTestResult(), masked_sample_ids: [uid] },
          ],
          [
            "submitEvidence",
            { ...grcSamples.submitEvidence(), signer: { type: "user", id: "ABCPE1234F" } },
          ],
        ];
        for (const [m, d] of bad)
          expect(await refusal(post(p, m, d)), m).toEqual({
            code: "IPB-PORT-003",
            reason: "personal_data",
          });
        expect(fx.accepted(p)).toBe(before);
      },
    },
    {
      name: "data class: a call above CONFIDENTIAL, or below the port default, is refused IPB-PORT-003",
      async run(p) {
        const before = fx.accepted(p);
        for (const dataClass of ["REGULATED", "SECRET", "INTERNAL"] as const) {
          expect(
            await refusal(post(p, "raiseIssue", grcSamples.raiseIssue(), { dataClass })),
          ).toEqual({ code: "IPB-PORT-003", reason: "data_class" });
          expect((await refusal(p.listObligations({}, { dataClass }))).code).toBe("IPB-PORT-003");
        }
        expect(fx.accepted(p)).toBe(before);
        const r = await post(p, "raiseIssue", grcSamples.raiseIssue(), {
          dataClass: "CONFIDENTIAL",
        });
        wellFormed(p, r, "raiseIssue");
      },
    },
    {
      name: "incident updates in update_seq order: a lower one is out_of_order, a replay answers its receipt",
      async run(p) {
        const first = grcSamples.notifyIncident();
        const a = await post(p, "notifyIncident", first);
        const third = { ...first, update_seq: 3, status: "CONTAINED" as const };
        const c = await post(p, "notifyIncident", third);
        expect(c.ref).not.toBe(a.ref);
        const before = fx.accepted(p);
        expect(
          await refusal(
            post(p, "notifyIncident", { ...first, update_seq: 2, status: "CONTAINED" }),
          ),
        ).toEqual({ code: "IPB-PORT-001", reason: "out_of_order" });
        // The same update again is a resend; the same number with another body is a conflict.
        expect(await post(p, "notifyIncident", structuredClone(third))).toEqual(c);
        expect(await refusal(post(p, "notifyIncident", { ...third, status: "RESOLVED" }))).toEqual({
          code: "IPB-PORT-004",
          reason: "idempotency_conflict",
        });
        expect(fx.accepted(p)).toBe(before);
        const fourth = await post(p, "notifyIncident", {
          ...first,
          update_seq: 4,
          status: "RESOLVED",
          notified_re_at: "2026-11-20T11:00:00+05:30",
        });
        wellFormed(p, fourth, "notifyIncident");
        expect(fx.accepted(p)).toBe(before + 1);
      },
    },
    {
      name: "obligations: cursor pages in order until nextCursor is absent; updatedSince filters; a foreign cursor is refused",
      async run(p) {
        const seeded = grcObligations(7);
        await fx.seedObligations(p, seeded);
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const page = await p.listObligations({ limit: 3, ...(cursor ? { cursor } : {}) });
          expect(page.items.length).toBeLessThanOrEqual(3);
          for (const o of page.items) {
            expect("text" in o).toBe(false);
            seen.push(o.obligation_ref);
          }
          clean(page);
          cursor = page.nextCursor;
          pages++;
        } while (cursor && pages < 10);
        expect(seen).toEqual(seeded.map((o) => o.obligation_ref));
        expect(pages).toBe(3);
        const since = seeded[4]!.updated_at;
        const recent = await p.listObligations({ updatedSince: since });
        expect(recent.items.map((o) => o.obligation_ref)).toEqual(
          seeded.slice(4).map((o) => o.obligation_ref),
        );
        expect(recent.nextCursor).toBeUndefined();
        // A cursor from one query is not good for another.
        const first = await p.listObligations({ limit: 2 });
        expect(
          await refusal(
            p.listObligations({ updatedSince: since, cursor: first.nextCursor!, limit: 2 }),
          ),
        ).toEqual({ code: "IPB-PORT-001", reason: "invalid_cursor" });
        expect(await refusal(p.listObligations({ cursor: `not-a-cursor-${uniq()}` }))).toEqual({
          code: "IPB-PORT-001",
          reason: "invalid_cursor",
        });
      },
    },
  ];
}
