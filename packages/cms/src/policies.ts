// Policies (IPB-05 §05.3, §05.4.19; IPB-04 §04.4.3 "Legal page / policy instance"; PL5 plan §5.7).
//   draft ──submit (lint)──▶ submitted ──[dpoApprove]──▶ approve ──▶ approved ──tick at effective_at──▶ effective
//   effective ──a newer version becomes effective──▶ superseded (still readable at /legal/{slug}/v/{version})
// The maker is a PLT_LEGAL_REVIEWER, the checker a PLT_SUPER_ADMIN, and privacy-class templates
// (1, 5, 9, 15) need a PLT_DPO too, never the maker (IPB-05-12). Approval snapshots the parameters
// and the rendered hash; an approved instance never changes (`IPB-POL-008`, trigger).
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { LawRegisterPort } from "@infrabyx/contracts/ports";
import { CMS_EVENTS, PolicyEffectiveData } from "@infrabyx/contracts";
import { newId, sha256Hex } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";
import { findPhrases, wordList } from "./lint.js";
import {
  citations,
  clauseNumbers,
  MANDATORY_POLICY_KEYS,
  nextVersion,
  policyTemplate,
  renderPolicy,
  resolveParams,
  SELLING_POLICY_KEYS,
  type PolicyParams,
} from "./policy-template.js";
import { cmsServiceContext, emit, type Deps } from "./repo.js";
import type { SettingsReader } from "./studio.js";

export const POLICY_MAKER = "PLT_LEGAL_REVIEWER";
export const POLICY_CHECKER = "PLT_SUPER_ADMIN";
export const POLICY_DPO = "PLT_DPO";
/** IPB-05-06: a MAJOR change to these takes effect only after the notice period. */
export const NOTICE_PERIOD_KEYS = ["terms", "payment_terms"] as const;

export type PolicyState =
  "draft" | "submitted" | "approved" | "effective" | "superseded" | "withdrawn";
export type ChangeClass = "INITIAL" | "MAJOR" | "MINOR";

export interface PolicyInstance {
  id: string;
  setId: string;
  key: string;
  versionLabel: string;
  changeClass: ChangeClass;
  title: string;
  body: string;
  hiSummary: string | null;
  summaryOfChanges: string;
  effectiveAt: Date;
  reconsentRequired: boolean;
  privacyClass: boolean;
  state: PolicyState;
  seededPlaceholder: boolean;
  makerId: string;
  checkerId: string | null;
  dpoId: string | null;
  lastReviewedAt: Date;
  supersededAt: Date | null;
  paramsSnapshot: Record<string, unknown> | null;
  renderedSha256: string | null;
}

interface InstanceRow {
  id: string;
  policy_set_id: string;
  policy_key: string;
  version_label: string;
  change_class: ChangeClass;
  title: string;
  body: string;
  hi_summary: string | null;
  hi_machine_translated: boolean;
  summary_of_changes: string;
  effective_at: Date;
  reconsent_required: boolean;
  privacy_class: boolean;
  state: PolicyState;
  seeded_placeholder: boolean;
  maker_id: string;
  checker_id: string | null;
  dpo_id: string | null;
  last_reviewed_at: Date;
  superseded_at: Date | null;
  params_snapshot: Record<string, unknown> | null;
  rendered_sha256: string | null;
  approved_at: Date | null;
}

const toInstance = (r: InstanceRow): PolicyInstance => ({
  id: r.id,
  setId: r.policy_set_id,
  key: r.policy_key,
  versionLabel: r.version_label,
  changeClass: r.change_class,
  title: r.title,
  body: r.body,
  hiSummary: r.hi_summary,
  summaryOfChanges: r.summary_of_changes,
  effectiveAt: r.effective_at,
  reconsentRequired: r.reconsent_required,
  privacyClass: r.privacy_class,
  state: r.state,
  seededPlaceholder: r.seeded_placeholder,
  makerId: r.maker_id,
  checkerId: r.checker_id,
  dpoId: r.dpo_id,
  lastReviewedAt: r.last_reviewed_at,
  supersededAt: r.superseded_at,
  paramsSnapshot: r.params_snapshot,
  renderedSha256: r.rendered_sha256,
});

export interface PolicyFinding {
  code:
    "IPB-POL-001" | "IPB-POL-002" | "IPB-POL-003" | "IPB-POL-004" | "IPB-POL-005" | "IPB-POL-007";
  location: string;
  message: string;
}

