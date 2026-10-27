// Prompt registry (IPB-03-25, 03-26; PL4 plan §4.4). Code refers to `prompt_key@major`; the
// gateway resolves the ACTIVE version of that major, the tenant's own before the platform's.
// Templates are logic-less (`{{name}}` only) and immutable once they leave DRAFT. A version
// becomes ACTIVE only after its eval set passed for exactly this content (the eval gate records
// the content hash it graded); rollback is activating the previous version again.
import type { DataClass } from "@infrabyx/contracts/data-class";
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { sha256Hex } from "@infrabyx/crypto";
import { NotFoundError } from "@infrabyx/tenancy";

export const PROMPT_REF = /^([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)@(\d+)$/;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const VAR = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export interface PromptVersion {
  promptKey: string;
  version: string;
  tenantId: string;
  ownerRole: string;
  template: string;
  variablesSchema: Record<string, unknown>;
  evalSetRef: string;
  dataClassMax: DataClass;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  contentSha256: string;
}

interface Row {
  prompt_key: string;
  version: string;
  tenant_id: string;
  owner_role: string;
  template: string;
  variables_schema: Record<string, unknown>;
  eval_set_ref: string;
  data_class_max: PromptVersion["dataClassMax"];
  status: PromptVersion["status"];
  content_sha256: string;
  eval_passed_sha256: string | null;
}
const toVersion = (r: Row): PromptVersion => ({
  promptKey: r.prompt_key,
  version: r.version,
  tenantId: r.tenant_id,
  ownerRole: r.owner_role,
  template: r.template,
  variablesSchema: r.variables_schema,
  evalSetRef: r.eval_set_ref,
  dataClassMax: r.data_class_max,
  status: r.status,
  contentSha256: r.content_sha256,
});

/** The digest that identifies a prompt version's content for the eval gate and provenance. */
export function promptDigest(p: {
  template: string;
  variablesSchema: Record<string, unknown>;
  dataClassMax: string;
}): string {
  return sha256Hex(JSON.stringify({ t: p.template, v: p.variablesSchema, c: p.dataClassMax }));
}

/** Variables a template names. */
export const templateVariables = (template: string): string[] => [
  ...new Set([...template.matchAll(VAR)].map((m) => m[1] as string)),
];

/**
 * `{{name}}` substitution, single pass: substituted values are never re-read as template syntax,
 * and every named variable must be supplied (IPB-AI-050 otherwise).
 */
export function renderTemplate(
  template: string,
  variables: Readonly<Record<string, unknown>>,
): string {
  return template.replace(VAR, (_m, name: string) => {
    if (!(name in variables))
      throw new IpbError("IPB-AI-050", { detail: `prompt variable ${name} is missing` });
    const v = variables[name];
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

export class PromptRegistry {
  constructor(private readonly o: { kernel: MutationKernel; audit: AuditSink }) {}

  /** The ACTIVE version for `key@major`, the tenant's own first (IPB-AI-050 if none). */
  async resolve(ctx: KernelContext, ref: string): Promise<PromptVersion> {
    const m = PROMPT_REF.exec(ref);
    if (!m) throw new IpbError("IPB-AI-050", { detail: `bad prompt reference ${ref}` });
    const [, key, major] = m;
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<Row>(
        `select * from ai.prompt_version
          where prompt_key = $1 and major = $2 and status = 'ACTIVE'
            and tenant_id in ($3, $4)
          order by (tenant_id = $4) asc limit 1`,
        [key, Number(major), ctx.tenantId, PLATFORM_TENANT_ID],
      );
      if (!r.rows[0]) throw new IpbError("IPB-AI-050", { detail: `no ACTIVE version of ${ref}` });
      return toVersion(r.rows[0]);
    });
  }

  /** Store a DRAFT version in the caller's tenant (platform prompts: a platform context). */
  async saveDraft(
    ctx: KernelContext,
    p: {
      promptKey: string;
      version: string;
      ownerRole: string;
      template: string;
      variablesSchema?: Record<string, unknown>;
      evalSetRef: string;
      dataClassMax: PromptVersion["dataClassMax"];
    },
  ): Promise<PromptVersion> {
    const sv = SEMVER.exec(p.version);
    if (!sv) throw new IpbError("IPB-AI-050", { detail: `version ${p.version} is not semver` });
    const variablesSchema = p.variablesSchema ?? {};
    const sha = promptDigest({ ...p, variablesSchema });
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row>(
          `insert into ai.prompt_version
             (prompt_key, version, tenant_id, major, owner_role, template, variables_schema,
              eval_set_ref, data_class_max, content_sha256, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
          [
            p.promptKey,
            p.version,
            ctx.tenantId,
            Number(sv[1]),
            p.ownerRole,
            p.template,
            JSON.stringify(variablesSchema),
            p.evalSetRef,
            p.dataClassMax,
            sha,
            ctx.principal.id,
          ],
        );
        await this.o.audit.record(tx, {
          action: "ai.prompt.draft",
          resourceType: "prompt_version",
          resourceId: `${p.promptKey}@${p.version}`,
          after: { content_sha256: sha, data_class_max: p.dataClassMax },
        });
        return toVersion(r.rows[0] as Row);
      },
      { action: "ai.prompt.draft" },
    );
  }

  /** The eval gate records that this exact content passed its golden set (IPB-03-26). */
  async recordEvalPass(
    ctx: KernelContext,
    promptKey: string,
    version: string,
    contentSha256: string,
  ): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query(
          `update ai.prompt_version set eval_passed_sha256 = $4
            where tenant_id = $1 and prompt_key = $2 and version = $3 and content_sha256 = $4`,
          [ctx.tenantId, promptKey, version, contentSha256],
        );
        if (!r.rowCount)
          throw new IpbError("IPB-AI-050", {
            detail: `${promptKey}@${version} does not have content ${contentSha256}`,
          });
        await this.o.audit.record(tx, {
          action: "ai.prompt.eval_pass",
          resourceType: "prompt_version",
          resourceId: `${promptKey}@${version}`,
          after: { content_sha256: contentSha256 },
        });
      },
      { action: "ai.prompt.eval_pass" },
    );
  }

  /**
   * Make a version ACTIVE and retire the ACTIVE one of the same major. A version that never
   * passed its eval set for its current content is refused (IPB-03-26). Activating a RETIRED
   * version is the one-step rollback.
   */
  async activate(ctx: KernelContext, promptKey: string, version: string): Promise<PromptVersion> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const v = await this.loadRow(tx, ctx.tenantId, promptKey, version);
        if (v.eval_passed_sha256 !== v.content_sha256)
          throw new IpbError("IPB-AI-050", {
            detail: `${promptKey}@${version} has not passed its eval set (${v.eval_set_ref})`,
          });
        const major = Number(SEMVER.exec(version)?.[1]);
        const prev = await tx.query<{ version: string }>(
          `update ai.prompt_version set status = 'RETIRED'
            where tenant_id = $1 and prompt_key = $2 and major = $3 and status = 'ACTIVE'
              and version <> $4 returning version`,
          [ctx.tenantId, promptKey, major, version],
        );
        const r = await tx.query<Row>(
          `update ai.prompt_version set status = 'ACTIVE', activated_at = now()
            where tenant_id = $1 and prompt_key = $2 and version = $3 returning *`,
          [ctx.tenantId, promptKey, version],
        );
        await this.o.audit.record(tx, {
          action: "ai.prompt.activate",
          resourceType: "prompt_version",
          resourceId: `${promptKey}@${version}`,
          before: { active: prev.rows[0]?.version ?? null },
          after: { active: version, content_sha256: v.content_sha256 },
        });
        return toVersion(r.rows[0] as Row);
      },
      { action: "ai.prompt.activate" },
    );
  }

  private async loadRow(tx: Tx, tenantId: string, key: string, version: string): Promise<Row> {
    const r = await tx.query<Row>(
      "select * from ai.prompt_version where tenant_id = $1 and prompt_key = $2 and version = $3",
      [tenantId, key, version],
    );
    if (!r.rows[0]) throw new NotFoundError("prompt version");
    return r.rows[0];
  }
}
