// Issuing a document from a template (regulatory templates plan §8, items 2a and 2b; R1-D-315,
// R1-D-318, R1-D-321): render (DOCGEN) → review or approval (maker-checker) → signing (ESIGN) →
// archive (STORAGE, write-once with retention, IPB-01-29). One `workflow.document_issue` row per
// document holds references and SHA-256 hashes only, never the template data or a signer's
// details. Every step is a `MutationKernel.mutate` with its ledger entry, keyed on the record id:
// re-running a step that has already happened changes nothing.
//
// The owner's answers (R1-D-318):
//   - a template is registered as needing signatures (`signing: "required"`) or as unsigned
//     (`"none"`, e.g. a notice, a register extract or an MIS report). Only an unsigned template
//     goes from render to the archive, and only once a person has reviewed the render (`review`),
//     or a checker approved it where the product's rules ask for maker-checker (`approval`). A
//     signing template is refused without signers and can never be archived unsigned;
//   - the unsigned rendered copy of a signed document is kept, archived write-once with the signed
//     copy's retention, by reference with its SHA-256, linked to the signed version.
import { IpbError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import type {
  BucketClass,
  DocgenPort,
  EsignPort,
  RenderFormat,
  Signer,
  StoragePort,
} from "@infrabyx/contracts/ports";
import { canonicalDigest, newId, sha256Hex, ulid } from "@infrabyx/crypto";
import {
  ConflictError,
  NotFoundError,
  isAgentPrincipal,
  type ActionPolicy,
  type ApprovalsEngine,
} from "@infrabyx/tenancy";

/** The approval action a document issue is checked under; register its checkers on the engine. */
export const DOCUMENT_ISSUE_ACTION = "workflow.document.issue";

/** How a template is registered (R1-D-318 (1)). */
export type DocumentSigning = "required" | "none";

export interface DocumentTemplatePolicy {
  signing: DocumentSigning;
}

export const DOCUMENT_ISSUE_STATES = [
  "rendered",
  "reviewed",
  "approval_pending",
  "approved",
  "signing",
  "signed",
  "archived",
  "rejected",
  "expired",
  "failed",
] as const;
export type DocumentIssueState = (typeof DOCUMENT_ISSUE_STATES)[number];

/** Why a step is refused; the error's `reason`. */
export type DocumentIssueRefusal =
  | "template_unregistered"
  | "signers_required"
  | "signers_not_expected"
  | "signers_changed"
  | "format_not_signable"
  | "retention_invalid"
  | "render_unverified"
  | "approval_unavailable"
  | "approval_mismatch"
  | "review_not_applicable"
  | "not_signable"
  | "not_archivable"
  | "hash_mismatch"
  | "esign_unavailable";

/** A refused step (409); nothing was changed, except where `hash_mismatch` recorded `failed`. */
export class DocumentIssueError extends ConflictError {
  readonly code = "document_issue_refused";
  constructor(
    readonly reason: DocumentIssueRefusal,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = "DocumentIssueError";
  }
}

export interface DocumentIssue {
  id: string;
  templateId: string;
  templateVersion: string | null;
  format: RenderFormat;
  signing: DocumentSigning;
  /** SHA-256 of the canonical JSON of the template data (never the data). */
  dataSha256: string;
  renderedKey: string;
  renderedSha256: string;
  approvalId: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  /** SHA-256 of the canonical signer list given at `issue` (never the signers' details). */
  signersSha256: string | null;
  envelopeId: string | null;
  signedKey: string | null;
  signedSha256: string | null;
  archivedKey: string | null;
  archivedSha256: string | null;
  /** The unsigned rendered copy, archived beside the signed one (R1-D-318 (2)). */
  renderedArchivedKey: string | null;
  renderedArchivedSha256: string | null;
  retainUntil: Date;
  state: DocumentIssueState;
  failureReason: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueDocumentInput {
  templateId: string;
  data: Record<string, unknown>;
  format: RenderFormat;
  /** Where DOCGEN writes the render: `tenant/<tenant id>/<module>`. */
  outputPrefix: string;
  /** Required for a `signing: "required"` template, refused for an unsigned one. */
  signers?: readonly Signer[];
  /** Maker-checker, where the product's rules ask: a request on `DOCUMENT_ISSUE_ACTION`. */
  approval?: { riskClass: "R2" | "R3" | "R4" | "R5"; summary?: string };
  /** The archive's retention; the product's input, at least later than now (IPB-01-29). */
  retainUntil: Date;
}

export interface SendForSignatureInput {
  /** The signers given at `issue`, again (only their SHA-256 was kept); any change is refused. */
  signers: readonly Signer[];
  order?: "sequential" | "parallel";
  fields?: Parameters<EsignPort["createEnvelope"]>[3];
}

export interface DocumentIssuerOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  docgen: DocgenPort;
  storage: StoragePort;
  /** Needed to send signing templates; an issuer without it refuses `esign_unavailable`. */
  esign?: EsignPort;
  /** Needed for `approval`; an issuer without it refuses `approval_unavailable`. */
  approvals?: ApprovalsEngine;
  /**
   * The STORAGE module the archive goes under (`tenant/<tenant id>/<module>/<ULID>.<ext>`);
   * default `document_archive`.
   */
  archiveModule?: string;
  now?: () => Date;
}

const SIGNABLE: readonly RenderFormat[] = ["pdf", "pdfa"];
const EXTENSIONS: Record<RenderFormat, string> = {
  pdf: "pdf",
  pdfa: "pdf",
  docx: "docx",
  html: "html",
};
const CONTENT_TYPES: Record<RenderFormat, string> = {
  pdf: "application/pdf",
  pdfa: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html; charset=utf-8",
};
const ARCHIVE_CLASS: BucketClass = "REGULATED";

interface Row {
  id: string;
  template_id: string;
  template_version: string | null;
  format: RenderFormat;
  signing: DocumentSigning;
  data_sha256: string;
  rendered_key: string;
  rendered_sha256: string;
  approval_id: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  signers_sha256: string | null;
  envelope_id: string | null;
  signed_key: string | null;
  signed_sha256: string | null;
  archived_key: string | null;
  archived_sha256: string | null;
  rendered_archived_key: string | null;
  rendered_archived_sha256: string | null;
  retain_until: Date;
  state: DocumentIssueState;
  failure_reason: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

const toIssue = (r: Row): DocumentIssue => ({
  id: r.id,
  templateId: r.template_id,
  templateVersion: r.template_version,
  format: r.format,
  signing: r.signing,
  dataSha256: r.data_sha256,
  renderedKey: r.rendered_key,
  renderedSha256: r.rendered_sha256,
  approvalId: r.approval_id,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  signersSha256: r.signers_sha256,
  envelopeId: r.envelope_id,
  signedKey: r.signed_key,
  signedSha256: r.signed_sha256,
  archivedKey: r.archived_key,
  archivedSha256: r.archived_sha256,
  renderedArchivedKey: r.rendered_archived_key,
  renderedArchivedSha256: r.rendered_archived_sha256,
  retainUntil: r.retain_until,
  state: r.state,
  failureReason: r.failure_reason,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** What the approval request binds: the record, the template version and the exact render. */
function approvalPayload(r: {
  id: string;
  template_id: string;
  template_version: string | null;
  rendered_sha256: string;
  signers_sha256: string | null;
}): Record<string, unknown> {
  return {
    document_issue_id: r.id,
    template_id: r.template_id,
    template_version: r.template_version,
    rendered_sha256: r.rendered_sha256,
    signers_sha256: r.signers_sha256,
  };
}

/** The ledger's view of a record: its id, template and hashes, never data or signer details. */
function ledgerView(r: Row): Record<string, unknown> {
  return {
    state: r.state,
    template_id: r.template_id,
    template_version: r.template_version,
    rendered_sha256: r.rendered_sha256,
    ...(r.approval_id ? { approval_id: r.approval_id } : {}),
    ...(r.envelope_id ? { envelope_id: r.envelope_id } : {}),
    ...(r.archived_key ? { archived_key: r.archived_key } : {}),
    ...(r.rendered_archived_key ? { rendered_archived_key: r.rendered_archived_key } : {}),
    ...(r.signed_sha256 ? { signed_sha256: r.signed_sha256 } : {}),
    ...(r.archived_sha256 ? { archived_sha256: r.archived_sha256 } : {}),
    ...(r.rendered_archived_sha256 ? { rendered_archived_sha256: r.rendered_archived_sha256 } : {}),
    ...(r.failure_reason ? { failure_reason: r.failure_reason } : {}),
  };
}

const isStorageExists = (e: unknown): boolean =>
  (e as { code?: unknown } | null)?.code === "IPB-STOR-003";

/**
 * `issueDocument`: render → review or approval → signing → archive. Construct one per product with
 * its ports, register each template's signing rule, then call the steps in order; each returns
 * the record as it now stands.
 */
export class DocumentIssuer {
  private readonly templates = new Map<string, DocumentTemplatePolicy>();
  private readonly now: () => Date;

  constructor(private readonly o: DocumentIssuerOptions) {
    this.now = o.now ?? (() => new Date());
  }

  /** Register a template's signing rule. An unregistered template is refused. */
  registerTemplate(templateId: string, policy: DocumentTemplatePolicy): this {
    if (policy.signing !== "required" && policy.signing !== "none")
      throw new RangeError(`signing must be "required" or "none"`);
    this.templates.set(templateId, { signing: policy.signing });
    return this;
  }

  /** The registered rule, or undefined. */
  templatePolicy(templateId: string): DocumentTemplatePolicy | undefined {
    const p = this.templates.get(templateId);
    return p ? { ...p } : undefined;
  }

  /**
   * The policy to register on the approvals engine for `DOCUMENT_ISSUE_ACTION`:
   * `approvals.register(DOCUMENT_ISSUE_ACTION, issuer.approvalPolicy({ checkerRoles }))`. Its
   * executor moves the document to `approved` in the approval's executing transaction, once the
   * request's payload is checked against the record's render. The maker is never the checker
   * (PL3-D-07, the engine's rule); a delay, where the risk class has one, runs first.
   */
  approvalPolicy(base: Omit<ActionPolicy, "execute" | "autoExecute"> = {}): ActionPolicy {
    return {
      ...base,
      autoExecute: true,
      execute: async (tx, payload, request) => {
        const id = payload["document_issue_id"];
        if (typeof id !== "string") throw new ConflictError("not a document issue approval");
        const cur = await this.lock(tx, id);
        if (
          cur.approval_id !== request.id ||
          request.payloadDigest !== canonicalDigest(approvalPayload(cur))
        )
          throw new DocumentIssueError(
            "approval_mismatch",
            "the approval request does not cover this render",
          );
        if (cur.state !== "approval_pending") return;
        const row = await this.update(tx, id, "state = 'approved'", [], ["approval_pending"]);
        await this.ledger(tx, "approve", row);
      },
    };
  }

  /**
   * Render the template and record it (`rendered`); with `approval`, raise the maker-checker
   * request in the same transaction (`approval_pending`). The render is read back from STORAGE and
   * its SHA-256 checked before anything is recorded.
   */
  async issue(ctx: KernelContext, input: IssueDocumentInput): Promise<DocumentIssue> {
    const policy = this.templates.get(input.templateId);
    if (!policy)
      throw new DocumentIssueError(
        "template_unregistered",
        `template ${input.templateId} has no registered signing rule`,
      );
    const signers = input.signers ?? [];
    if (policy.signing === "required") {
      if (!signers.length)
        throw new DocumentIssueError(
          "signers_required",
          `template ${input.templateId} is registered as needing signatures`,
        );
      if (!SIGNABLE.includes(input.format))
        throw new DocumentIssueError(
          "format_not_signable",
          `a signed document is rendered as pdf or pdfa, not ${input.format}`,
        );
      if (!this.o.esign)
        throw new DocumentIssueError("esign_unavailable", "this issuer has no ESIGN port");
    } else if (signers.length) {
      throw new DocumentIssueError(
        "signers_not_expected",
        `template ${input.templateId} is registered as unsigned`,
      );
    }
    if (!(input.retainUntil instanceof Date) || !(input.retainUntil > this.now()))
      throw new DocumentIssueError("retention_invalid", "retainUntil must be later than now");
    if (input.approval && !this.o.approvals)
      throw new DocumentIssueError("approval_unavailable", "this issuer has no approvals engine");

    const rendered = await this.o.docgen.render(
      {
        templateId: input.templateId,
        data: input.data,
        format: input.format,
        outputPrefix: input.outputPrefix,
      },
      { dataClass: "CONFIDENTIAL" },
    );
    const stored = await this.o.storage.get(rendered.file.storageKey);
    if (sha256Hex(stored.body) !== rendered.file.sha256)
      throw new DocumentIssueError(
        "render_unverified",
        "the stored render's SHA-256 is not the one DOCGEN returned",
      );

    const id = newId("dis");
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const inserted = await tx.query<Row>(
          `insert into workflow.document_issue
             (id, tenant_id, template_id, template_version, format, signing, data_sha256,
              rendered_key, rendered_sha256, signers_sha256, retain_until, state, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'rendered', $12)
           returning *`,
          [
            id,
            ctx.tenantId,
            input.templateId,
            rendered.templateVersion,
            input.format,
            policy.signing,
            canonicalDigest(input.data),
            rendered.file.storageKey,
            rendered.file.sha256,
            signers.length ? canonicalDigest(signers) : null,
            input.retainUntil,
            ctx.principal.id,
          ],
        );
        let row = inserted.rows[0]!;
        await this.ledger(tx, "issue", row);
        if (input.approval) {
          const { id: approvalId } = await this.o.approvals!.request(tx, {
            action: DOCUMENT_ISSUE_ACTION,
            riskClass: input.approval.riskClass,
            payload: approvalPayload(row),
            payloadDataClass: "CONFIDENTIAL",
            summary:
              input.approval.summary ??
              `Issue ${input.templateId}${rendered.templateVersion ? ` v${rendered.templateVersion}` : ""}`,
          });
          row = await this.update(
            tx,
            id,
            "approval_id = $2, state = 'approval_pending'",
            [approvalId],
            ["rendered"],
          );
          await this.ledger(tx, "approval_requested", row);
        }
        return toIssue(row);
      },
      { action: "workflow.document_issue.issue" },
    );
  }

  /**
   * A person reviewed the render of an unsigned document with no approval (R1-D-318 (1)): it may
   * now be archived. Never an agent (IPB-02-10), and never the person who issued it (IPB-SEC-007;
   * plan §8, 2b). A signing template, or one under approval, has no
   * review step and is refused `review_not_applicable`.
   */
  async review(ctx: KernelContext, id: string): Promise<DocumentIssue> {
    if (isAgentPrincipal(ctx))
      throw new IpbError("IPB-SEC-004", {
        detail: "a person reviews a document before it is archived",
        meta: { action: "workflow.document_issue.review" },
      });
    const seen = await this.loadRow(ctx, id);
    if (seen.state === "reviewed") return toIssue(seen);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.lock(tx, id);
        if (cur.created_by === ctx.principal.id)
          throw new IpbError("IPB-SEC-007", {
            detail: "the person who issued a document does not review it",
            meta: { action: "workflow.document_issue.review" },
          });
        if (cur.signing !== "none" || cur.approval_id || cur.state !== "rendered")
          throw new DocumentIssueError(
            "review_not_applicable",
            "only an unsigned document with no approval is reviewed, once, after its render",
          );
        const row = await this.update(
          tx,
          id,
          "reviewed_by = $2, reviewed_at = now(), state = 'reviewed'",
          [ctx.principal.id],
          ["rendered"],
        );
        await this.ledger(tx, "review", row);
        return toIssue(row);
      },
      { action: "workflow.document_issue.review" },
    );
  }

  /**
   * Bring the record in line with its approval request: `rejected` when rejected or cancelled,
   * `expired` when expired. Approval itself arrives through `approvalPolicy`'s executor; this also
   * catches an executed request whose record is still pending (`approved`). The
   * request's payload digest must still be this record's render; anything else is refused.
   */
  async refreshApproval(ctx: KernelContext, id: string): Promise<DocumentIssue> {
    const cur = await this.get(ctx, id);
    if (cur.state !== "approval_pending" || !cur.approvalId) return cur;
    if (!this.o.approvals)
      throw new DocumentIssueError("approval_unavailable", "this issuer has no approvals engine");
    const apr = await this.o.approvals.get(ctx, cur.approvalId);
    const next: { state: DocumentIssueState; reason: string | null } | null =
      apr.state === "executed"
        ? { state: "approved", reason: null }
        : apr.state === "rejected"
          ? { state: "rejected", reason: "approval_rejected" }
          : apr.state === "cancelled"
            ? { state: "rejected", reason: "approval_cancelled" }
            : apr.state === "expired"
              ? { state: "expired", reason: "approval_expired" }
              : null;
    if (!next) return cur;
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row0 = await this.lock(tx, id);
        if (row0.state !== "approval_pending")
          return toIssue(await this.stale(tx, "approval", row0));
        if (
          apr.action !== DOCUMENT_ISSUE_ACTION ||
          apr.payloadDigest !== canonicalDigest(approvalPayload(row0))
        )
          throw new DocumentIssueError(
            "approval_mismatch",
            "the approval request does not cover this render",
          );
        const row = await this.update(
          tx,
          id,
          "state = $2, failure_reason = $3",
          [next.state, next.reason],
          ["approval_pending"],
        );
        await this.ledger(tx, next.state === "approved" ? "approve" : next.state, row);
        return toIssue(row);
      },
      { action: "workflow.document_issue.approval" },
    );
  }

  /**
   * Send a signing template's render for signature: from `rendered` (no approval) or `approved`.
   * The signers must be exactly those given at `issue`. Without an approval an agent may not send
   * (signing is R3; an agent is only ever the maker). A second call returns the record unchanged.
   */
  async sendForSignature(
    ctx: KernelContext,
    id: string,
    input: SendForSignatureInput,
  ): Promise<DocumentIssue> {
    const esign = this.o.esign;
    if (!esign) throw new DocumentIssueError("esign_unavailable", "this issuer has no ESIGN port");
    const cur = await this.loadRow(ctx, id);
    if (cur.envelope_id) return toIssue(cur);
    if (cur.signing !== "required")
      throw new DocumentIssueError(
        "not_signable",
        "an unsigned template is never sent for signature",
      );
    const ready = cur.approval_id ? cur.state === "approved" : cur.state === "rendered";
    if (!ready)
      throw new DocumentIssueError(
        "not_signable",
        cur.approval_id
          ? `the approval must be executed first (state ${cur.state})`
          : `state ${cur.state}`,
      );
    if (!cur.approval_id && isAgentPrincipal(ctx))
      throw new IpbError("IPB-SEC-004", {
        detail: "an agent may not send a document for signature without an approval",
        meta: { action: "workflow.document_issue.send" },
      });
    if (!input.signers.length || canonicalDigest(input.signers) !== cur.signers_sha256)
      throw new DocumentIssueError(
        "signers_changed",
        "the signers are not the ones given when the document was issued",
      );

    const { envelopeId } = await esign.createEnvelope(
      { documentId: cur.id, sha256: cur.rendered_sha256, storageKey: cur.rendered_key },
      [...input.signers],
      input.order ?? "sequential",
      input.fields ?? [],
      { idempotencyKey: `${cur.id}:envelope`, dataClass: "CONFIDENTIAL" },
    );
    await esign.sendForSignature(envelopeId, { idempotencyKey: `${cur.id}:send` });
    const out = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<Row>(
          `update workflow.document_issue
              set envelope_id = $2, state = 'signing', updated_at = now()
            where id = $1 and envelope_id is null and state in ('rendered', 'approved')
            returning *`,
          [id, envelopeId],
        );
        const row = r.rows[0];
        if (!row)
          return { row: await this.stale(tx, "send", await this.lock(tx, id)), duplicate: true };
        await this.ledger(tx, "send", row);
        return { row, duplicate: false };
      },
      { action: "workflow.document_issue.send" },
    );
    // Another call won the race: withdraw this envelope rather than leave two in flight.
    if (out.duplicate && out.row.envelope_id !== envelopeId)
      await esign.cancel(envelopeId, "duplicate envelope for one document issue");
    return toIssue(out.row);
  }

  /**
   * Read the envelope back from ESIGN (after its webhook, or on a product timer). Completed: the
   * signed file is downloaded, read back and its SHA-256 checked (`signed`). Declined: `rejected`;
   * expired: `expired`; cancelled or failed: `failed`. Still in progress: unchanged.
   */
  async completeSigning(ctx: KernelContext, id: string): Promise<DocumentIssue> {
    const esign = this.o.esign;
    if (!esign) throw new DocumentIssueError("esign_unavailable", "this issuer has no ESIGN port");
    const cur = await this.loadRow(ctx, id);
    if (cur.state !== "signing" || !cur.envelope_id) return toIssue(cur);
    const status = await esign.getStatus(cur.envelope_id);
    let set: { state: DocumentIssueState; reason: string | null; key?: string; sha?: string };
    if (status.state === "completed") {
      const signed = await esign.downloadSigned(cur.envelope_id);
      const body = (await this.o.storage.get(signed.storageKey)).body;
      set =
        sha256Hex(body) === signed.sha256
          ? { state: "signed", reason: null, key: signed.storageKey, sha: signed.sha256 }
          : { state: "failed", reason: "signed_hash_mismatch" };
    } else if (status.state === "declined") set = { state: "rejected", reason: "signer_declined" };
    else if (status.state === "expired") set = { state: "expired", reason: "envelope_expired" };
    else if (status.state === "cancelled" || status.state === "failed")
      set = { state: "failed", reason: `envelope_${status.state}` };
    else return toIssue(cur);
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row0 = await this.lock(tx, id);
        if (row0.state !== "signing") return this.stale(tx, "sign", row0);
        const row = await this.update(
          tx,
          id,
          "state = $2, failure_reason = $3, signed_key = $4, signed_sha256 = $5",
          [set.state, set.reason, set.key ?? null, set.sha ?? null],
          ["signing"],
        );
        await this.ledger(tx, set.state === "signed" ? "sign" : set.state, row);
        return row;
      },
      { action: "workflow.document_issue.sign" },
    );
    return toIssue(row);
  }

  /**
   * Archive write-once in REGULATED with the record's retention: a signed document's signed file
   * and, beside it, its unsigned render (R1-D-318 (2)); an unsigned document's render once it is
   * `reviewed` or `approved`. Each source is read back and must hash to the recorded SHA-256, and
   * each archived copy is read back again and proved immutable. A changed source is recorded
   * `failed` (`hash_mismatch`) and refused. A signing template is never archived unsigned.
   */
  async archive(ctx: KernelContext, id: string): Promise<DocumentIssue> {
    const cur = await this.loadRow(ctx, id);
    if (cur.state === "archived") return toIssue(cur);
    const ok =
      cur.signing === "required"
        ? cur.state === "signed"
        : cur.state === "reviewed" || cur.state === "approved";
    if (!ok)
      throw new DocumentIssueError(
        "not_archivable",
        cur.signing === "required"
          ? `a signing template is archived only once signed (state ${cur.state})`
          : `an unsigned document is archived only once reviewed or approved (state ${cur.state})`,
      );
    if (!(cur.retain_until > this.now()))
      throw new DocumentIssueError("retention_invalid", "the retention date has passed");

    // The archive keys are recorded before anything is written, so a retry writes to the same
    // write-once keys and can never leave a second retained copy.
    const keyed = cur.archived_key ? cur : await this.archiveKeys(ctx, id);
    const copies: { key: string; from: string; sha: string; contentType: string }[] =
      cur.signing === "required"
        ? [
            {
              key: keyed.archived_key!,
              from: cur.signed_key!,
              sha: cur.signed_sha256!,
              contentType: "application/pdf",
            },
            {
              key: keyed.rendered_archived_key!,
              from: cur.rendered_key,
              sha: cur.rendered_sha256,
              contentType: CONTENT_TYPES[cur.format],
            },
          ]
        : [
            {
              key: keyed.archived_key!,
              from: cur.rendered_key,
              sha: cur.rendered_sha256,
              contentType: CONTENT_TYPES[cur.format],
            },
          ];
    for (const c of copies) {
      const src = await this.o.storage.get(c.from);
      if (sha256Hex(src.body) !== c.sha) {
        await this.fail(ctx, id, "hash_mismatch");
        throw new DocumentIssueError(
          "hash_mismatch",
          "a file to archive no longer has its recorded SHA-256",
        );
      }
      try {
        await this.o.storage.putWithRetention(c.key, src.body, cur.retain_until, {
          bucketClass: ARCHIVE_CLASS,
          contentType: c.contentType,
          sha256: c.sha,
        });
      } catch (e) {
        // A retry after a write that landed: the write-once copy is there already; it is checked
        // below like a fresh one.
        if (!isStorageExists(e)) throw e;
      }
      const back = await this.o.storage.get(c.key);
      if (sha256Hex(back.body) !== c.sha) {
        await this.fail(ctx, id, "hash_mismatch");
        throw new DocumentIssueError(
          "hash_mismatch",
          "the archived copy does not have the recorded SHA-256",
        );
      }
      await this.o.storage.assertImmutable(c.key);
    }
    const [main, renderedCopy] = copies;
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const row0 = await this.lock(tx, id);
        if (row0.state === "archived") return this.stale(tx, "archive", row0);
        const row = await this.update(
          tx,
          id,
          "archived_sha256 = $2, rendered_archived_sha256 = $3, state = 'archived'",
          [main!.sha, renderedCopy?.sha ?? null],
          [cur.state],
        );
        await this.ledger(tx, "archive", row);
        return row;
      },
      { action: "workflow.document_issue.archive" },
    );
    return toIssue(row);
  }

  async get(ctx: KernelContext, id: string): Promise<DocumentIssue> {
    return toIssue(await this.loadRow(ctx, id));
  }

  // ------------------------------------------------------------------ helpers

  private async loadRow(ctx: KernelContext, id: string): Promise<Row> {
    const row = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<Row>("select * from workflow.document_issue where id = $1", [id]);
      return r.rows[0];
    });
    if (!row) throw new NotFoundError("document issue");
    return row;
  }

  private async lock(tx: Tx, id: string): Promise<Row> {
    const r = await tx.query<Row>(
      "select * from workflow.document_issue where id = $1 for update",
      [id],
    );
    if (!r.rows[0]) throw new NotFoundError("document issue");
    return r.rows[0];
  }

  /** One state move, guarded by the states it may come from. */
  private async update(
    tx: Tx,
    id: string,
    set: string,
    params: unknown[],
    from: readonly DocumentIssueState[],
  ): Promise<Row> {
    const r = await tx.query<Row>(
      `update workflow.document_issue set ${set}, updated_at = now()
        where id = $1 and state = any($${params.length + 2}::text[]) returning *`,
      [id, ...params, [...from]],
    );
    if (!r.rows[0]) throw new ConflictError("document issue changed meanwhile");
    return r.rows[0];
  }

  /** Record the archive keys once (a fresh ULID each, under the archive module). */
  private async archiveKeys(ctx: KernelContext, id: string): Promise<Row> {
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.lock(tx, id);
        if (cur.archived_key) return this.stale(tx, "archive_keyed", cur);
        const module = this.o.archiveModule ?? "document_archive";
        const ext = EXTENSIONS[cur.format];
        const keyOf = (e: string) => `tenant/${ctx.tenantId}/${module}/${ulid()}.${e}`;
        const archived = keyOf(cur.signing === "required" ? "pdf" : ext);
        const renderedCopy = cur.signing === "required" ? keyOf(ext) : null;
        const r = await tx.query<Row>(
          `update workflow.document_issue
              set archived_key = $2, rendered_archived_key = $3, updated_at = now()
            where id = $1 and archived_key is null returning *`,
          [id, archived, renderedCopy],
        );
        await this.ledger(tx, "archive_keyed", r.rows[0]!);
        return r.rows[0]!;
      },
      { action: "workflow.document_issue.archive" },
    );
  }

  private async fail(ctx: KernelContext, id: string, reason: string): Promise<void> {
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const cur = await this.lock(tx, id);
        if (cur.state === "archived" || cur.state === "failed") {
          await this.stale(tx, "failed", cur);
          return;
        }
        const row = await this.update(
          tx,
          id,
          "state = 'failed', failure_reason = $2",
          [reason],
          [cur.state],
        );
        await this.ledger(tx, "failed", row);
      },
      { action: "workflow.document_issue.failed" },
    );
  }

  /** A step another call completed first: recorded as stale (every mutation is ledgered). */
  private async stale(tx: Tx, step: string, row: Row): Promise<Row> {
    await this.o.audit.record(tx, {
      action: `workflow.document_issue.${step}`,
      resourceType: "document_issue",
      resourceId: row.id,
      after: { stale: true, state: row.state },
      businessIds: [row.id],
    });
    return row;
  }

  private async ledger(tx: Tx, step: string, row: Row): Promise<void> {
    await this.o.audit.record(tx, {
      action: `workflow.document_issue.${step}`,
      resourceType: "document_issue",
      resourceId: row.id,
      after: ledgerView(row),
      businessIds: [row.id],
    });
  }
}
