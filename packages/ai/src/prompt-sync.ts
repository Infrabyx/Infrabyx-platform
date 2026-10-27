// `infrabyx-ai prompts sync` (PL4 plan §4.4): load the platform prompt files into the platform
// tenant. A new version is stored as DRAFT; it is activated only when its committed eval result
// (`evals/<key>/results/<version>.json`) graded exactly this content and met the baseline. In
// pre-production, production and DR only a live result counts (a real model, in a paid run the
// owner approves); the scripted CI result is enough for dev, test, demo and staging, so AI features
// can be tested on synthetic data in staging (OWNER-QUESTIONS #35, PL4-D-13).
import type { AuditSink, KernelContext, MutationKernel } from "@infrabyx/contracts/kernel";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import { gateAgainstBaseline, loadEvalSet, platformEvalsDir } from "./evals.js";
import type { PromptFile } from "./prompt-files.js";
import { PromptRegistry } from "./prompts.js";

const LIVE_ONLY_ENVS = new Set(["pre-prod", "prod", "dr"]);

export interface SyncResult {
  key: string;
  version: string;
  action: "activated" | "unchanged" | "draft_only";
  reason?: string;
}

export async function syncPrompts(o: {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The release manager running the sync (their user id goes in the ledger). */
  actorId: string;
  /** APP_ENV of the target database. */
  env: string;
  prompts: readonly PromptFile[];
  evalsDir?: string;
}): Promise<SyncResult[]> {
  const ctx: KernelContext = {
    tenantId: PLATFORM_TENANT_ID,
    scope: "platform",
    principal: { id: o.actorId, type: "user", roles: ["PLT_RELEASE_MANAGER"] },
  };
  const registry = new PromptRegistry({ kernel: o.kernel, audit: o.audit });
  const out: SyncResult[] = [];
  for (const p of o.prompts) {
    const stored = await o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ content_sha256: string; status: string }>(
        `select content_sha256, status from ai.prompt_version
          where tenant_id = $1 and prompt_key = $2 and version = $3`,
        [PLATFORM_TENANT_ID, p.promptKey, p.version],
      );
      return r.rows[0];
    });
    if (stored && stored.content_sha256 !== p.contentSha256)
      throw new Error(
        `${p.promptKey}@${p.version} is stored with other content; publish a new version instead`,
      );
    if (stored?.status === "ACTIVE") {
      out.push({ key: p.promptKey, version: p.version, action: "unchanged" });
      continue;
    }
    if (!stored)
      await registry.saveDraft(ctx, {
        promptKey: p.promptKey,
        version: p.version,
        ownerRole: p.ownerRole,
        template: p.template,
        variablesSchema: p.variablesSchema,
        evalSetRef: p.evalSetRef,
        dataClassMax: p.dataClassMax,
      });
    const set = loadEvalSet(p.promptKey, o.evalsDir ?? platformEvalsDir());
    const result = set?.results.get(p.version);
    const reason = !set?.baseline
      ? "no baseline"
      : !result || result.content_sha256 !== p.contentSha256
        ? "no eval result for this content"
        : !gateAgainstBaseline(result, set.baseline).ok
          ? "eval result below the baseline"
          : LIVE_ONLY_ENVS.has(o.env) && !result.live
            ? `${o.env} needs a live eval result (owner-approved paid run)`
            : null;
    if (reason) {
      out.push({ key: p.promptKey, version: p.version, action: "draft_only", reason });
      continue;
    }
    await registry.recordEvalPass(ctx, p.promptKey, p.version, p.contentSha256);
    await registry.activate(ctx, p.promptKey, p.version);
    out.push({ key: p.promptKey, version: p.version, action: "activated" });
  }
  return out;
}
