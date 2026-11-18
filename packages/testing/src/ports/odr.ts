// ODR fake, the Equator stub and the contract cases (Finbyx PR-FBX-44; Ecosystem Spec 6.9, 8.1,
// 8.9; ADR-0010; R1-D-104). `FakeOdr` is one provider: it refers nothing anywhere; a test moves a
// referral on with `advance` to a scripted end (`settle`, `award`, `no_settlement`, `reject`).
// `equatorOdrStub()` is the same fake as Equator Resolution, with its group-company disclosure:
// a referral to it that does not acknowledge the disclosure as shown is refused. The cases hold
// every adapter to the port's rules.
// ODR fake, the Equator stub and the contract cases (Finbyx PR-FBX-44; Ecosystem Spec 6.9, 8.1,
// 8.9; ADR-0010; R1-D-104). `FakeOdr` is one provider: it refers nothing anywhere; a test moves a
// referral on with `advance` to a scripted end (`settle`, `award`, `no_settlement`, `reject`).
// `equatorOdrStub()` is the same fake as Equator Resolution, with its group-company disclosure:
// a referral to it that does not acknowledge the disclosure as shown is refused. The cases hold
// every adapter to the port's rules.
import { expect } from "vitest";
import { OdrReferralRequest, type OdrPort } from "@infrabyx/contracts/ports";
import type { ContractCase } from "../contract.js";
import { type ScriptedOdr } from "@infrabyx/fakes";
export { type ScriptedOdr, EQUATOR_DISCLOSURE, FakeOdr, equatorOdrStub } from "@infrabyx/fakes";

/** Moves referrals on the adapter under test (the fake's own controls, or a sandbox's). */
export interface OdrScript {
  script(disputeRef: string, end: ScriptedOdr): void;
  advance(referralId: string): void;
}

let n = 0;
const request = (p: OdrPort, disputeRef: string): OdrReferralRequest => ({
  initiatedBy: { type: "user", id: "usr_recovery" },
  disputeRef,
  process: "conciliation",
  selectedBy: "party",
  basis: { kind: "post_dispute_consent", ref: "adrc_0001" },
  parties: [
    { role: "claimant", partyRef: "org_lender" },
    { role: "respondent", partyRef: "per_borrower" },
  ],
  claimInr: "125000.00",
  documents: [
    { storageKey: "tenant/tnt_a/adr/01J9ZC9Q2K7M8N3P4R5S6T7V8W.pdf", sha256: "b".repeat(64) },
  ],
  disclosureShown: p.disclosure().statement ? { version: p.disclosure().version } : null,
  outputPrefix: "tenant/tnt_a/adr",
  idempotencyKey: `odr-key-${Date.now()}-${++n}`,
});
const code = (q: Promise<unknown>) =>
  q.then(
    () => null,
    (e: { code?: string }) => e.code ?? "error",
  );

export function odrContractCases(s: OdrScript): ContractCase<OdrPort>[] {
  return [
    {
      name: "a settled referral keeps its settlement in tenant STORAGE; an award likewise",
      async run(p) {
        s.script("dsp_settle", "settle");
        const h = await p.refer(request(p, "dsp_settle"));
        expect(h.state).toBe("referred");
        expect(await code(p.outcome(h.referralId))).toBe("IPB-PORT-003");
        for (let i = 0; i < 4; i++) s.advance(h.referralId);
        const st = await p.status(h.referralId);
        expect(st).toMatchObject({ state: "settled", process: "conciliation" });
        expect(st.caseRef).not.toBeNull();
        const o = await p.outcome(h.referralId);
        expect(o.kind).toBe("settlement");
        expect(o.file.storageKey.startsWith("tenant/tnt_a/adr/")).toBe(true);
        expect(await p.outcome(h.referralId)).toEqual(o);
        expect(await code(p.withdraw(h.referralId, "late"))).toBe("IPB-PORT-003");
        s.script("dsp_award", "award");
        const a = await p.refer({ ...request(p, "dsp_award"), process: "arbitration" });
        for (let i = 0; i < 4; i++) s.advance(a.referralId);
        expect((await p.outcome(a.referralId)).kind).toBe("award");
      },
    },
    {
      name: "rejected, unsettled and withdrawn referrals have no outcome",
      async run(p) {
        s.script("dsp_reject", "reject");
        const r = await p.refer(request(p, "dsp_reject"));
        s.advance(r.referralId);
        s.advance(r.referralId);
        expect((await p.status(r.referralId)).state).toBe("screen_rejected");
        expect(await code(p.outcome(r.referralId))).toBe("IPB-PORT-003");
        s.script("dsp_none", "no_settlement");
        const u = await p.refer(request(p, "dsp_none"));
        for (let i = 0; i < 4; i++) s.advance(u.referralId);
        expect((await p.status(u.referralId)).state).toBe("non_settlement");
        expect(await code(p.outcome(u.referralId))).toBe("IPB-PORT-003");
        const w = await p.refer(request(p, "dsp_withdraw"));
        expect((await p.withdraw(w.referralId, "settled directly")).state).toBe("withdrawn");
        expect(await code(p.outcome(w.referralId))).toBe("IPB-PORT-003");
      },
    },
    {
      name: "one referral per idempotency key; a provider is never a default; a basis is required",
      async run(p) {
        const req = request(p, "dsp_key");
        const a = await p.refer(req);
        expect(await p.refer(req)).toEqual(a);
        expect(await code(p.refer({ ...req, process: "mediation" }))).toBe("IPB-PORT-004");
        const bad = (over: Record<string, unknown>) =>
          p.refer({ ...request(p, "dsp_bad"), ...over } as unknown as OdrReferralRequest);
        await expect(bad({ selectedBy: "default" })).rejects.toThrow();
        await expect(bad({ basis: undefined })).rejects.toThrow();
        await expect(
          bad({ parties: [{ role: "claimant", partyRef: "org_lender" }] }),
        ).rejects.toThrow();
        expect(await code(bad({ initiatedBy: { type: "agent", id: "agt_vidhi" } }))).not.toBeNull();
      },
    },
    {
      name: "a provider with a disclosure refuses a referral that did not show it; every provider declares its modes",
      async run(p) {
        const d = p.disclosure();
        const modes = p.modes();
        for (const c of ["refer", "status", "withdraw", "outcome"] as const)
          expect(["API", "WEBHOOK", "FILE", "PORTAL_MANUAL"]).toContain(modes[c]);
        if (!d.statement) return;
        expect(await code(p.refer({ ...request(p, "dsp_nodisc"), disclosureShown: null }))).toBe(
          "IPB-PORT-003",
        );
        expect(
          await code(
            p.refer({ ...request(p, "dsp_olddisc"), disclosureShown: { version: d.version + 1 } }),
          ),
        ).toBe("IPB-PORT-003");
      },
    },
  ];
}
