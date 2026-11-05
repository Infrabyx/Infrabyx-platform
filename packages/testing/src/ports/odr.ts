// ODR fake, the Equator stub and the contract cases (Finbyx PR-FBX-44; Ecosystem Spec 6.9, 8.1,
// 8.9; ADR-0010; R1-D-104). `FakeOdr` is one provider: it refers nothing anywhere; a test moves a
// referral on with `advance` to a scripted end (`settle`, `award`, `no_settlement`, `reject`).
// `equatorOdrStub()` is the same fake as Equator Resolution, with its group-company disclosure:
// a referral to it that does not acknowledge the disclosure as shown is refused. The cases hold
// every adapter to the port's rules.
import { expect } from "vitest";
import { PortError } from "@infrabyx/contracts/errors";
import {
  FINAL_ODR_STATES,
  ODR_OUTCOME_STATES,
  OdrReferralRequest,
  type AdapterDescriptor,
  type OdrCapability,
  type OdrDisclosure,
  type OdrMode,
  type OdrOutcome,
  type OdrPort,
  type OdrReferralHandle,
  type OdrReferralStatus,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import { canonicalDigest, newId, sha256Hex } from "@infrabyx/crypto";
import type { ContractCase } from "../contract.js";

export type ScriptedOdr = "settle" | "award" | "no_settlement" | "reject";

/** Equator's disclosure (Spec 6.9, 8.1): shown on every screen presenting it. */
export const EQUATOR_DISCLOSURE: OdrDisclosure = {
  provider: "Equator Resolution",
  groupCompany: true,
  statement: "Equator Resolution is an Infrabyx group company",
  version: 1,
};

interface FakeReferral {
  req: OdrReferralRequest;
  digest: string;
  status: OdrReferralStatus;
  script: ScriptedOdr;
  outcome?: OdrOutcome;
}

const iso = () => new Date().toISOString();

export class FakeOdr implements OdrPort {
  readonly descriptor: AdapterDescriptor;
  readonly storage = new Map<string, Buffer>();
  private readonly referrals = new Map<string, FakeReferral>();
  private readonly byKey = new Map<string, string>();
  private readonly scripts = new Map<string, ScriptedOdr>();
  private seq = 0;

  constructor(
    private readonly o: {
      disclosure?: OdrDisclosure;
      modes?: Readonly<Record<OdrCapability, OdrMode>>;
    } = {},
  ) {
    this.descriptor = {
      port: "ODR",
      adapter: o.disclosure?.groupCompany ? "equator-stub" : "fake-odr",
      residency: "IN",
      maxDataClass: "CONFIDENTIAL",
    };
  }

  disclosure(): OdrDisclosure {
    return (
      this.o.disclosure ?? {
        provider: "Fake ODR",
        groupCompany: false,
        statement: null,
        version: 1,
      }
    );
  }

  modes(): Readonly<Record<OdrCapability, OdrMode>> {
    return this.o.modes ?? { refer: "API", status: "WEBHOOK", withdraw: "API", outcome: "API" };
  }

  /** How the referral of `disputeRef` ends (default: settled). */
  script(disputeRef: string, end: ScriptedOdr): void {
    this.scripts.set(disputeRef, end);
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: iso() };
  }

  async refer(raw: OdrReferralRequest): Promise<OdrReferralHandle> {
    if ((raw as { initiatedBy?: { type?: string } })?.initiatedBy?.type === "agent")
      throw new PortError("IPB-SEC-004", "ODR", { detail: "an agent never refers a dispute" });
    const req = OdrReferralRequest.parse(raw);
    const d = this.disclosure();
    if (d.statement && req.disclosureShown?.version !== d.version)
      throw new PortError("IPB-PORT-003", "ODR", {
        detail: `${d.provider}'s disclosure (version ${d.version}) was not acknowledged as shown`,
      });
    const digest = canonicalDigest(req);
    const prior = this.byKey.get(req.idempotencyKey);
    if (prior) {
      const r = this.referrals.get(prior)!;
      if (r.digest !== digest)
        throw new PortError("IPB-PORT-004", "ODR", { meta: { key: req.idempotencyKey } });
      return this.handle(r);
    }
    const referralId = newId("odr");
    const at = iso();
    const r: FakeReferral = {
      req,
      digest,
      script: this.scripts.get(req.disputeRef) ?? "settle",
      status: {
        referralId,
        caseRef: null,
        state: "referred",
        idempotencyKey: req.idempotencyKey,
        provider: d.provider,
        process: req.process,
        referredAt: at,
        updatedAt: at,
        nextHearingAt: null,
        reason: null,
      },
    };
    this.referrals.set(referralId, r);
    this.byKey.set(req.idempotencyKey, referralId);
    return this.handle(r);
  }

  /** Test control: one step on (referred → screening → accepted → in progress → the scripted end). */
  advance(referralId: string): void {
    const r = this.must(referralId);
    const s = r.status;
    const next: Partial<Record<OdrReferralStatus["state"], OdrReferralStatus["state"]>> = {
      referred: "screening",
      screening: r.script === "reject" ? "screen_rejected" : "accepted",
      accepted: "in_progress",
      in_progress:
        r.script === "award"
          ? "award_signed"
          : r.script === "no_settlement"
            ? "non_settlement"
            : "settled",
    };
    const to = next[s.state];
    if (!to) throw new Error("the referral moves no further");
    s.state = to;
    s.updatedAt = iso();
    if (to === "accepted") s.caseRef = `EQ-${String(++this.seq).padStart(6, "0")}`;
    if (to === "screen_rejected") s.reason = "outside the institution's rules";
  }

  async status(referralId: string): Promise<OdrReferralStatus> {
    return structuredClone(this.must(referralId).status);
  }

  async withdraw(referralId: string, reason: string): Promise<OdrReferralHandle> {
    const r = this.must(referralId);
    if (ODR_OUTCOME_STATES.includes(r.status.state) || FINAL_ODR_STATES.includes(r.status.state))
      throw new PortError("IPB-PORT-003", "ODR", {
        detail: `a referral ${r.status.state} is not withdrawn`,
      });
    r.status.state = "withdrawn";
    r.status.reason = reason;
    r.status.updatedAt = iso();
    return this.handle(r);
  }

  async outcome(referralId: string): Promise<OdrOutcome> {
    const r = this.must(referralId);
    if (r.outcome) return r.outcome;
    if (!ODR_OUTCOME_STATES.includes(r.status.state))
      throw new PortError("IPB-PORT-003", "ODR", {
        detail: `no outcome for a referral ${r.status.state}`,
      });
    const kind = r.status.state === "award_signed" ? "award" : "settlement";
    const bytes = Buffer.from(`${kind} ${referralId}`);
    const storageKey = `${r.req.outputPrefix}/${referralId}-${kind}.pdf`;
    this.storage.set(storageKey, bytes);
    r.outcome = {
      referralId,
      kind,
      file: { storageKey, sha256: sha256Hex(bytes) },
      contentType: "application/pdf",
      on: r.status.updatedAt.slice(0, 10),
    };
    return r.outcome;
  }

  private handle(r: FakeReferral): OdrReferralHandle {
    const { referralId, caseRef, state, idempotencyKey } = r.status;
    return { referralId, caseRef, state, idempotencyKey };
  }

  private must(referralId: string): FakeReferral {
    const r = this.referrals.get(referralId);
    if (!r) throw new PortError("IPB-PORT-005", "ODR", { detail: `no referral ${referralId}` });
    return r;
  }
}

/**
 * The Equator stub: the fake as Equator Resolution, carrying its group-company disclosure. Never a
 * default provider: a product shows it among the other configured providers (Spec 6.9).
 */
export function equatorOdrStub(): FakeOdr {
  return new FakeOdr({
    disclosure: EQUATOR_DISCLOSURE,
    modes: { refer: "API", status: "WEBHOOK", withdraw: "API", outcome: "API" },
  });
}

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
