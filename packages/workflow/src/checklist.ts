// Digital checklists with maker-checker sign-off and evidence (regulatory templates item (d); plan
// §6b; R1-D-326). A definition lists the items (an id, the text, its basis, whether evidence is
// required). A run follows one definition: each item is `open`, `met`, `not_met` or
// `not_applicable` (the last two with a reason), evidence is held by STORAGE reference and SHA-256,
// and a `not_met` item raises one follow-up in the Work Inbox. The run is signed off by its maker,
// then by a checker who is not the maker, each after a step-up (a fresh multi-factor session);
// sign-off is refused while any item is open. Every change is a kernel mutation with its ledger
// entry, keyed on the run and item.
import { z } from "zod";
import { IpbError } from "@infrabyx/contracts/errors";
import type {
  AuditSink,
  HumanQueue,
  KernelContext,
  MutationKernel,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { StoragePort } from "@infrabyx/contracts/ports";
import { canonicalDigest, newId, sha256Hex } from "@infrabyx/crypto";
import { ConflictError, NotFoundError, isAgentPrincipal } from "@infrabyx/tenancy";

export const ChecklistDefinition = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9]{0,9}(-[A-Z0-9]{1,10}){0,4}$/),
    title: z.string().trim().min(1).max(200),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    items: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/),
            text: z.string().trim().min(1).max(2000),
            /** The SOP step or provision the check rests on. */
            basis: z.string().trim().min(1).max(300).optional(),
            evidenceRequired: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(500)
      .refine((xs) => new Set(xs.map((x) => x.id)).size === xs.length, {
        message: "item ids are unique",
      }),
    /** Who follows up a `not_met` item (a role name); default ORG_ADMIN. */
    followUpRole: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,63}$/)
      .optional(),
  })
  .strict();
export type ChecklistDefinition = z.infer<typeof ChecklistDefinition>;

export type ChecklistItemState = "open" | "met" | "not_met" | "not_applicable";
export type ChecklistRunState = "open" | "maker_signed" | "signed_off";

export interface EvidenceRef {
  storageKey: string;
  sha256: string;
}

export interface ChecklistItem {
  itemId: string;
  position: number;
  state: ChecklistItemState;
  reason: string | null;
  evidence: EvidenceRef[];
  actionRef: string | null;
}

export interface ChecklistRun {
  id: string;
  code: string;
  version: string;
  definitionSha256: string;
  subjectRef: string | null;
  state: ChecklistRunState;
  makerSignedBy: string | null;
  makerSignedAt: Date | null;
  checkerSignedBy: string | null;
  checkerSignedAt: Date | null;
  createdBy: string;
  items: ChecklistItem[];
}

/**
 * The step-up a sign-off needs: the signer's verified session claims, as the product's guard read
 * them from the token (`VerifiedClaims` `mfa` and `iat`). A sign-off without a fresh multi-factor
 * session is refused `IPB-SEC-001` with `meta.step_up`, which `stepUpChallenge` turns into the
 * RFC 9470 answer.
 */
export interface SignOffStepUp {
  mfa?: boolean;
  /** Issued-at of the session's token, in seconds since the epoch. */
  iat: number;
}

/** Why a step is refused; the error's `reason`. */
export type ChecklistRefusal =
  | "checklist_unknown"
  | "item_unknown"
  | "reason_required"
  | "evidence_required"
  | "evidence_unverified"
  | "items_open"
  | "run_signed";

export class ChecklistError extends ConflictError {
  readonly code = "checklist_refused";
  constructor(
    readonly reason: ChecklistRefusal,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = "ChecklistError";
  }
}

export interface ChecklistServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The Work Inbox (`InboxService`): a `not_met` item raises one follow-up there. */
  inbox: HumanQueue;
  /** With it, each evidence reference is read back and its SHA-256 checked when attached. */
  storage?: StoragePort;
  /** How fresh the step-up must be, in seconds (default 300). */
  stepUpMaxAgeSeconds?: number;
  /** The product's deep link to a run (default `/checklists/<run id>`). */
  deepLink?: (runId: string) => string;
  now?: () => Date;
}

export interface MarkInput {
  state: Exclude<ChecklistItemState, "open">;
  reason?: string;
  evidence?: readonly EvidenceRef[];
}

interface RunRow {
  id: string;
  checklist_code: string;
  checklist_version: string;
  definition_sha256: string;
  subject_ref: string | null;
  state: ChecklistRunState;
  maker_signed_by: string | null;
  maker_signed_at: Date | null;
  checker_signed_by: string | null;
  checker_signed_at: Date | null;
  created_by: string;
}
interface ItemRow {
  item_id: string;
  position: number;
  state: ChecklistItemState;
  reason: string | null;
  evidence: EvidenceRef[];
  action_ref: string | null;
}

const SHA = /^[0-9a-f]{64}$/;

