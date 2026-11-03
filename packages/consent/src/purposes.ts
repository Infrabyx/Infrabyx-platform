// Consent to a product's own purposes (Finbyx PR-FBX-26; IPB-04-78; DPDP Act 2023 s.5–6; R1-D-38).
// The public-site ledger (`PgConsentLedger`) keeps its closed list of site purposes. Here a product
// registers its purposes in code (KYC processing, a CKYC download, a DigiLocker pull, a V-CIP
// recording, a bureau pull), and each tenant keeps its own notice text per purpose and language
// under maker-checker: a maker drafts, a different person approves, and an approved text never
// changes. A grant names the exact notice version shown and its SHA-256 (computed by the database
// over the stored body); a withdrawal is a new row; `consentState` reads the latest. Every change is
// ledgered in the same transaction and, with an outbox, emits the internal `PurposeConsentChanged`.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
} from "@infrabyx/contracts/kernel";
import { CONSENT_EVENTS, PurposeConsentChangedData } from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { newId } from "@infrabyx/crypto";

/** `<product>.<area>[.<detail>…]`, e.g. `fbx.kyc.ckyc_download`. */
const PURPOSE = /^[a-z]{2,5}\.[a-z0-9_]+(\.[a-z0-9_]+){0,3}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const SUBJECT = /^.{3,120}$/s;

export interface PurposeDefinition {
  code: string;
  /** What the person is asked to agree to, for staff screens (not the notice itself). */
  description: string;
}

export type PurposeConsentMethod = "SELF_SERVICE" | "ASSISTED" | "API" | "IMPORT";

/** Who may draft and who may approve a tenant's notice (approver ≠ maker). */
export const PURPOSE_NOTICE_MAKER_ROLES = ["ORG_OWNER", "ORG_ADMIN", "ORG_MAKER"] as const;
export const PURPOSE_NOTICE_CHECKER_ROLES = ["ORG_OWNER", "ORG_ADMIN", "ORG_CHECKER"] as const;

export interface PurposeNotice {
  id: string;
  purpose: string;
  version: number;
  language: string;
  body: string;
  sha256: string;
  state: "draft" | "approved" | "retired";
  makerId: string;
  checkerId: string | null;
  approvedAt: string | null;
}

export interface PurposeConsentState {
  receiptId: string;
  granted: boolean;
  noticeId: string | null;
  noticeVersion: number | null;
  language: string | null;
  noticeSha256: string | null;
  recordedAt: string;
}

interface NoticeRow {
  id: string;
  purpose: string;
  version: number;
  language: string;
  body: string;
  sha256: string;
  state: PurposeNotice["state"];
  maker_id: string;
  checker_id: string | null;
  approved_at: Date | null;
}

const NOTICE_COLUMNS =
  "id, purpose, version, language, body, sha256, state, maker_id, checker_id, approved_at";

const toNotice = (r: NoticeRow): PurposeNotice => ({
  id: r.id,
  purpose: r.purpose,
  version: r.version,
  language: r.language,
  body: r.body,
  sha256: r.sha256,
  state: r.state,
  makerId: r.maker_id,
  checkerId: r.checker_id,
  approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
});

function assertPerson(ctx: KernelContext, roles: readonly string[], what: string): void {
  if (ctx.principal.type !== "user")
    throw new IpbError("IPB-SEC-004", { detail: `only a named person may ${what}` });
  if (ctx.scope === "platform")
    throw new IpbError("IPB-SEC-005", { detail: "purpose notices belong to the tenant" });
  if (!ctx.principal.roles.some((r) => roles.includes(r)))
    throw new IpbError("IPB-UX-011", { detail: `needs one of ${roles.join(", ")}` });
}