export interface PolicyHooks {
  /** The §05.3.2 parameters from the brand pack and settings (entity, product, URLs, support). */
  params?(ctx: KernelContext, packId: string): Promise<PolicyParams>;
  /** `pol.full_hindi` for a pack; Hindi is deferred for the group site (OWN-11). */
  fullHindi?(ctx: KernelContext, packId: string): Promise<boolean>;
  /** NOTIFY `notice.policy.change` to account owners when a MAJOR change is approved (IPB-05-06). */
  notifyPolicyChange?(n: {
    packId: string;
    key: string;
    version: string;
    effectiveAt: Date;
    reconsent: boolean;
  }): Promise<void>;
}

/** "27 Oct 2026" in Asia/Kolkata (IPB-06-43 date format). */
export const policyDate = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })
    .format(d)
    .replace(/,/g, "");

const hasRole = (ctx: KernelContext, role: string) => ctx.principal.roles.includes(role);

export class PolicyStudio {
  private readonly deps: Deps;
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      product: string;
      outbox?: OutboxWriter;
      settings?: SettingsReader;
      lawRegister?: LawRegisterPort;
      hooks?: PolicyHooks;
      now?: () => Date;
    },
  ) {
    this.deps = { audit: o.audit, outbox: o.outbox, product: o.product };
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private platform(ctx: KernelContext, role: string | readonly string[], what: string): void {
    if (ctx.scope !== "platform" || ctx.tenantId !== PLATFORM_TENANT_ID)
      throw new IpbError("IPB-UX-011", { detail: "policies are edited in a platform context" });
    const roles = typeof role === "string" ? [role] : role;
    if (!roles.some((r) => hasRole(ctx, r)))
      throw new IpbError("IPB-UX-011", { detail: `${what} needs ${roles.join(" or ")}` });
  }

  private async setting<T>(ctx: KernelContext, key: string, fallback: T): Promise<T> {
    try {
      return ((await this.o.settings?.get(ctx, key)) ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  // --- Policy sets ---------------------------------------------------------------------

  async createSet(ctx: KernelContext, packId: string): Promise<{ id: string }> {
    this.platform(ctx, [POLICY_MAKER, POLICY_CHECKER], "creating a policy set");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("pol");
        await tx.query(
          "insert into cms.policy_set (id, brand_pack_id, created_by) values ($1, $2, $3)",
          [id, packId, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.policy_set.create",
          resourceType: "cms_policy_set",
          resourceId: id,
          after: { pack: packId },
        });
        return { id };
      },
      { action: "cms.policy_set.create" },
    );
  }

  /** Propose parameter values (officers, governing law, URLs); a PLT_SUPER_ADMIN applies them. */
  async proposeParams(
    ctx: KernelContext,
    setId: string,
    params: Record<string, string | number | boolean>,
  ): Promise<void> {
    this.platform(ctx, POLICY_MAKER, "proposing policy parameters");
    for (const k of Object.keys(params))
      if (!/^[a-z][a-z0-9_]{1,60}$/.test(k))
        throw new IpbError("IPB-POL-001", { detail: `bad parameter name ${k}` });
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          "update cms.policy_set set pending_params = $2::jsonb, pending_maker_id = $3, updated_at = now() where id = $1",
          [setId, JSON.stringify(params), ctx.principal.id],
        );
        if (!r.rowCount) throw new NotFoundError("policy set");
        await this.o.audit.record(tx, {
          action: "cms.policy_set.propose",
          resourceType: "cms_policy_set",
          resourceId: setId,
          after: { keys: Object.keys(params).sort() },
        });
      },
      { action: "cms.policy_set.propose" },
    );
  }

  async approveParams(ctx: KernelContext, setId: string): Promise<void> {
    this.platform(ctx, POLICY_CHECKER, "applying policy parameters");
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<{
          pending_maker_id: string | null;
          params: Record<string, unknown>;
        }>("select pending_maker_id, params from cms.policy_set where id = $1 for update", [setId]);
        const row = r.rows[0];
        if (!row?.pending_maker_id) throw new NotFoundError("pending policy parameters");
        if (row.pending_maker_id === ctx.principal.id) throw new IpbError("IPB-CMS-004");
        await tx.query(
          `update cms.policy_set set params = params || pending_params, params_version = params_version + 1,
             pending_params = null, pending_maker_id = null, updated_at = now() where id = $1`,
          [setId],
        );
        await this.o.audit.record(tx, {
          action: "cms.policy_set.apply",
          resourceType: "cms_policy_set",
          resourceId: setId,
          before: row.params,
          after: { applied_by: ctx.principal.id },
        });
      },
      { action: "cms.policy_set.apply" },
    );
  }

  private async setRow(
    tx: Tx,
    setId: string,
  ): Promise<{ id: string; brand_pack_id: string; params: Record<string, unknown> }> {
    const r = await tx.query<{
      id: string;
      brand_pack_id: string;
      params: Record<string, unknown>;
    }>("select id, brand_pack_id, params from cms.policy_set where id = $1", [setId]);
    if (!r.rows[0]) throw new NotFoundError("policy set");
    return r.rows[0];
  }

  // --- Instances -----------------------------------------------------------------------

  /**
   * Draft a new version of a template for a set. The first is 1.0 (INITIAL) from the shipped
   * skeleton; later ones start from the effective text with a MAJOR or MINOR bump.
   */
  async draft(
    ctx: KernelContext,
    input: {
      setId: string;
      key: string;
      changeClass?: "MAJOR" | "MINOR";
      body?: string;
      summaryOfChanges: string;
      effectiveAt: Date;
      hiSummary?: string;
      hiMachineTranslated?: boolean;
    },
  ): Promise<PolicyInstance> {
    this.platform(ctx, POLICY_MAKER, "drafting a policy");
    const t = policyTemplate(input.key);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.setRow(tx, input.setId);
        const last = await tx.query<InstanceRow>(
          `select * from cms.policy_instance where policy_set_id = $1 and policy_key = $2
             and state in ('approved', 'effective', 'superseded')
           order by string_to_array(version_label, '.')::int[] desc limit 1`,
          [input.setId, input.key],
        );
        const prev = last.rows[0];
        const change: ChangeClass = prev ? (input.changeClass ?? "MINOR") : "INITIAL";
        const version = nextVersion(prev?.version_label ?? null, change);
        const reconsent = change === "MAJOR" && t.reconsentOnMajor;
        const id = newId("pin");
        try {
          await tx.query(
            `insert into cms.policy_instance (id, policy_set_id, policy_key, template_version, version_label, change_class, title,
               body, hi_summary, hi_machine_translated, summary_of_changes, effective_at, reconsent_required, privacy_class,
               supersedes_id, maker_id)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
            [
              id,
              input.setId,
              input.key,
              t.templateVersion,
              version,
              change,
              t.title,
              input.body ?? prev?.body ?? t.body,
              input.hiSummary ?? null,
              input.hiMachineTranslated ?? false,
              input.summaryOfChanges,
              input.effectiveAt,
              reconsent,
              t.privacyClass,
              prev?.id ?? null,
              ctx.principal.id,
            ],
          );
        } catch (e) {
          if ((e as { code?: string }).code === "23505")
            throw new IpbError("IPB-POL-008", {
              detail: `a ${input.key} version is already open; edit it instead`,
            });
          throw e;
        }
        await this.o.audit.record(tx, {
          action: "cms.policy.draft",
          resourceType: "cms_policy_instance",
          resourceId: id,
          after: { key: input.key, version, change },
        });
        await emit(tx, this.deps, CMS_EVENTS.PolicyDrafted, {
          instance_id: id,
          policy_key: input.key,
          version,
        });
        return toInstance(await this.row(tx, id));
      },
      { action: "cms.policy.draft" },
    );
  }

  /** Edit a draft. Anything already submitted or approved is `IPB-POL-008`. */
  async editDraft(
    ctx: KernelContext,
    id: string,
    patch: {
      body?: string;
      summaryOfChanges?: string;
      effectiveAt?: Date;
      hiSummary?: string | null;
      hiMachineTranslated?: boolean;
    },
  ): Promise<PolicyInstance> {
    this.platform(ctx, POLICY_MAKER, "editing a policy");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.row(tx, id, true);
        if (cur.state !== "draft")
          throw new IpbError("IPB-POL-008", {
            detail: `version ${cur.version_label} is ${cur.state}; draft a new version`,
          });
        await tx.query(
          `update cms.policy_instance set body = coalesce($2, body), summary_of_changes = coalesce($3, summary_of_changes),
             effective_at = coalesce($4, effective_at), hi_summary = case when $5::boolean then $6 else hi_summary end,
             hi_machine_translated = coalesce($7, hi_machine_translated), updated_at = now() where id = $1`,
          [
            id,
            patch.body ?? null,
            patch.summaryOfChanges ?? null,
            patch.effectiveAt ?? null,
            patch.hiSummary !== undefined,
            patch.hiSummary ?? null,
            patch.hiMachineTranslated ?? null,
          ],
        );
        await this.o.audit.record(tx, {
          action: "cms.policy.edit",
          resourceType: "cms_policy_instance",
          resourceId: id,
        });
        return toInstance(await this.row(tx, id));
      },
      { action: "cms.policy.edit" },
    );
  }

  private async row(tx: Tx, id: string, lock = false): Promise<InstanceRow> {
    const r = await tx.query<InstanceRow>(
      `select * from cms.policy_instance where id = $1${lock ? " for update" : ""}`,
      [id],
    );
    if (!r.rows[0]) throw new NotFoundError("policy instance");
    return r.rows[0];
  }

  /** The full parameter set for an instance: hook (brand, settings) < policy set < instance. */
  private async params(
    ctx: KernelContext,
    packId: string,
    set: Record<string, unknown>,
    i: InstanceRow,
  ): Promise<PolicyParams> {
    return {
      ...((await this.o.hooks?.params?.(ctx, packId)) ?? {}),
      ...(set as PolicyParams),
      version_label: i.version_label,
      effective_date: policyDate(i.effective_at),
      last_reviewed: policyDate(i.last_reviewed_at),
    };
  }

  /**
   * The publish lint (IPB-05 §05.4.19, `@IPB-05-AT-03`, `-05`, `-06`, `-09`): unresolved parameters
   * and counsel markers, missing mandatory sections, banned wording, stale citations, the notice
   * period for MAJOR changes, and the Hindi rule.
   */
  async lint(
    ctx: KernelContext,
    id: string,
    at: Date = this.now(),
  ): Promise<{ findings: PolicyFinding[]; text: string; params: PolicyParams }> {
    const { inst, set } = await this.o.kernel.read(ctx, async (tx) => {
      const inst = await this.row(tx, id);
      return { inst, set: await this.setRow(tx, inst.policy_set_id) };
    });
    const t = policyTemplate(inst.policy_key);
    const params = await this.params(ctx, set.brand_pack_id, set.params, inst);
    const findings: PolicyFinding[] = [];
    const resolved = resolveParams(inst.body, params);
    for (const p of resolved.unresolved)
      findings.push({
        code: "IPB-POL-001",
        location: `{{${p}}}`,
        message: `parameter ${p} has no value`,
      });
    if (resolved.open.length)
      findings.push({
        code: "IPB-POL-001",
        location: "body",
        message: `${resolved.open.length} counsel marker(s) or open choice(s) remain`,
      });
    const present = new Set(clauseNumbers(inst.body));
    for (const s of t.mandatorySections)
      if (!present.has(s))
        findings.push({
          code: "IPB-POL-002",
          location: `clause ${s}`,
          message: `mandatory section ${s} is missing`,
        });
    const clauses = resolved.text.split(/^(?=##\s)/m);
    for (const c of clauses) {
      const where = /^##\s+(\d+(?:\.\d+)?)\./.exec(c)?.[1];
      const loc = where ? `clause ${where}` : "preamble";
      for (const w of findPhrases(c, wordList().banned))
        findings.push({ code: "IPB-POL-003", location: loc, message: `banned wording "${w}"` });
      if (this.o.lawRegister) {
        const cites = citations(c);
        if (cites.length)
          for (const r of await this.o.lawRegister.checkCitations(cites))
            if (r.status === "repealed" || r.status === "superseded")
              findings.push({
                code: "IPB-POL-004",
                location: loc,
                message: `${r.citation} is ${r.status}${r.replacement ? `; cite ${r.replacement}` : ""}`,
              });
      }
    }
    if (
      inst.change_class === "MAJOR" &&
      (NOTICE_PERIOD_KEYS as readonly string[]).includes(inst.policy_key)
    ) {
      const days = await this.setting<number>(ctx, "pol.notice_days", 30);
      if (inst.effective_at.getTime() < at.getTime() + days * 86_400_000)
        findings.push({
          code: "IPB-POL-005",
          location: "effective_at",
          message: `a MAJOR change takes effect at least ${days} days after approval`,
        });
    }
    if (inst.hi_machine_translated)
      findings.push({
        code: "IPB-POL-007",
        location: "hi-IN",
        message: "the Hindi text is an unreviewed machine translation",
      });
    else if ((await this.o.hooks?.fullHindi?.(ctx, set.brand_pack_id)) && !inst.hi_summary?.trim())
      findings.push({
        code: "IPB-POL-007",
        location: "hi-IN",
        message: "the Hindi version is missing",
      });
    return { findings, text: resolved.text, params };
  }

  private refuse(findings: PolicyFinding[]): never {
    const f = findings[0]!;
    throw new IpbError(f.code, { detail: `${f.location}: ${f.message}`, meta: { findings } });
  }

  async submit(ctx: KernelContext, id: string): Promise<PolicyInstance> {
    this.platform(ctx, POLICY_MAKER, "submitting a policy");
    const l = await this.lint(ctx, id);
    if (l.findings.length) this.refuse(l.findings);
    return this.move(ctx, id, "draft", "submitted", "cms.policy.submit");
  }

  async requestChanges(ctx: KernelContext, id: string, reason: string): Promise<PolicyInstance> {
    this.platform(ctx, [POLICY_CHECKER, POLICY_DPO], "requesting changes");
    if (!reason.trim())
      throw new IpbError("IPB-CMS-003", {
        detail: "a reason is required",
        meta: { reason: "reason" },
      });
    return this.move(ctx, id, "submitted", "draft", "cms.policy.request_changes", { reason });
  }

  private async move(
    ctx: KernelContext,
    id: string,
    from: PolicyState,
    to: PolicyState,
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<PolicyInstance> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.row(tx, id, true);
        if (cur.state !== from)
          throw new IpbError("IPB-CMS-003", {
            detail: `the instance is ${cur.state}`,
            meta: { reason: "transition" },
          });
        await tx.query(
          "update cms.policy_instance set state = $2, updated_at = now() where id = $1",
          [id, to],
        );
        await this.o.audit.record(tx, {
          action,
          resourceType: "cms_policy_instance",
          resourceId: id,
          before: { state: from },
          after: { state: to, ...extra },
        });
        return toInstance(await this.row(tx, id));
      },
      { action },
    );
  }

  /** The PLT_DPO co-approval for privacy-class templates (`@IPB-05-AT-08`). */
  async dpoApprove(ctx: KernelContext, id: string): Promise<PolicyInstance> {
    this.platform(ctx, POLICY_DPO, "the DPO approval");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.row(tx, id, true);
        if (cur.state !== "submitted" || !cur.privacy_class)
          throw new IpbError("IPB-CMS-003", {
            detail: "no DPO approval is pending",
            meta: { reason: "transition" },
          });
        if (cur.maker_id === ctx.principal.id || cur.checker_id === ctx.principal.id)
          throw new IpbError("IPB-CMS-004");
        await tx.query(
          "update cms.policy_instance set dpo_id = $2, updated_at = now() where id = $1",
          [id, ctx.principal.id],
        );
        await this.o.audit.record(tx, {
          action: "cms.policy.dpo_approve",
          resourceType: "cms_policy_instance",
          resourceId: id,
        });
        return toInstance(await this.row(tx, id));
      },
      { action: "cms.policy.dpo_approve" },
    );
  }

  /**
   * The PLT_SUPER_ADMIN approval: never the maker (`IPB-CMS-004`), after the DPO for privacy-class
   * templates (`IPB-POL-006`), with the lint passing at approval time (the notice period runs from
   * here). Snapshots the parameters and the rendered hash.
   */
  async approve(ctx: KernelContext, id: string): Promise<PolicyInstance> {
    this.platform(ctx, POLICY_CHECKER, "approving a policy");
    const at = this.now();
    const l = await this.lint(ctx, id, at);
    const r = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.row(tx, id, true);
        if (cur.state !== "submitted")
          throw new IpbError("IPB-CMS-003", {
            detail: `the instance is ${cur.state}`,
            meta: { reason: "transition" },
          });
        if (cur.maker_id === ctx.principal.id || cur.dpo_id === ctx.principal.id)
          throw new IpbError("IPB-CMS-004");
        if (cur.privacy_class && !cur.dpo_id) throw new IpbError("IPB-POL-006");
        if (l.findings.length) this.refuse(l.findings);
        const html = renderPolicy(l.text);
        await tx.query(
          `update cms.policy_instance set state = 'approved', checker_id = $2, approved_at = $3, params_snapshot = $4::jsonb,
             rendered_sha256 = $5, updated_at = now() where id = $1`,
          [id, ctx.principal.id, at, JSON.stringify(l.params), sha256Hex(html)],
        );
        await this.o.audit.record(tx, {
          action: "cms.policy.approve",
          resourceType: "cms_policy_instance",
          resourceId: id,
          after: {
            version: cur.version_label,
            change: cur.change_class,
            rendered_sha256: sha256Hex(html),
          },
        });
        await emit(tx, this.deps, CMS_EVENTS.PolicyApproved, {
          instance_id: id,
          policy_key: cur.policy_key,
          version: cur.version_label,
          reconsent_required: cur.reconsent_required,
        });
        const set = await this.setRow(tx, cur.policy_set_id);
        return { inst: toInstance(await this.row(tx, id)), packId: set.brand_pack_id };
      },
      { action: "cms.policy.approve" },
    );
    if (r.inst.changeClass === "MAJOR")
      await this.o.hooks?.notifyPolicyChange?.({
        packId: r.packId,
        key: r.inst.key,
        version: r.inst.versionLabel,
        effectiveAt: r.inst.effectiveAt,
        reconsent: r.inst.reconsentRequired,
      });
    return r.inst;
  }

  /**
   * Make approved versions effective when their date arrives (run with the CMS scheduler, once a
   * minute). The previous version is superseded and stays readable; `PolicyEffective` carries the
   * re-consent flag (IPB-05-05).
   */
  async tick(now: Date = this.now()): Promise<string[]> {
    const ctx = cmsServiceContext("svc_cms_scheduler");
    const due = await this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<{ id: string }>(
          "select id from cms.policy_instance where state = 'approved' and effective_at <= $1 order by effective_at",
          [now],
        )
      ).rows.map((r) => r.id),
    );
    for (const id of due)
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const cur = await this.row(tx, id, true);
          if (cur.state !== "approved") return;
          const prev = await tx.query<{ id: string }>(
            `update cms.policy_instance set state = 'superseded', superseded_at = $3, updated_at = now()
              where policy_set_id = $1 and policy_key = $2 and state = 'effective' returning id`,
            [cur.policy_set_id, cur.policy_key, now],
          );
          await tx.query(
            "update cms.policy_instance set state = 'effective', effective_since = $2, updated_at = now() where id = $1",
            [id, now],
          );
          const set = await this.setRow(tx, cur.policy_set_id);
          await this.o.audit.record(tx, {
            action: "cms.policy.effective",
            resourceType: "cms_policy_instance",
            resourceId: id,
            after: { version: cur.version_label, superseded: prev.rows.map((r) => r.id) },
          });
          await emit(
            tx,
            this.deps,
            CMS_EVENTS.PolicyEffective,
            PolicyEffectiveData.parse({
              policy_key: cur.policy_key,
              version: cur.version_label,
              brand_pack_id: set.brand_pack_id,
              effective_at: cur.effective_at.toISOString(),
              reconsent_required: cur.reconsent_required,
            }),
          );
        },
        { action: "cms.policy.effective" },
      );
    return due;
  }

  // --- Review cadence (IPB-05-10, `@IPB-05-AT-07`) ---------------------------------------

  /** Effective instances past their review cadence (6 months for privacy, cookies, retention, AI; else 12). */
  async reviewQueue(ctx: KernelContext, now: Date = this.now()): Promise<PolicyInstance[]> {
    const rows = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (await tx.query<InstanceRow>("select * from cms.policy_instance where state = 'effective'"))
          .rows,
    );
    const out: PolicyInstance[] = [];
    for (const r of rows) {
      const months = await this.setting<number>(
        ctx,
        `pol.review_cadence_months.${r.policy_key}`,
        policyTemplate(r.policy_key).reviewMonths,
      );
      const due = new Date(r.last_reviewed_at);
      due.setUTCMonth(due.getUTCMonth() + months);
      if (due <= now) out.push(toInstance(r));
    }
    return out;
  }

  async emitReviewDue(ctx: KernelContext, now: Date = this.now()): Promise<number> {
    const due = await this.reviewQueue(ctx, now);
    if (!due.length) return 0;
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        for (const i of due) {
          await this.o.audit.record(tx, {
            action: "cms.policy.review_due",
            resourceType: "cms_policy_instance",
            resourceId: i.id,
            after: { key: i.key, last_reviewed_at: i.lastReviewedAt.toISOString() },
          });
          await emit(tx, this.deps, CMS_EVENTS.PolicyReviewDue, {
            instance_id: i.id,
            policy_key: i.key,
            last_reviewed_at: i.lastReviewedAt.toISOString(),
          });
        }
      },
      { action: "cms.policy.review_due" },
    );
    return due.length;
  }

  /** Record a review without changing the text (a MINOR version is needed for any change). */
  async markReviewed(ctx: KernelContext, id: string): Promise<void> {
    this.platform(ctx, POLICY_MAKER, "reviewing a policy");
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          "update cms.policy_instance set last_reviewed_at = now(), updated_at = now() where id = $1 and state = 'effective'",
          [id],
        );
        if (!r.rowCount) throw new NotFoundError("effective policy instance");
        await this.o.audit.record(tx, {
          action: "cms.policy.review",
          resourceType: "cms_policy_instance",
          resourceId: id,
        });
      },
      { action: "cms.policy.review" },
    );
  }

  // --- Completeness (IPB-05-01, `@IPB-05-AT-01`) ----------------------------------------

  /** The mandatory templates without an effective version (`IPB-POL-009` when any). */
  async missing(
    ctx: KernelContext,
    setId: string,
    o: { sellsOnline?: boolean } = {},
  ): Promise<string[]> {
    const keys = [...MANDATORY_POLICY_KEYS, ...(o.sellsOnline ? SELLING_POLICY_KEYS : [])];
    const have = await this.o.kernel.read(ctx, async (tx) =>
      (
        await tx.query<{ policy_key: string }>(
          "select policy_key from cms.policy_instance where policy_set_id = $1 and state = 'effective'",
          [setId],
        )
      ).rows.map((r) => r.policy_key),
    );
    return keys.filter((k) => !have.includes(k));
  }

  /**
   * Brand Studio's `policySetPublished` hook: refuses with `IPB-POL-009` naming the missing
   * templates, so the pack cannot be submitted with an incomplete policy set.
   */
  policySetHook(o: { sellsOnline?: (ctx: KernelContext) => Promise<boolean> } = {}) {
    return async (ctx: KernelContext, setId: string): Promise<boolean> => {
      const missing = await this.missing(ctx, setId, {
        sellsOnline: (await o.sellsOnline?.(ctx)) ?? false,
      });
      if (missing.length)
        throw new IpbError("IPB-POL-009", {
          detail: `missing: ${missing.join(", ")}`,
          meta: { missing },
        });
      return true;
    };
  }

  /**
   * Seed a placeholder instance (PL5 plan §9.5): effective at once, rendered with the
   * "Placeholder — not legal advice, not in force" banner and `noindex`. Only seeds call it, and
   * seeds never run in prod, DR or pre-prod (PL1-D-06); the caller passes its seed guard result.
   */
  async seedPlaceholder(
    ctx: KernelContext,
    input: { setId: string; key: string; seedAllowed: boolean },
  ): Promise<PolicyInstance> {
    if (!input.seedAllowed)
      throw new IpbError("IPB-ENV-001", { detail: "placeholders are seeded only where seeds run" });
    this.platform(ctx, [POLICY_MAKER, POLICY_CHECKER], "seeding a placeholder policy");
    const t = policyTemplate(input.key);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const id = newId("pin");
        await tx.query(
          `insert into cms.policy_instance (id, policy_set_id, policy_key, template_version, version_label, change_class, title,
             body, summary_of_changes, effective_at, privacy_class, state, seeded_placeholder, maker_id, params_snapshot,
             rendered_sha256, effective_since)
           values ($1, $2, $3, $4, '1.0', 'INITIAL', $5, $6, 'Placeholder for development and testing', now(), $7, 'effective', true,
             $8, '{}'::jsonb, $9, now())`,
          [
            id,
            input.setId,
            input.key,
            t.templateVersion,
            t.title,
            t.body,
            t.privacyClass,
            ctx.principal.id,
            sha256Hex(t.body),
          ],
        );
        await this.o.audit.record(tx, {
          action: "cms.policy.seed_placeholder",
          resourceType: "cms_policy_instance",
          resourceId: id,
          after: { key: input.key },
        });
        return toInstance(await this.row(tx, id));
      },
      { action: "cms.policy.seed_placeholder" },
    );
  }

  async get(ctx: KernelContext, id: string): Promise<PolicyInstance> {
    return this.o.kernel.read(ctx, async (tx) => toInstance(await this.row(tx, id)));
  }
}

// --- Public side (IPB-05-04, 05-09, 05-11; `@IPB-05-AT-04`) -------------------------------

export interface PublicPolicy {
  key: string;
  title: string;
  versionLabel: string;
  effectiveAt: string;
  lastReviewed: string;
  summaryOfChanges: string;
  html: string;
  renderedSha256: string | null;
  /** "Superseded on {date}" for prior versions (IPB-05 §05.4.19 Archive). */
  supersededBanner: string | null;
  /** Seeded placeholders render a banner and `noindex`. */
  placeholder: boolean;
  noindex: boolean;
  versions: { versionLabel: string; effectiveAt: string; state: "effective" | "superseded" }[];
}

export class PublicPolicies {
  constructor(
    private readonly o: { kernel: MutationKernel; slugs?: Readonly<Record<string, string>> },
  ) {}

  private ctx: KernelContext = {
    tenantId: PLATFORM_TENANT_ID,
    principal: { id: "svc_cms_public", type: "service", roles: [] },
  };

  private async load(packId: string, key: string, label?: string): Promise<PublicPolicy | null> {
    return this.o.kernel.read(this.ctx, async (tx) => {
      const rows = (
        await tx.query<InstanceRow>(
          `select i.* from cms.policy_instance i join cms.policy_set s on s.id = i.policy_set_id
            where s.brand_pack_id = $1 and i.policy_key = $2 and i.state in ('effective', 'superseded')
            order by i.effective_since desc nulls last`,
          [packId, key],
        )
      ).rows;
      const r = label
        ? rows.find((x) => x.version_label === label)
        : rows.find((x) => x.state === "effective");
      if (!r) return null;
      const text = resolveParams(r.body, (r.params_snapshot ?? {}) as PolicyParams).text;
      return {
        key: r.policy_key,
        title: r.title,
        versionLabel: r.version_label,
        effectiveAt: r.effective_at.toISOString(),
        lastReviewed: r.last_reviewed_at.toISOString(),
        summaryOfChanges: r.summary_of_changes,
        html: renderPolicy(text),
        renderedSha256: r.rendered_sha256,
        supersededBanner:
          r.state === "superseded" && r.superseded_at
            ? `Superseded on ${policyDate(r.superseded_at)}`
            : null,
        placeholder: r.seeded_placeholder,
        noindex: r.seeded_placeholder || r.state === "superseded",
        versions: rows.map((x) => ({
          versionLabel: x.version_label,
          effectiveAt: x.effective_at.toISOString(),
          state: x.state as "effective" | "superseded",
        })),
      };
    });
  }

  current(packId: string, key: string): Promise<PublicPolicy | null> {
    return this.load(packId, key);
  }

  version(packId: string, key: string, label: string): Promise<PublicPolicy | null> {
    return this.load(packId, key, label);
  }

  /** `/legal/index.json` (IPB-05-09): keys, versions, effective dates and URLs. */
  async index(
    packId: string,
    base: string,
  ): Promise<{
    policies: { key: string; title: string; version: string; effective_at: string; url: string }[];
  }> {
    const rows = await this.o.kernel.read(
      this.ctx,
      async (tx) =>
        (
          await tx.query<InstanceRow>(
            `select i.* from cms.policy_instance i join cms.policy_set s on s.id = i.policy_set_id
            where s.brand_pack_id = $1 and i.state = 'effective' order by i.policy_key`,
            [packId],
          )
        ).rows,
    );
    return {
      policies: rows.map((r) => ({
        key: r.policy_key,
        title: r.title,
        version: r.version_label,
        effective_at: r.effective_at.toISOString(),
        url: new URL(
          `/legal/${this.o.slugs?.[r.policy_key] ?? r.policy_key.replace(/_/g, "-")}`,
          base,
        ).toString(),
      })),
    };
  }
}
