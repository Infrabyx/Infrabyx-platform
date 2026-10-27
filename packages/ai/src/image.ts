// IMAGE_GEN through the gateway (IPB-03-05, 03-06; owner decision OWN-10; PL4 plan §6).
// - Uses are an enum (marketing, blog hero, diagram, placeholder); the prompt guard refuses a real
//   identifiable person, a customer, a regulator, a court, a document purporting to be genuine, and
//   any personal data (`IPB-AI-030`). Prompts are INTERNAL and only their hash is stored.
// - Routing, kill switches, `ai.image.enabled`, caps and one `ai.run` row (operation `image`) as for
//   chat; failover inside the band; fail closed.
// - Every image is labelled before storage (visible band and XMP); an image that cannot be
//   labelled is refused and never stored (`IPB-AI-031`). Images go to the GENERAL bucket.
// - Publishing needs a human approval (OWN-10): `requestPublish` raises an R2 `ai.image.publish`
//   request checked by `PLT_CONTENT_EDITOR` or the product's content roles, never by the requester
//   and never by an agent. `assertPublishable` is the gate the CMS calls (PL5): `IPB-AI-031`
//   without the label, `IPB-AI-032` without the approval (PR-022).
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import {
  AI_EVENTS,
  AiProviderError,
  IMAGE_USES,
  RunCompletedData,
  storageKey,
  type ImageGenPort,
  type ImageUse,
  type StoragePort,
} from "@infrabyx/contracts";
import type { OutboxWriter } from "@infrabyx/contracts/kernel";
import { internalEvent } from "@infrabyx/config/events";
import { newId, sha256Hex } from "@infrabyx/crypto";
import { ImageLabelError, labelImage, readXmp } from "./image-label.js";
import { KillSwitches, type SettingsReader } from "./kill.js";
import { assertUnderCaps, capUse } from "./meter.js";
import { aiTrace } from "./obs.js";
import type { ModelRegistry } from "./registry.js";
import { Breaker, Router } from "./routing.js";
import { Scrubber } from "./scrub.js";
import { NotFoundError } from "@infrabyx/tenancy";

export const IMAGE_PUBLISH_ACTION = "ai.image.publish";
export const IMAGE_PUBLISH_CHECKERS = ["PLT_CONTENT_EDITOR"] as const;

/** The approvals engine as the image service uses it (`ApprovalsEngine` from `@infrabyx/tenancy`). */
export interface ImageApprovals {
  register(
    action: string,
    policy: {
      checkerRoles?: readonly string[];
      execute?: (
        tx: Tx,
        payload: Record<string, unknown>,
        request: { id: string },
      ) => Promise<void>;
    },
  ): unknown;
  request(
    tx: Tx,
    input: {
      action: string;
      riskClass: "R2";
      payload: Record<string, unknown>;
      summary?: string;
    },
  ): Promise<{ id: string }>;
}

/**
 * Subjects IPB-03-05 forbids, rule-based (A-06). Matched case-insensitively on the prompt; the
 * provider's own person filter (`personGeneration: dont_allow` on Imagen) is a second layer.
 */
