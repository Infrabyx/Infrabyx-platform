// Subject status for the consent end-of-life rules (OWNER-QUESTIONS #57, PL5-D-11; migration
// `consent/0002`). A form consent for a marketing lead with no later record ends 24 months after the
// last interaction (IPB-05 template 9) and is then deleted by the ledgered sweep 3 years later (#48),
// unless the person has an active relationship. The product reports interactions and relationships;
// a PLT_LEGAL_REVIEWER places legal holds, which stop every consent-record deletion for the person.
// Subjects are named as in the ledger: the `principal_ref` (`form:<email>` for the website forms) or
// `cid:<cid>` for a cookie-only subject.
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";

/** IPB-05 template 9: marketing leads with no customer relationship, from the last interaction. */
export const FORM_LEAD_LIFE_MONTHS = 24;

export interface SubjectStatus {
  subjectRef: string;
  lastInteractionAt: Date | null;
  activeRelationship: boolean;
  legalHold: boolean;
}

const SUBJECT = /^(?:cid:[A-Za-z0-9_-]{16,64}|[^\s]{3,120})$/;

function checkRef(ref: string): string {
  if (!SUBJECT.test(ref) || ref.length > 120)
    throw new IpbError("IPB-CMS-001", {
      detail: "a subject is a principal reference or cid:<cid>",
    });
  return ref;
}

export class ConsentSubjects {
  constructor(private readonly o: { kernel: MutationKernel; audit: AuditSink; now?: () => Date }) {}

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private async upsert(
    tx: Tx,
    ref: string,
    set: { last?: Date; active?: boolean; hold?: { on: boolean; reason: string | null } },
  ): Promise<void> {
    await tx.query(
      `insert into consent.subject_status (tenant_id, subject_ref, last_interaction_at, active_relationship, legal_hold, hold_reason)
       values ($1, $2, $3, coalesce($4, false), coalesce($5, false), $6)
       on conflict (tenant_id, subject_ref) do update set
         last_interaction_at = greatest(consent.subject_status.last_interaction_at, excluded.last_interaction_at),
         active_relationship = coalesce($4, consent.subject_status.active_relationship),
         legal_hold = coalesce($5, consent.subject_status.legal_hold),
         hold_reason = case when $5 is null then consent.subject_status.hold_reason else $6 end,
         updated_at = now()`,
      [
        tx.ctx.tenantId,
        ref,
        set.last ?? null,
        set.active ?? null,
        set.hold?.on ?? null,
        set.hold?.on ? set.hold.reason : null,
      ],
    );
  }

  /** The product reports an interaction (a reply, a call, a sign-in); only a later date moves it. */
  async recordInteraction(ctx: KernelContext, subjectRef: string, at: Date = this.now()) {
    const ref = checkRef(subjectRef);
    if (at.getTime() > this.now().getTime() + 60_000)
      throw new IpbError("IPB-CMS-001", { detail: "an interaction cannot be in the future" });
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.upsert(tx, ref, { last: at });
        await this.o.audit.record(tx, {
          action: "consent.subject.interaction",
          resourceType: "consent_subject",
          resourceId: "subject",
          after: { at: at.toISOString() },
        });
      },
      { action: "consent.subject.interaction" },
    );
  }

  /** The person becomes, or stops being, a customer or other active relationship. */
  async setRelationship(ctx: KernelContext, subjectRef: string, active: boolean) {
    const ref = checkRef(subjectRef);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.upsert(tx, ref, { active, last: this.now() });
        await this.o.audit.record(tx, {
          action: "consent.subject.relationship",
          resourceType: "consent_subject",
          resourceId: "subject",
          after: { active },
        });
      },
      { action: "consent.subject.relationship" },
    );
  }

  /**
   * Place or lift a legal hold on one person's consent records in a tenant. Only a
   * PLT_LEGAL_REVIEWER in the platform context; the tenant's ledger names the reviewer.
   */
  async legalHold(
    staff: KernelContext,
    h: { tenantId: string; subjectRef: string; on: boolean; reason: string },
  ): Promise<void> {
    if (
      staff.scope !== "platform" ||
      staff.tenantId !== PLATFORM_TENANT_ID ||
      staff.principal.type !== "user" ||
      !staff.principal.roles.includes("PLT_LEGAL_REVIEWER")
    )
      throw new IpbError("IPB-UX-011", { detail: "legal holds need PLT_LEGAL_REVIEWER" });
    if (h.reason.trim().length < 5)
      throw new IpbError("IPB-CMS-001", { detail: "give the reason for the hold" });
    const ref = checkRef(h.subjectRef);
    await this.o.kernel.mutate(
      {
        tenantId: h.tenantId,
        principal: { id: "svc_consent_legal_hold", type: "service", roles: [] },
      },
      async (tx) => {
        await this.upsert(tx, ref, { hold: { on: h.on, reason: h.reason.trim() } });
        await this.o.audit.record(tx, {
          action: h.on ? "consent.legal_hold.placed" : "consent.legal_hold.lifted",
          resourceType: "consent_subject",
          resourceId: "subject",
          after: { by: staff.principal.id, reason: h.reason.trim() },
        });
      },
      { action: "consent.legal_hold" },
    );
  }

  async status(ctx: KernelContext, subjectRef: string): Promise<SubjectStatus | null> {
    const ref = checkRef(subjectRef);
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        last_interaction_at: Date | null;
        active_relationship: boolean;
        legal_hold: boolean;
      }>(
        "select last_interaction_at, active_relationship, legal_hold from consent.subject_status where subject_ref = $1",
        [ref],
      );
      const x = r.rows[0];
      return x
        ? {
            subjectRef: ref,
            lastInteractionAt: x.last_interaction_at,
            activeRelationship: x.active_relationship,
            legalHold: x.legal_hold,
          }
        : null;
    });
  }
}