export class ChecklistService {
  private readonly defs = new Map<string, ChecklistDefinition>();
  private readonly now: () => Date;

  constructor(private readonly o: ChecklistServiceOptions) {
    this.now = o.now ?? (() => new Date());
  }

  /** Register a definition (the latest version per code is the one new runs follow). */
  define(definition: ChecklistDefinition): this {
    const d = ChecklistDefinition.parse(definition);
    this.defs.set(d.code, d);
    return this;
  }

  private def(code: string, version?: string): ChecklistDefinition {
    const d = this.defs.get(code);
    if (!d || (version !== undefined && d.version !== version))
      throw new ChecklistError(
        "checklist_unknown",
        `no definition ${code}${version ? ` ${version}` : ""}`,
      );
    return d;
  }

  /** Start a run of `code`, every item open, optionally about a record (`subjectRef`, an id). */
  async start(
    ctx: KernelContext,
    code: string,
    o: { subjectRef?: string } = {},
  ): Promise<ChecklistRun> {
    const d = this.def(code);
    const id = newId("clr");
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await tx.query(
          `insert into workflow.checklist_run
             (id, tenant_id, checklist_code, checklist_version, definition_sha256, subject_ref, state, created_by)
           values ($1, $2, $3, $4, $5, $6, 'open', $7)`,
          [
            id,
            ctx.tenantId,
            d.code,
            d.version,
            canonicalDigest(d),
            o.subjectRef ?? null,
            ctx.principal.id,
          ],
        );
        for (const [i, item] of d.items.entries())
          await tx.query(
            `insert into workflow.checklist_item (tenant_id, run_id, item_id, position, state)
             values ($1, $2, $3, $4, 'open')`,
            [ctx.tenantId, id, item.id, i + 1],
          );
        await this.ledger(tx, "start", id, {
          code: d.code,
          version: d.version,
          items: d.items.length,
        });
      },
      { action: "workflow.checklist.start" },
    );
    return this.get(ctx, id);
  }

  /**
   * Mark one item. `not_met` and `not_applicable` need a reason; `met` on an item that requires
   * evidence needs at least one evidence reference. A `not_met` item raises one follow-up in the
   * Work Inbox (the first time only). A signed run cannot change.
   */
  async mark(
    ctx: KernelContext,
    runId: string,
    itemId: string,
    input: MarkInput,
  ): Promise<ChecklistRun> {
    const run = await this.loadRun(ctx, runId);
    const d = this.def(run.checklist_code, run.checklist_version);
    const item = d.items.find((x) => x.id === itemId);
    if (!item) throw new ChecklistError("item_unknown", `no item ${itemId}`);
    const reason = input.reason?.trim();
    if (input.state !== "met" && !reason)
      throw new ChecklistError("reason_required", `${input.state} needs a reason`);
    const evidence = [...(input.evidence ?? [])];
    for (const e of evidence)
      if (typeof e?.storageKey !== "string" || !e.storageKey || !SHA.test(e?.sha256 ?? ""))
        throw new ChecklistError(
          "evidence_unverified",
          "evidence is a STORAGE key and its SHA-256",
        );
    if (input.state === "met" && item.evidenceRequired && !evidence.length)
      throw new ChecklistError("evidence_required", `item ${itemId} needs evidence`);
    if (this.o.storage)
      for (const e of evidence) {
        const got = sha256Hex((await this.o.storage.get(e.storageKey)).body);
        if (got !== e.sha256)
          throw new ChecklistError(
            "evidence_unverified",
            "an evidence file does not have its SHA-256",
          );
      }
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await this.lockRun(tx, runId);
        if (r.state !== "open")
          throw new ChecklistError("run_signed", "a signed checklist does not change");
        const cur = (
          await tx.query<ItemRow>(
            "select * from workflow.checklist_item where run_id = $1 and item_id = $2 for update",
            [runId, itemId],
          )
        ).rows[0]!;
        let actionRef = cur.action_ref;
        if (input.state === "not_met" && !actionRef) {
          const { id } = await this.o.inbox.raise(tx, {
            type: "task",
            productModule: "checklist",
            recordRef: runId,
            title: `${d.code}: check ${itemId} not met`,
            assignee: { kind: "role", id: d.followUpRole ?? "ORG_ADMIN" },
            severity: "warning",
            actionHint: "follow_up_not_met",
            deepLink: this.o.deepLink?.(runId) ?? `/checklists/${runId}`,
            helpKey: "hlp.checklist.item_not_met",
          });
          actionRef = id;
        }
        await tx.query(
          `update workflow.checklist_item
              set state = $3, reason = $4, evidence = $5::jsonb, action_ref = $6, updated_by = $7, updated_at = now()
            where run_id = $1 and item_id = $2`,
          [
            runId,
            itemId,
            input.state,
            reason ?? null,
            JSON.stringify(evidence.map((e) => ({ storageKey: e.storageKey, sha256: e.sha256 }))),
            actionRef,
            ctx.principal.id,
          ],
        );
        await this.ledger(tx, "mark", runId, {
          item: itemId,
          state: input.state,
          evidence: evidence.map((e) => e.sha256),
          ...(actionRef && actionRef !== cur.action_ref ? { action_ref: actionRef } : {}),
        });
      },
      { action: "workflow.checklist.mark" },
    );
    return this.get(ctx, runId);
  }

  /**
   * Sign off: first the maker (any person), then a checker who is not the maker. Each needs a
   * step-up (`stepUp`: a multi-factor session issued within `stepUpMaxAgeSeconds`). Refused while
   * an item is open; never by an agent (IPB-02-10).
   */
  async signOff(ctx: KernelContext, runId: string, stepUp: SignOffStepUp): Promise<ChecklistRun> {
    if (isAgentPrincipal(ctx))
      throw new IpbError("IPB-SEC-004", {
        detail: "a person signs off a checklist",
        meta: { action: "workflow.checklist.sign_off" },
      });
    const age = this.now().getTime() / 1000 - stepUp.iat;
    if (stepUp.mfa !== true || !(age >= 0 && age <= (this.o.stepUpMaxAgeSeconds ?? 300)))
      throw new IpbError("IPB-SEC-001", {
        detail: "signing off a checklist needs a fresh multi-factor sign-in",
        meta: { step_up: true, required_acr: "mfa" },
      });
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await this.lockRun(tx, runId);
        if (r.state === "signed_off") throw new ChecklistError("run_signed", "already signed off");
        const open = (
          await tx.query<{ item_id: string }>(
            "select item_id from workflow.checklist_item where run_id = $1 and state = 'open' order by position",
            [runId],
          )
        ).rows.map((x) => x.item_id);
        if (open.length)
          throw new ChecklistError("items_open", `open items: ${open.slice(0, 20).join(", ")}`);
        if (r.state === "open") {
          await tx.query(
            `update workflow.checklist_run set state = 'maker_signed', maker_signed_by = $2,
               maker_signed_at = now(), updated_at = now() where id = $1`,
            [runId, ctx.principal.id],
          );
          await this.ledger(tx, "maker_sign", runId, {});
          return;
        }
        if (r.maker_signed_by === ctx.principal.id)
          throw new IpbError("IPB-SEC-007", {
            detail: "the checker is not the maker",
            meta: { action: "workflow.checklist.sign_off" },
          });
        await tx.query(
          `update workflow.checklist_run set state = 'signed_off', checker_signed_by = $2,
             checker_signed_at = now(), updated_at = now() where id = $1`,
          [runId, ctx.principal.id],
        );
        await this.ledger(tx, "checker_sign", runId, {});
      },
      { action: "workflow.checklist.sign_off" },
    );
    return this.get(ctx, runId);
  }

  async get(ctx: KernelContext, runId: string): Promise<ChecklistRun> {
    const { run, items } = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<RunRow>("select * from workflow.checklist_run where id = $1", [
        runId,
      ]);
      const i = await tx.query<ItemRow>(
        "select * from workflow.checklist_item where run_id = $1 order by position",
        [runId],
      );
      return { run: r.rows[0], items: i.rows };
    });
    if (!run) throw new NotFoundError("checklist run");
    return {
      id: run.id,
      code: run.checklist_code,
      version: run.checklist_version,
      definitionSha256: run.definition_sha256,
      subjectRef: run.subject_ref,
      state: run.state,
      makerSignedBy: run.maker_signed_by,
      makerSignedAt: run.maker_signed_at,
      checkerSignedBy: run.checker_signed_by,
      checkerSignedAt: run.checker_signed_at,
      createdBy: run.created_by,
      items: items.map((x) => ({
        itemId: x.item_id,
        position: x.position,
        state: x.state,
        reason: x.reason,
        evidence: x.evidence,
        actionRef: x.action_ref,
      })),
    };
  }

  // ------------------------------------------------------------------ helpers

  private async loadRun(ctx: KernelContext, runId: string): Promise<RunRow> {
    const r = await this.o.kernel.read(ctx, (tx) =>
      tx.query<RunRow>("select * from workflow.checklist_run where id = $1", [runId]),
    );
    if (!r.rows[0]) throw new NotFoundError("checklist run");
    return r.rows[0];
  }

  private async lockRun(tx: Tx, runId: string): Promise<RunRow> {
    const r = await tx.query<RunRow>(
      "select * from workflow.checklist_run where id = $1 for update",
      [runId],
    );
    if (!r.rows[0]) throw new NotFoundError("checklist run");
    return r.rows[0];
  }

  private async ledger(
    tx: Tx,
    step: string,
    runId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.o.audit.record(tx, {
      action: `workflow.checklist.${step}`,
      resourceType: "checklist_run",
      resourceId: runId,
      after,
      businessIds: [runId],
    });
  }
}