const FORBIDDEN: readonly { reason: string; re: RegExp }[] = [
  {
    reason: "a real identifiable person",
    re: /\b(photo|photograph|portrait|picture|image|likeness|selfie|headshot|face|caricature)\b[^.\n]{0,20}\bof\s+(mr|mrs|ms|dr|shri|smt|sri)\.?\s+[a-z]/i,
  },
  {
    reason: "a real identifiable person",
    re: /\b(real|actual|identifiable|famous|well-known|living)\s+(person|people|man|woman|individual|celebrity|human)\b/i,
  },
  {
    reason: "a real identifiable person",
    re: /\b(celebrity|politician|prime minister|chief minister|cricketer|film star|actor|actress)\b/i,
  },
  {
    reason: "a customer",
    re: /\b(our|the|a)\s+(customer|client|borrower|applicant|account holder|policyholder)('s)?\b/i,
  },
  {
    reason: "a regulator or a court",
    re: /\b(rbi|reserve bank|sebi|irdai|pfrda|nhb|fiu|income tax department|gst council|ministry|regulator|supreme court|high court|district court|tribunal|nclt|nclat|judge|magistrate|police)\b/i,
  },
  {
    reason: "a document purporting to be genuine",
    re: /\b(aadhaar card|pan card|passport|driving licen[cs]e|voter id|id card|identity card|cheque|stamp paper|e-stamp|court order|decree|summons|currency note|banknote)\b/i,
  },
  {
    reason: "a document purporting to be genuine",
    re: /\b(realistic|genuine|official|authentic|scan(ned)?|photo(graph)?|copy|fake|forged|replica)\b[^.\n]{0,30}\b(certificate|invoice|receipt|bank statement|salary slip|payslip|letterhead|signature|seal|stamp|document|licen[cs]e|notice|agreement|contract)\b/i,
  },
];

/** Why a prompt may not be drawn, or null. */
export function forbiddenImageSubject(prompt: string): string | null {
  return FORBIDDEN.find((f) => f.re.test(prompt))?.reason ?? null;
}

export interface ImageRequest {
  featureKey: string;
  use: ImageUse;
  prompt: string;
  /** `WIDTHxHEIGHT`. */
  size?: string;
  n?: number;
  modelPin?: string;
}

export interface GeneratedImage {
  imageId: string;
  storageKey: string;
  sha256: string;
  width: number;
  height: number;
  sgiLabel: true;
}

export interface ImageServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  product: string;
  settings: SettingsReader;
  registry: ModelRegistry;
  adapters: readonly ImageGenPort[];
  storage: StoragePort;
  approvals: ImageApprovals;
  /** The product's content roles that may also check a publish request (e.g. `LD_CONTENT_EDITOR`). */
  contentRoles?: readonly string[];
  outbox?: OutboxWriter;
  kill?: KillSwitches;
  breaker?: Breaker;
  now?: () => Date;
}

interface ImageRow {
  id: string;
  storage_key: string;
  sha256: string;
  sgi_label: boolean;
  xmp: boolean;
  state: "generated" | "publish_requested" | "approved";
  approval_id: string | null;
  created_by: string;
}

export class ImageService {
  private readonly kill: KillSwitches;
  private readonly router: Router<ImageGenPort>;
  private readonly breaker: Breaker;
  private readonly now: () => Date;

  constructor(private readonly o: ImageServiceOptions) {
    this.now = o.now ?? (() => new Date());
    this.kill = o.kill ?? new KillSwitches(o.settings);
    this.breaker = o.breaker ?? new Breaker({ failures: 5, windowSeconds: 60 });
    this.router = new Router(o.adapters, {
      settings: o.settings,
      kill: this.kill,
      breaker: this.breaker,
      now: this.now,
    });
    o.approvals.register(IMAGE_PUBLISH_ACTION, {
      checkerRoles: [...IMAGE_PUBLISH_CHECKERS, ...(o.contentRoles ?? [])],
      execute: (tx, payload, request) => this.executeApproved(tx, payload, request.id),
    });
  }

  private async setting<T>(ctx: KernelContext, key: string, fallback: T): Promise<T> {
    try {
      const v = await this.o.settings.get(ctx, key);
      return v === null || v === undefined ? fallback : (v as T);
    } catch {
      return fallback;
    }
  }

