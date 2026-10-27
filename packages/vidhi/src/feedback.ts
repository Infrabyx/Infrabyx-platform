// Feedback (IPB-03-84; PL4 plan §8.9). Thumbs up or down with an optional reason on any output
// (`fbk_`), and a correction loop: a person edits the output and may mark it "use this as
// reference". Corrections are sealed with FieldCrypto, feed the tenant's own eval set (read by the
// skill's owner), and are never used for model training. One rating per person and run.
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
} from "@infrabyx/contracts/kernel";
import { FeedbackReceivedData, VIDHI_EVENTS } from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { FIELD_ALG, newId } from "@infrabyx/crypto";
import type { SettingsReader } from "@infrabyx/ai";
import type { NotebookSealer } from "./notebooks.js";
import type { SkillRegistry } from "./skills.js";

export const FEEDBACK_REASONS = [
  "wrong",
  "incomplete",
  "unclear",
  "unsafe",
  "off_topic",
  "other",
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];
/** Longest correction kept (characters). */
export const MAX_CORRECTION_CHARS = 20_000;

export class FeedbackError extends Error {
  constructor(
    message: string,
    readonly reason: "disabled" | "duplicate" | "invalid" | "forbidden",
  ) {
    super(message);
    this.name = "FeedbackError";
  }
}

export interface FeedbackOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  sealer: NotebookSealer;
  skills: SkillRegistry;
  settings?: SettingsReader;
  outbox?: OutboxWriter;
}

/** One case of a tenant's reference set: the run and the person's corrected output. */
export interface ReferenceCase {
  feedbackId: string;
  runId: string;
  outputRef: string | null;
  expected: string;
  createdAt: Date;
}

const at = (rowId: string) => ({ table: "vidhi.feedback", column: "correction_enc", rowId });
const isAgent = (ctx: KernelContext) =>
  ctx.principal.type === "agent" || ctx.principal.roles.some((r) => r.startsWith("AGT_"));

export class Feedback {
  constructor(private readonly o: FeedbackOptions) {}

  private eventProduct(): string {
    return this.o.product === "PLATFORM" ? "REF" : this.o.product;
  }

  async record(
    ctx: KernelContext,
    i: {
      runId: string;
      rating: "up" | "down";
      reason?: FeedbackReason;
      correction?: string;
      useAsReference?: boolean;
      skillKey?: string;
      outputRef?: string;
    },
  ): Promise<{ feedbackId: string }> {
    if (isAgent(ctx))
      throw new IpbError("IPB-VID-012", { detail: "an agent cannot give feedback" });
    let enabled = true;
    try {
      enabled = (await this.o.settings?.get(ctx, "vidhi.feedback.enabled")) !== false;
    } catch {
      // Unreadable setting: the registry default (on) applies.
    }
    if (!enabled)
      throw new FeedbackError("feedback is turned off for this organisation", "disabled");
    if (!/^run_[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(i.runId))
      throw new FeedbackError("a run id is needed", "invalid");
    if (i.reason && !(FEEDBACK_REASONS as readonly string[]).includes(i.reason))
      throw new FeedbackError(`unknown reason ${i.reason}`, "invalid");
    const correction = i.correction?.trim() || null;
    if (correction && correction.length > MAX_CORRECTION_CHARS)
      throw new FeedbackError(
        `a correction may hold ${MAX_CORRECTION_CHARS} characters`,
        "invalid",
      );
    if (i.useAsReference && !correction)
      throw new FeedbackError("only a correction can be used as a reference", "invalid");
    const id = newId("fbk");
    // The correction may repeat anything the output held, so it is sealed at the highest class.
    const sealed = correction
      ? await this.o.sealer.encryptField(ctx.tenantId, "REGULATED", correction, at(id))
      : null;
    try {
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await tx.query(
            `insert into vidhi.feedback
               (id, tenant_id, run_id, skill_key, output_ref, user_id, rating, reason, correction_enc,
                correction_key_id, use_as_reference)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              id,
              ctx.tenantId,
              i.runId,
              i.skillKey ?? null,
              i.outputRef ?? null,
              ctx.principal.id,
              i.rating,
              i.reason ?? null,
              sealed ? Buffer.from(sealed.enc) : null,
              sealed?.keyId ?? null,
              Boolean(i.useAsReference),
            ],
          );
          await this.o.audit.record(tx, {
            action: "vidhi.feedback.record",
            resourceType: "ai_run",
            resourceId: i.runId,
            after: {
              feedback_id: id,
              rating: i.rating,
              reason: i.reason ?? null,
              has_correction: Boolean(correction),
              use_as_reference: Boolean(i.useAsReference),
            },
          });
          if (this.o.outbox)
            await this.o.outbox.publish(tx, "vidhi", {
              envelope: internalEvent({
                product: this.eventProduct(),
                event: VIDHI_EVENTS.FeedbackReceived,
                tenantId: ctx.tenantId,
                data: FeedbackReceivedData.parse({
                  feedback_id: id,
                  run_id: i.runId,
                  tenant_id: ctx.tenantId,
                  rating: i.rating,
                  has_correction: Boolean(correction),
                  use_as_reference: Boolean(i.useAsReference),
                }),
              }),
            });
        },
        { action: "vidhi.feedback.record" },
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw new FeedbackError("you have already rated this output", "duplicate");
      throw e;
    }
    return { feedbackId: id };
  }

  /**
   * The tenant's reference set for a skill (corrections marked "use this as reference"), for the
   * skill's owner role or an admin. It is the tenant's own eval data, never training data.
   */
  async referenceSet(ctx: KernelContext, skillKey: string): Promise<ReferenceCase[]> {
    const skill = this.o.skills.get(skillKey);
    if (!skill) throw new IpbError("IPB-VID-001", { detail: `skill ${skillKey} is not loaded` });
    const roles = ctx.principal.roles;
    if (isAgent(ctx) || !(roles.includes(skill.manifest.owner_role) || roles.includes("ORG_ADMIN")))
      throw new FeedbackError("only the skill's owner sees its reference set", "forbidden");
    const rows = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<{
            id: string;
            tenant_id: string;
            run_id: string;
            output_ref: string | null;
            correction_enc: Buffer;
            correction_key_id: string;
            created_at: Date;
          }>(
            `select id, tenant_id, run_id, output_ref, correction_enc, correction_key_id, created_at
               from vidhi.feedback
              where skill_key = $1 and use_as_reference order by created_at, id`,
            [skillKey],
          )
        ).rows,
    );
    const out: ReferenceCase[] = [];
    for (const r of rows)
      out.push({
        feedbackId: r.id,
        runId: r.run_id,
        outputRef: r.output_ref,
        expected: new TextDecoder().decode(
          await this.o.sealer.decryptField(
            r.tenant_id,
            { enc: new Uint8Array(r.correction_enc), keyId: r.correction_key_id, alg: FIELD_ALG },
            at(r.id),
          ),
        ),
        createdAt: r.created_at,
      });
    return out;
  }
}