export class PurposeConsents {
  private readonly purposes: Map<string, PurposeDefinition>;

  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      /** The product's purposes; codes start with the product code in lower case. */
      purposes: readonly PurposeDefinition[];
      outbox?: OutboxWriter;
    },
  ) {
    const prefix = `${o.product.toLowerCase()}.`;
    this.purposes = new Map();
    for (const p of o.purposes) {
      if (!PURPOSE.test(p.code) || !p.code.startsWith(prefix))
        throw new RangeError(`purpose ${p.code} must match ${PURPOSE} and start with ${prefix}`);
      if (this.purposes.has(p.code)) throw new RangeError(`purpose ${p.code} registered twice`);
      this.purposes.set(p.code, p);
    }
  }

  /** The registered purposes, in registration order. */
  list(): PurposeDefinition[] {
    return [...this.purposes.values()];
  }

  private purpose(code: string): PurposeDefinition {
    const p = this.purposes.get(code);
    if (!p) throw new RangeError(`unknown purpose ${code}`);
    return p;
  }

  /** A maker drafts the next version of a tenant's notice for a purpose and language. */
  async draftNotice(
    ctx: KernelContext,
    d: { purpose: string; language: string; body: string },
  ): Promise<PurposeNotice> {
    assertPerson(ctx, PURPOSE_NOTICE_MAKER_ROLES, "draft a consent notice");
    this.purpose(d.purpose);
    if (!LANGUAGE.test(d.language)) throw new RangeError(`invalid language ${d.language}`);
    if (d.body.length < 1 || d.body.length > 20000)
      throw new RangeError("a notice is 1 to 20,000 characters");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("cpn");
        const r = await tx.query<NoticeRow>(
          `insert into consent.purpose_notice (id, tenant_id, purpose, version, language, body, sha256, maker_id)
           select $1, $2, $3, coalesce(max(version), 0) + 1, $4, $5, repeat('0', 64), $6
             from consent.purpose_notice where tenant_id = $2 and purpose = $3 and language = $4
           returning ${NOTICE_COLUMNS}`,
          [id, ctx.tenantId, d.purpose, d.language, d.body, ctx.principal.id],
        );
        const n = toNotice(r.rows[0] as NoticeRow);
        await this.o.audit.record(tx, {
          action: "consent.purpose_notice.draft",
          resourceType: "purpose_notice",
          resourceId: id,
          after: { purpose: n.purpose, language: n.language, version: n.version, sha256: n.sha256 },
        });
        return n;
      },
      { action: "consent.purpose_notice.draft" },
    );
  }

  /** A different person approves a draft; from then on it can be shown and consented to. */
  async approveNotice(ctx: KernelContext, noticeId: string): Promise<PurposeNotice> {
    assertPerson(ctx, PURPOSE_NOTICE_CHECKER_ROLES, "approve a consent notice");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await tx.query<NoticeRow>(
          `select ${NOTICE_COLUMNS} from consent.purpose_notice where id = $1 for update`,
          [noticeId],
        );
        const n = cur.rows[0];
        if (!n || n.state !== "draft")
          throw new IpbError("IPB-WEB-002", { detail: "no draft notice with that id" });
        if (n.maker_id === ctx.principal.id)
          throw new IpbError("IPB-SEC-006", { detail: "the maker of a notice cannot approve it" });
        const r = await tx.query<NoticeRow>(
          `update consent.purpose_notice set state = 'approved', checker_id = $2, approved_at = now()
            where id = $1 returning ${NOTICE_COLUMNS}`,
          [noticeId, ctx.principal.id],
        );
        const out = toNotice(r.rows[0] as NoticeRow);
        await this.o.audit.record(tx, {
          action: "consent.purpose_notice.approve",
          resourceType: "purpose_notice",
          resourceId: noticeId,
          before: { state: "draft" },
          after: { state: "approved", version: out.version, sha256: out.sha256 },
        });
        return out;
      },
      { action: "consent.purpose_notice.approve" },
    );
  }

  /** Retire an approved version so it is no longer offered; past grants keep pointing at it. */
  async retireNotice(ctx: KernelContext, noticeId: string): Promise<void> {
    assertPerson(ctx, PURPOSE_NOTICE_CHECKER_ROLES, "retire a consent notice");
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update consent.purpose_notice set state = 'retired', retired_at = now()
            where id = $1 and state = 'approved'`,
          [noticeId],
        );
        if (r.rowCount !== 1)
          throw new IpbError("IPB-WEB-002", { detail: "no approved notice with that id" });
        await this.o.audit.record(tx, {
          action: "consent.purpose_notice.retire",
          resourceType: "purpose_notice",
          resourceId: noticeId,
          before: { state: "approved" },
          after: { state: "retired" },
        });
      },
      { action: "consent.purpose_notice.retire" },
    );
  }

  /** The notice to show: the newest approved, unretired version for the purpose and language. */
  async currentNotice(
    ctx: KernelContext,
    purpose: string,
    language: string,
  ): Promise<PurposeNotice | null> {
    this.purpose(purpose);
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<NoticeRow>(
        `select ${NOTICE_COLUMNS} from consent.purpose_notice
          where tenant_id = $1 and purpose = $2 and language = $3 and state = 'approved'
          order by version desc limit 1`,
        [ctx.tenantId, purpose, language],
      );
      return r.rows[0] ? toNotice(r.rows[0]) : null;
    });
  }

  private async write(
    ctx: KernelContext,
    d: {
      subjectRef: string;
      purpose: string;
      action: "granted" | "withdrawn";
      noticeId?: string;
      method: PurposeConsentMethod;
    },
  ): Promise<PurposeConsentState> {
    if (ctx.principal.type === "agent")
      throw new IpbError("IPB-SEC-004", { detail: "an agent cannot record consent" });
    if (ctx.principal.type === "external" || ctx.principal.type === "breakglass")
      throw new IpbError("IPB-SEC-004", { detail: "this principal cannot record consent" });
    this.purpose(d.purpose);
    if (!SUBJECT.test(d.subjectRef)) throw new RangeError("subjectRef is 3 to 120 characters");
    const action = `consent.purpose.${d.action === "granted" ? "grant" : "withdraw"}`;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        let notice: NoticeRow | undefined;
        if (d.action === "granted") {
          const r = await tx.query<NoticeRow>(
            `select ${NOTICE_COLUMNS} from consent.purpose_notice
              where id = $1 and tenant_id = $2 and purpose = $3 and state = 'approved'`,
            [d.noticeId ?? "", ctx.tenantId, d.purpose],
          );
          notice = r.rows[0];
          if (!notice)
            throw new IpbError("IPB-WEB-002", {
              detail: `no approved notice ${d.noticeId ?? "(none)"} for ${d.purpose}`,
            });
        }
        const id = newId("cpr");
        const r = await tx.query<{ recorded_at: Date }>(
          `insert into consent.purpose_record
             (id, tenant_id, subject_ref, purpose, action, notice_id, notice_version, language, notice_sha256, method, actor_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning recorded_at`,
          [
            id,
            ctx.tenantId,
            d.subjectRef,
            d.purpose,
            d.action,
            notice?.id ?? null,
            notice?.version ?? null,
            notice?.language ?? null,
            notice?.sha256 ?? null,
            d.method,
            ctx.principal.id,
          ],
        );
        await this.o.audit.record(tx, {
          action,
          resourceType: "purpose_consent",
          resourceId: id,
          after: {
            purpose: d.purpose,
            action: d.action,
            notice: notice ? `${notice.id}@${notice.version}` : null,
            method: d.method,
          },
        });
        if (this.o.outbox) {
          await this.o.outbox.publish(tx, "consent", {
            envelope: internalEvent({
              product: this.o.product,
              event: CONSENT_EVENTS.PurposeConsentChanged,
              tenantId: tx.ctx.tenantId,
              dataclass: "CONFIDENTIAL",
              data: PurposeConsentChangedData.parse({
                receipt_id: id,
                purpose: d.purpose,
                granted: d.action === "granted",
                notice_version: notice?.version ?? null,
              }),
            }),
          });
        }
        const recordedAt = (r.rows[0] as { recorded_at: Date }).recorded_at.toISOString();
        return {
          receiptId: id,
          granted: d.action === "granted",
          noticeId: notice?.id ?? null,
          noticeVersion: notice?.version ?? null,
          language: notice?.language ?? null,
          noticeSha256: notice?.sha256 ?? null,
          recordedAt,
        };
      },
      { action },
    );
  }

  /** Record consent to a purpose against the exact approved notice shown. */
  grant(
    ctx: KernelContext,
    d: { subjectRef: string; purpose: string; noticeId: string; method: PurposeConsentMethod },
  ): Promise<PurposeConsentState> {
    return this.write(ctx, { ...d, action: "granted" });
  }

  /** Record the withdrawal of consent to a purpose (as easy as giving it; DPDP s.6(4)). */
  withdraw(
    ctx: KernelContext,
    d: { subjectRef: string; purpose: string; method: PurposeConsentMethod },
  ): Promise<PurposeConsentState> {
    return this.write(ctx, { ...d, action: "withdrawn" });
  }

  /** The latest record for a subject and purpose, or null when there is none. */
  async consentState(
    ctx: KernelContext,
    subjectRef: string,
    purpose: string,
  ): Promise<PurposeConsentState | null> {
    this.purpose(purpose);
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{
        id: string;
        action: "granted" | "withdrawn";
        notice_id: string | null;
        notice_version: number | null;
        language: string | null;
        notice_sha256: string | null;
        recorded_at: Date;
      }>(
        `select id, action, notice_id, notice_version, language, notice_sha256, recorded_at
           from consent.purpose_record where tenant_id = $1 and subject_ref = $2 and purpose = $3
          order by recorded_at desc, id desc limit 1`,
        [ctx.tenantId, subjectRef, purpose],
      );
      const x = r.rows[0];
      if (!x) return null;
      return {
        receiptId: x.id,
        granted: x.action === "granted",
        noticeId: x.notice_id,
        noticeVersion: x.notice_version,
        language: x.language,
        noticeSha256: x.notice_sha256,
        recordedAt: x.recorded_at.toISOString(),
      };
    });
  }
}