  async generate(ctx: KernelContext, req: ImageRequest): Promise<GeneratedImage[]> {
    const started = this.now().getTime();
    const runId = newId("run");
    const run = {
      outcome: "refused" as "ok" | "failed" | "refused" | "blocked",
      errorCode: null as string | null,
      modelId: null as string | null,
      adapterKey: null as string | null,
      routeReason: "none",
      candidates: [] as { model_id: string; reason: string }[],
      flags: [] as string[],
    };
    const fail = async (e: IpbError, outcome: typeof run.outcome = "refused"): Promise<never> => {
      run.outcome = outcome;
      run.errorCode = e.code;
      await this.o.kernel.mutate(ctx, (tx) => this.recordRun(tx, ctx, req, runId, run, started), {
        action: "ai.run",
      });
      throw e;
    };

    const gate = await this.kill.gateway(ctx, req.featureKey);
    if (gate.on) return fail(new IpbError("IPB-AI-001", { detail: `${gate.on} is on` }), "blocked");
    if (!(await this.setting(ctx, "ai.image.enabled", true)))
      return fail(new IpbError("IPB-AI-001", { detail: "ai.image.enabled is off" }), "blocked");
    if (!(IMAGE_USES as readonly string[]).includes(req.use))
      return fail(new IpbError("IPB-AI-030", { detail: `use ${req.use} is not permitted` }));
    const subject = forbiddenImageSubject(req.prompt);
    if (subject)
      return fail(new IpbError("IPB-AI-030", { detail: `images may not depict ${subject}` }));
    let scrubber: Scrubber;
    try {
      scrubber = new Scrubber((await this.o.settings.get(ctx, "ai.scrub.patterns")) ?? []);
    } catch {
      return fail(new IpbError("IPB-AI-030", { detail: "the scrub patterns cannot be read" }));
    }
    if (scrubber.detect(req.prompt).length)
      return fail(
        new IpbError("IPB-AI-030", { detail: "an image prompt may not carry personal data" }),
      );
    const n = req.n ?? 1;
    if (n < 1 || n > 4) return fail(new IpbError("IPB-AI-030", { detail: "n must be 1 to 4" }));
    const caps = await this.o.kernel.read(ctx, (tx) =>
      capUse(tx, this.o.settings, ctx, req.featureKey),
    );
    try {
      assertUnderCaps(caps);
    } catch (e) {
      return fail(e as IpbError);
    }
    let crossBorder: boolean;
    try {
      crossBorder =
        (await this.o.settings.get(ctx, "trust.privacy.cross_border_ai_allowed")) === true;
    } catch {
      crossBorder = false;
    }
    let plan;
    try {
      plan = await this.router.plan(ctx, await this.o.registry.routingSnapshot(ctx), {
        featureKey: req.featureKey,
        band: "open",
        capabilities: ["image"],
        primary: "image",
        ...(req.modelPin ? { modelPin: req.modelPin } : {}),
        crossBorderAllowed: crossBorder,
      });
    } catch (e) {
      return fail(e as IpbError);
    }
    run.routeReason = plan.reason;
    run.candidates = [...plan.considered];
    for (const c of plan.ordered) {
      let images;
      try {
        images = await aiTrace(
          "generate_content",
          {
            provider: c.adapter.descriptor.adapterKey,
            requestModel: c.model.providerModelName,
            tenantId: ctx.tenantId,
            featureKey: req.featureKey,
            dataClass: "INTERNAL",
            runId,
            routeReason: plan.reason,
          },
          () =>
            c.adapter.generate({
              model: c.model.providerModelName,
              prompt: req.prompt,
              size: req.size ?? "1024x1024",
              n,
              timeoutMs: 120_000,
            }),
        );
      } catch (e) {
        await this.breaker.failure(c.model.modelId);
        const status = e instanceof AiProviderError ? e.status : null;
        run.candidates.push({ model_id: c.model.modelId, reason: `failed ${status ?? "error"}` });
        if (e instanceof AiProviderError && e.retryable) continue;
        run.modelId = c.model.modelId;
        run.adapterKey = c.model.adapterKey;
        return fail(
          new IpbError("IPB-AI-021", {
            detail: "the provider refused the request",
            meta: { degraded: true },
          }),
        );
      }
      this.breaker.success(c.model.modelId);
      run.modelId = c.model.modelId;
      run.adapterKey = c.model.adapterKey;
      // Label every image before anything is stored; one that cannot be labelled stops the run.
      let labelled;
      try {
        labelled = images.map((img) =>
          labelImage(img.bytes, img.mimeType, { modelId: c.model.modelId, runId }),
        );
      } catch (e) {
        if (!(e instanceof ImageLabelError)) throw e;
        return fail(
          new IpbError("IPB-AI-031", { detail: `the image could not be labelled: ${e.message}` }),
          "failed",
        );
      }
      const promptSha = sha256Hex(req.prompt);
      const modelId = c.model.modelId;
      run.outcome = "ok";
      return this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const out: GeneratedImage[] = [];
          for (const img of labelled) {
            const id = newId("img");
            const key = storageKey(ctx.tenantId, "ai", id.slice(4), "png");
            const sha = sha256Hex(img.bytes);
            await this.o.storage.put(key, img.bytes, {
              contentType: "image/png",
              bucketClass: "GENERAL",
              sha256: sha,
              tags: { sgi: "true", run: runId },
            });
            await tx.query(
              `insert into ai.image
                 (id, tenant_id, feature_key, use, run_id, model_id, prompt_sha256, storage_key,
                  sha256, mime_type, width, height, sgi_label, xmp, created_by)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'image/png', $10, $11, true, true, $12)`,
              [
                id,
                ctx.tenantId,
                req.featureKey,
                req.use,
                runId,
                modelId,
                promptSha,
                key,
                sha,
                img.width,
                img.height,
                ctx.principal.id,
              ],
            );
            await this.o.audit.record(tx, {
              action: "ai.image.generate",
              resourceType: "ai_image",
              resourceId: id,
              after: {
                run_id: runId,
                model_id: modelId,
                use: req.use,
                sha256: sha,
                sgi_label: true,
              },
            });
            out.push({
              imageId: id,
              storageKey: key,
              sha256: sha,
              width: img.width,
              height: img.height,
              sgiLabel: true,
            });
          }
          await this.recordRun(tx, ctx, req, runId, run, started);
          return out;
        },
        { action: "ai.image.generate" },
      );
    }
    return fail(
      new IpbError("IPB-AI-021", {
        detail: plan.ordered.length ? "every eligible model failed" : "no eligible model",
        meta: { degraded: true },
      }),
    );
  }

  private async recordRun(
    tx: Tx,
    ctx: KernelContext,
    req: ImageRequest,
    runId: string,
    run: {
      outcome: string;
      errorCode: string | null;
      modelId: string | null;
      adapterKey: string | null;
      routeReason: string;
      candidates: { model_id: string; reason: string }[];
      flags: string[];
    },
    started: number,
  ): Promise<void> {
    const durationMs = this.now().getTime() - started;
    await tx.query(
      `insert into ai.run
         (id, tenant_id, feature_key, principal_id, principal_type, operation, data_class, band,
          model_id, adapter_key, outcome, error_code, route_reason, candidates, guard_flags,
          duration_ms)
       values ($1, $2, $3, $4, $5, 'image', 'INTERNAL', 'open', $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        runId,
        ctx.tenantId,
        req.featureKey,
        ctx.principal.id,
        ctx.principal.type,
        run.modelId,
        run.adapterKey,
        run.outcome,
        run.errorCode,
        run.routeReason,
        JSON.stringify(run.candidates),
        run.flags,
        durationMs,
      ],
    );
    await this.o.audit.record(tx, {
      action: "ai.run",
      resourceType: "ai_run",
      resourceId: runId,
      after: {
        outcome: run.outcome,
        error: run.errorCode,
        model_id: run.modelId,
        data_class: "INTERNAL",
        route: run.routeReason,
      },
    });
    if (!this.o.outbox || !run.modelId || run.outcome !== "ok") return;
    await this.o.outbox.publish(tx, "ai", {
      envelope: internalEvent({
        product: this.o.product,
        event: AI_EVENTS.RunCompleted,
        tenantId: ctx.tenantId,
        data: RunCompletedData.parse({
          run_id: runId,
          tenant_id: ctx.tenantId,
          feature_key: req.featureKey,
          model_id: run.modelId,
          data_class: "INTERNAL",
          usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 },
          cost_minor_units: null,
          currency: null,
          guard_flags: run.flags,
          duration_ms: durationMs,
        }),
      }),
    });
  }

  private async load(tx: Tx, imageId: string): Promise<ImageRow> {
    const r = await tx.query<ImageRow>(
      `select id, storage_key, sha256, sgi_label, xmp, state, approval_id, created_by
         from ai.image where id = $1`,
      [imageId],
    );
    if (!r.rows[0]) throw new NotFoundError("image");
    return r.rows[0];
  }

  /**
   * Ask a human to approve publishing (OWN-10): an R2 request a content editor checks. Returns the
   * pending or executed request when one exists already.
   */
  async requestPublish(ctx: KernelContext, imageId: string): Promise<{ approvalId: string }> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const img = await this.load(tx, imageId);
        if (!img.sgi_label || !img.xmp)
          throw new IpbError("IPB-AI-031", { detail: "an unlabelled image cannot be published" });
        if (img.state !== "generated" && img.approval_id) {
          const r = await tx.query<{ state: string; expired_at: Date | null }>(
            "select state, expired_at from tenancy.approval_request where id = $1",
            [img.approval_id],
          );
          const s = r.rows[0];
          if (s && !s.expired_at && ["pending", "approved", "executed"].includes(s.state)) {
            await this.o.audit.record(tx, {
              action: "ai.image.publish.request",
              resourceType: "ai_image",
              resourceId: imageId,
              after: { approval_id: img.approval_id, reused: true },
            });
            return { approvalId: img.approval_id };
          }
        }
        const { id } = await this.o.approvals.request(tx, {
          action: IMAGE_PUBLISH_ACTION,
          riskClass: "R2",
          payload: { imageId, sha256: img.sha256 },
          summary: `Publish the AI-generated image ${imageId} (labelled)`,
        });
        await tx.query(
          "update ai.image set state = 'publish_requested', approval_id = $2 where id = $1",
          [imageId, id],
        );
        await this.o.audit.record(tx, {
          action: "ai.image.publish.request",
          resourceType: "ai_image",
          resourceId: imageId,
          after: { approval_id: id },
        });
        return { approvalId: id };
      },
      { action: "ai.image.publish.request" },
    );
  }

  private async executeApproved(
    tx: Tx,
    payload: Record<string, unknown>,
    approvalId: string,
  ): Promise<void> {
    const imageId = String(payload.imageId);
    const img = await this.load(tx, imageId);
    if (img.sha256 !== payload.sha256 || img.approval_id !== approvalId)
      throw new IpbError("IPB-AI-032", { detail: "the image changed after the request" });
    await tx.query(
      "update ai.image set state = 'approved', approved_at = now() where id = $1 and approval_id = $2",
      [imageId, approvalId],
    );
    await this.o.audit.record(tx, {
      action: "ai.image.publish.approve",
      resourceType: "ai_image",
      resourceId: imageId,
      after: { approval_id: approvalId },
    });
  }

  /**
   * The publish gate the CMS calls (PL5): the stored object must still carry the label and match
   * the recorded hash (`IPB-AI-031`), and a human must have approved it (`IPB-AI-032`).
   */
  async assertPublishable(ctx: KernelContext, imageId: string): Promise<void> {
    const img = await this.o.kernel.read(ctx, (tx) => this.load(tx, imageId));
    if (!img.sgi_label || !img.xmp)
      throw new IpbError("IPB-AI-031", { detail: "the image is not labelled" });
    const stored = await this.o.storage.get(img.storage_key);
    let xmp: string | null;
    try {
      xmp = sha256Hex(stored.body) === img.sha256 ? readXmp(stored.body) : null;
    } catch {
      xmp = null;
    }
    if (!xmp?.includes('infrabyx:SGI="true"'))
      throw new IpbError("IPB-AI-031", { detail: "the stored image lost its label" });
    if (img.state !== "approved")
      throw new IpbError("IPB-AI-032", { detail: "a human has not approved publishing" });
  }
}
