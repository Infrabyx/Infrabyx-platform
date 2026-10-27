// Export jobs and downloads (PL3 plan §7.3, PL3-D-22). `request` records a job (ids only) and
// enqueues it after commit; a worker calls `run`, which snapshots the tenant, writes the signed
// archive (C-22) to STORAGE and records it; `download` returns a presigned URL and ledgers the
// archive SHA-256, which is the same on every download of the same archive (IPB-09-37).
// Tenant export is always available to ORG_OWNER (IPB-02-18, 02-82); it is rate-limited, never
// blocked. Restricted folders are refused (IPB-EXP-001) until a product needs them (PL3-D-06), and
// a new destination (IPB-07-27(c)) is refused until a destination connector exists (IPB-EXP-002).
// Owner answers #24 (PL3-D-25): ORG_OWNER exports directly; ORG_ADMIN submits a request that an
// ORG_OWNER approves through maker-checker; no other role exports. An archive can be downloaded
// for 30 days; `sweep` then deletes it from STORAGE and ledgers the deletion (IPB-EXP-006 after).
import { IpbError } from "@infrabyx/contracts/errors";
import type { ExportMap } from "@infrabyx/contracts/export";
import { ExportCompletedData, ExportRequestedData } from "@infrabyx/contracts/events";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import type { KmsPort, StoragePort } from "@infrabyx/contracts/ports";
import { storageKey } from "@infrabyx/contracts/ports";
import {
  cloudEventSigningPayload,
  hashedActorId,
  newId,
  signDetachedJws,
  spkiToEs256Jwk,
  type SecretKey,
} from "@infrabyx/crypto";
import { NotFoundError, ServiceReader, type ApprovalsEngine } from "@infrabyx/tenancy";
import {
  buildArchive,
  FOLDER_PROFILE,
  ARCHIVE_STANDARD_VERSION,
  type ArchiveSigner,
} from "./archive.js";
import { entitiesFor, readSnapshot } from "./snapshot.js";

export const EXPORT_PRINCIPAL_ID = "svc_export";
export const EXPORT_SWEEP_PRINCIPAL_ID = "svc_export_sweep";
/** The maker-checker action an ORG_ADMIN export waits on; only ORG_OWNER may check it. */
export const EXPORT_APPROVAL_ACTION = "export.job.request";
/** Days an archive stays downloadable before `sweep` deletes it (owner approval, PL3-D-25). */
export const ARCHIVE_AVAILABLE_DAYS = 30;
/** The roles that export, fixed by the owner (PL3-D-25): products cannot add others. */
export const EXPORT_DIRECT_ROLE = "ORG_OWNER";
export const EXPORT_REQUEST_ROLE = "ORG_ADMIN";
/** Approved jobs the sweep re-enqueues are at least this old, so a normal enqueue goes first. */
const SWEEP_GRACE_MS = 60_000;
/** The worker identity a job runs as, in the job's own tenant context. */
export const exportWorkerContext = (tenantId: string): KernelContext => ({
  tenantId,
  principal: { id: EXPORT_PRINCIPAL_ID, type: "service", roles: ["SVC_EXPORT"] },
});

/** C-22 signer over KMS `sign` with the platform export-signing key (`kid` = KMS key id). */
export async function kmsArchiveSigner(kms: KmsPort, keyId: string): Promise<ArchiveSigner> {
  return {
    kid: keyId,
    sign: (input) => kms.sign(keyId, input, "ecdsa-p256-sha256"),
    publicJwk: spkiToEs256Jwk(await kms.getPublicKey(keyId), keyId),
  };
}

export type ExportScopeType = "DATASET" | "AUDIT_PACK" | "FULL_TENANT";

export interface ExportRequest {
  scope: { type: ExportScopeType | (string & {}); ref?: string | null };
  /** Restricted folder classes (HR, privileged legal, collections): refused in PL3. */
  restricted?: readonly string[];
  /** `download` only; any other destination is the delay-window action of IPB-07-27(c). */
  destination?: string;
}

export interface ExportJob {
  id: string;
  scopeType: string;
  scopeRef: string | null;
  mapVersion: string;
  state: "requested" | "running" | "completed" | "failed";
  /** The ORG_OWNER approval an ORG_ADMIN job ran under; null for an ORG_OWNER's own export. */
  approvalId: string | null;
  archiveId: string | null;
  bytes: number | null;
  fileCount: number | null;
  manifestHash: string | null;
  errorCode: string | null;
  createdAt: Date;
}

/** Builds the Ecosystem envelope for `ExportRequested` / `ExportCompleted` (products own it, D-13). */
export type EcosystemEventBuilder = (
  tx: Tx,
  event: "ExportRequested" | "ExportCompleted",
  data: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>;

export interface ExportServiceOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  storage: StoragePort;
  product: string;
  release: string;
  map: ExportMap;
  signer: ArchiveSigner;
  /** Hashes requester and approver ids in the manifest (`ids_only`). */
  pseudonymKey: SecretKey;
  outbox?: OutboxWriter;
  ecosystemEvent?: EcosystemEventBuilder;
  /**
   * Called after the request commits, and by `sweep` for approved jobs not yet run; enqueue
   * `{ tenantId, jobId }` (ids only) on QUEUE. `run` is idempotent, so a repeat is harmless.
   */
  enqueue?: (tenantId: string, jobId: string) => Promise<void>;
  /**
   * The tenancy approvals engine (from `createWorkflow`); the service registers
   * `export.job.request` on it. Without it an ORG_ADMIN cannot submit an export.
   */
  approvals?: ApprovalsEngine;
  /** `api.export`: concurrent jobs and jobs per day per principal (default 5 and 20). */
  limits?: { concurrent?: number; perDay?: number };
}

interface JobRow {
  id: string;
  scope_type: string;
  scope_ref: string | null;
  map_version: string;
  requester_id: string;
  requester_role: string;
  approval_id: string | null;
  state: ExportJob["state"];
  archive_id: string | null;
  bytes: string | null;
  file_count: number | null;
  manifest_hash: string | null;
  error_code: string | null;
  created_at: Date;
}
const toJob = (r: JobRow): ExportJob => ({
  id: r.id,
  scopeType: r.scope_type,
  scopeRef: r.scope_ref,
  mapVersion: r.map_version,
  state: r.state,
  approvalId: r.approval_id,
  archiveId: r.archive_id,
  bytes: r.bytes === null ? null : Number(r.bytes),
  fileCount: r.file_count,
  manifestHash: r.manifest_hash,
  errorCode: r.error_code,
  createdAt: r.created_at,
});

export class ExportService {
  private readonly sweeper: ServiceReader;
  constructor(private readonly o: ExportServiceOptions) {
    o.approvals?.register(EXPORT_APPROVAL_ACTION, {
      checkerRoles: [EXPORT_DIRECT_ROLE],
      execute: (tx, payload, request) => this.executeApproved(tx, payload, request.id),
    });
    this.sweeper = new ServiceReader({
      kernel: o.kernel,
      audit: o.audit,
      role: "SVC_EXPORT_SWEEP",
      principalId: EXPORT_SWEEP_PRINCIPAL_ID,
    });
  }

  private isUser(ctx: KernelContext, role: string): boolean {
    return ctx.principal.type === "user" && ctx.principal.roles.includes(role);
  }

  private scopeOf(req: ExportRequest): { type: string; ref: string | null } {
    if (req.restricted?.length) throw new IpbError("IPB-EXP-001");
    if ((req.destination ?? "download") !== "download")
      throw new IpbError("IPB-EXP-002", { detail: "only download destinations exist yet" });
    const scope = { type: req.scope.type, ref: req.scope.ref ?? null };
    entitiesFor(this.o.map, scope);
    return scope;
  }

  /** `api.export`: open and daily jobs per requester (default 5 and 20). */
  private async assertWithinLimits(tx: Tx, requesterId: string): Promise<void> {
    const n = await tx.query<{ open: number; day: number }>(
      `select count(*) filter (where state in ('requested', 'running'))::int as open,
              count(*) filter (where created_at > now() - interval '1 day')::int as day
         from export.export_job where requester_id = $1`,
      [requesterId],
    );
    const c = n.rows[0] ?? { open: 0, day: 0 };
    if (c.open >= (this.o.limits?.concurrent ?? 5) || c.day >= (this.o.limits?.perDay ?? 20))
      throw new IpbError("IPB-SEC-019", { meta: { limit: "api.export" } });
  }

  private async insertJob(
    tx: Tx,
    scope: { type: string; ref: string | null },
    requester: { id: string; role: string },
    approvalId: string | null,
  ): Promise<ExportJob> {
    await this.assertWithinLimits(tx, requester.id);
    const id = newId("exj");
    const r = await tx.query<JobRow>(
      `insert into export.export_job
         (id, tenant_id, scope_type, scope_ref, map_version, requester_id, requester_role,
          approval_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [
        id,
        tx.ctx.tenantId,
        scope.type,
        scope.ref,
        this.o.map.map_version,
        requester.id,
        requester.role,
        approvalId,
      ],
    );
    await this.o.audit.record(tx, {
      action: "export.job.request",
      resourceType: "export_job",
      resourceId: id,
      after: {
        scope_type: scope.type,
        map_version: this.o.map.map_version,
        requester_role: requester.role,
        approval_id: approvalId,
      },
    });
    await this.event(
      tx,
      "ExportRequested",
      ExportRequestedData.parse({
        job_id: id,
        scope_type: scope.type,
        data_classes: ["INTERNAL", "CONFIDENTIAL"],
        destination_type: "download",
        requester_role: requester.role,
      }),
    );
    return toJob(r.rows[0] as JobRow);
  }

  /** An ORG_OWNER records an export job for their tenant (R0) and it is enqueued. */
  async request(ctx: KernelContext, req: ExportRequest): Promise<ExportJob> {
    if (!this.isUser(ctx, EXPORT_DIRECT_ROLE))
      throw new IpbError("IPB-EXP-005", {
        detail: "only ORG_OWNER exports directly; ORG_ADMIN submits a request for approval",
      });
    const scope = this.scopeOf(req);
    const job = await this.o.kernel.mutate(
      ctx,
      (tx) => this.insertJob(tx, scope, { id: ctx.principal.id, role: EXPORT_DIRECT_ROLE }, null),
      { action: "export.job.request" },
    );
    await this.o.enqueue?.(ctx.tenantId, job.id);
    return job;
  }

  /**
   * An ORG_ADMIN asks for an export: an approval request (R2, maker-checker) that only an
   * ORG_OWNER may approve. On approval the job is recorded in the approving transaction and the
   * next `sweep` enqueues it.
   */
  async submit(ctx: KernelContext, req: ExportRequest): Promise<{ approvalId: string }> {
    if (!this.isUser(ctx, EXPORT_REQUEST_ROLE) || !this.o.approvals)
      throw new IpbError("IPB-EXP-005", {
        detail: "only ORG_ADMIN submits an export request, through maker-checker",
      });
    const approvals = this.o.approvals;
    const scope = this.scopeOf(req);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        await this.assertWithinLimits(tx, ctx.principal.id);
        const { id } = await approvals.request(tx, {
          action: EXPORT_APPROVAL_ACTION,
          riskClass: "R2",
          payload: {
            scopeType: scope.type,
            scopeRef: scope.ref,
            mapVersion: this.o.map.map_version,
          },
          summary: `Export (${scope.type}${scope.ref ? ` ${scope.ref}` : ""}) under ${this.o.map.map_version}, requested by an ORG_ADMIN`,
        });
        await this.o.audit.record(tx, {
          action: "export.job.submit",
          resourceType: "approval_request",
          resourceId: id,
          after: { scope_type: scope.type, map_version: this.o.map.map_version },
        });
        return { approvalId: id };
      },
      { action: "export.job.submit" },
    );
  }

  /** The approved request's executor: record the job for the ORG_ADMIN who asked for it. */
  private async executeApproved(
    tx: Tx,
    payload: Record<string, unknown>,
    approvalId: string,
  ): Promise<void> {
    const maker = await tx.query<{ maker_id: string }>(
      "select maker_id from tenancy.approval_request where id = $1",
      [approvalId],
    );
    const makerId = maker.rows[0]?.maker_id;
    if (!makerId) throw new NotFoundError("approval request");
    const scope = {
      type: String(payload.scopeType),
      ref: typeof payload.scopeRef === "string" ? payload.scopeRef : null,
    };
    entitiesFor(this.o.map, scope);
    await this.insertJob(tx, scope, { id: makerId, role: EXPORT_REQUEST_ROLE }, approvalId);
  }

  /** The worker: snapshot, build, sign, store and record. Idempotent per job. */
  async run(tenantId: string, jobId: string): Promise<ExportJob> {
    const ctx = exportWorkerContext(tenantId);
    const job = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<JobRow>(
          `update export.export_job set state = 'running', started_at = now()
            where id = $1 and state = 'requested' returning *`,
          [jobId],
        );
        await this.o.audit.record(tx, {
          action: "export.job.start",
          resourceType: "export_job",
          resourceId: jobId,
          after: { started: Boolean(r.rows[0]) },
        });
        return r.rows[0];
      },
      { action: "export.job.start" },
    );
    if (!job) return this.get(ctx, jobId);
    try {
      const scope = { type: job.scope_type, ref: job.scope_ref };
      const entities = entitiesFor(this.o.map, scope);
      const snap = await readSnapshot(this.o.kernel, ctx, this.o.map, entities);
      const archiveId = newId("arc");
      const { predecessor, approvers } = await this.o.kernel.read(ctx, async (tx) => {
        const p = await tx.query<{ id: string }>(
          "select id from export.archive where scope_type = $1 order by created_at desc, id desc limit 1",
          [job.scope_type],
        );
        const a = job.approval_id
          ? await tx.query<{ checker_id: string }>(
              `select checker_id from tenancy.approval_decision
                where request_id = $1 and decision = 'approve' order by checker_id`,
              [job.approval_id],
            )
          : { rows: [] };
        return { predecessor: p.rows[0]?.id ?? null, approvers: a.rows.map((r) => r.checker_id) };
      });
      const built = await buildArchive({
        map: this.o.map,
        archiveId,
        tenantId,
        ownerName: snap.ownerName,
        product: this.o.product,
        release: this.o.release,
        scope: { type: job.scope_type as never, ref: job.scope_ref },
        requester: hashedActorId(this.o.pseudonymKey, job.requester_id),
        approvers: approvers.map((id) => hashedActorId(this.o.pseudonymKey, id)),
        asOf: snap.asOf,
        predecessorArchiveId: predecessor,
        datasets: snap.datasets,
        relationships: snap.relationships,
        signer: this.o.signer,
      });
      const key = storageKey(tenantId, "export", archiveId.slice(4), "zip");
      await this.o.storage.put(key, built.zip, {
        bucketClass: "CONFIDENTIAL",
        contentType: "application/zip",
        sha256: built.sha256,
      });
      return await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          const completed = ExportCompletedData.parse({
            archive_id: archiveId,
            archive_standard_version: ARCHIVE_STANDARD_VERSION,
            folder_profile: FOLDER_PROFILE,
            file_count: built.files.size,
            bytes: built.zip.length,
            manifest_hash: built.manifestHash,
            destination_type: "download",
            predecessor_archive_id: predecessor,
          });
          const eventJws = await this.event(tx, "ExportCompleted", completed, true);
          await tx.query(
            `insert into export.archive
               (id, tenant_id, job_id, map_version, archive_standard_version, folder_profile,
                scope_type, storage_key, sha256, bytes, file_count, manifest_hash, pack_sha256,
                signing_kid, manifest_jws, completed_event_jws, predecessor_archive_id, as_of,
                expires_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                     now() + make_interval(days => $19))`,
            [
              archiveId,
              tenantId,
              jobId,
              this.o.map.map_version,
              ARCHIVE_STANDARD_VERSION,
              FOLDER_PROFILE,
              job.scope_type,
              key,
              built.sha256,
              built.zip.length,
              built.files.size,
              built.manifestHash,
              built.manifest.pack_sha256,
              this.o.signer.kid,
              built.jws,
              eventJws,
              predecessor,
              snap.asOf,
              ARCHIVE_AVAILABLE_DAYS,
            ],
          );
          const r = await tx.query<JobRow>(
            `update export.export_job set state = 'completed', finished_at = now(), archive_id = $2,
                    bytes = $3, file_count = $4, manifest_hash = $5
              where id = $1 returning *`,
            [jobId, archiveId, built.zip.length, built.files.size, built.manifestHash],
          );
          await this.o.audit.record(tx, {
            action: "export.archive.create",
            resourceType: "archive",
            resourceId: `${archiveId}:${built.sha256}`,
            after: { manifest_hash: built.manifestHash, files: built.files.size },
          });
          return toJob(r.rows[0] as JobRow);
        },
        { action: "export.archive.create" },
      );
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const label =
        typeof code === "string" && /^[A-Z]{2,5}-[A-Z]{2,6}-\d{3}$/.test(code)
          ? code
          : "IPB-API-500";
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          await tx.query(
            `update export.export_job set state = 'failed', finished_at = now(), error_code = $2
              where id = $1 and state = 'running'`,
            [jobId, label],
          );
          await this.o.audit.record(tx, {
            action: "export.job.fail",
            resourceType: "export_job",
            resourceId: jobId,
            after: { error: label },
          });
        },
        { action: "export.job.fail" },
      );
      throw e;
    }
  }

  async get(ctx: KernelContext, jobId: string): Promise<ExportJob> {
    return this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<JobRow>("select * from export.export_job where id = $1", [jobId]);
      if (!r.rows[0]) throw new NotFoundError("export job");
      return toJob(r.rows[0]);
    });
  }

  /**
   * A presigned URL (at most 300 s) for a completed archive, with its SHA-256 written to the ledger
   * (`export.archive.download`, resource `<archive id>:<sha256>`). ORG_OWNER downloads any archive
   * of the tenant; an ORG_ADMIN only the archive of a job they asked for and an owner approved.
   * After 30 days the archive is gone (IPB-EXP-006).
   */
  async download(ctx: KernelContext, archiveId: string): Promise<{ url: string; sha256: string }> {
    const owner = this.isUser(ctx, EXPORT_DIRECT_ROLE);
    if (!owner && !this.isUser(ctx, EXPORT_REQUEST_ROLE)) throw new IpbError("IPB-EXP-005");
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<{
          storage_key: string;
          sha256: string;
          requester_id: string;
          approval_id: string | null;
          deleted: boolean;
          expired: boolean;
        }>(
          `select a.storage_key, a.sha256, j.requester_id, j.approval_id,
                  exists (select 1 from export.archive_deletion d where d.archive_id = a.id) as deleted,
                  coalesce(a.expires_at, a.created_at + make_interval(days => $2)) <= now() as expired
             from export.archive a join export.export_job j on j.id = a.job_id
            where a.id = $1`,
          [archiveId, ARCHIVE_AVAILABLE_DAYS],
        );
        const a = r.rows[0];
        if (!a) throw new NotFoundError("archive");
        if (!owner && (a.requester_id !== ctx.principal.id || !a.approval_id))
          throw new IpbError("IPB-EXP-005");
        if (a.deleted || a.expired)
          throw new IpbError("IPB-EXP-006", { meta: { archive_id: archiveId } });
        await this.o.audit.record(tx, {
          action: "export.archive.download",
          resourceType: "archive",
          resourceId: `${archiveId}:${a.sha256}`,
        });
        return a;
      },
      { action: "export.archive.download" },
    );
    const url = await this.o.storage.presign(row.storage_key, "get", 300);
    return { url, sha256: row.sha256 };
  }

  /**
   * The housekeeping worker (run it every few minutes from one worker): enqueue approved jobs that
   * have not started, and delete archives past their 30 days. Cross-tenant reads go through
   * SVC_EXPORT_SWEEP and are ledgered per tenant; each deletion removes the object from STORAGE and
   * writes `export.archive_deletion` and an `export.archive.delete` ledger entry in one
   * transaction, so a failed STORAGE delete leaves the archive for the next sweep.
   */
  async sweep(o: { limit?: number } = {}): Promise<{ enqueued: number; deleted: number }> {
    const limit = o.limit ?? 100;
    let enqueued = 0;
    if (this.o.enqueue) {
      const jobs = await this.sweeper.read<{ id: string; tenant_id: string }>(
        "export.export_job",
        `select id, tenant_id from export.export_job
          where state = 'requested' and created_at < now() - make_interval(secs => $1)
          order by created_at limit $2`,
        [SWEEP_GRACE_MS / 1000, limit],
      );
      for (const j of jobs) {
        await this.o.enqueue(j.tenant_id, j.id);
        enqueued++;
      }
    }
    const due = await this.sweeper.read<{ id: string; tenant_id: string }>(
      "export.archive",
      `select a.id, a.tenant_id from export.archive a
        where coalesce(a.expires_at, a.created_at + make_interval(days => $1)) <= now()
          and not exists (select 1 from export.archive_deletion d where d.archive_id = a.id)
        order by a.created_at limit $2`,
      [ARCHIVE_AVAILABLE_DAYS, limit],
    );
    let deleted = 0;
    for (const a of due) if (await this.deleteExpired(a.tenant_id, a.id)) deleted++;
    return { enqueued, deleted };
  }

  private async deleteExpired(tenantId: string, archiveId: string): Promise<boolean> {
    const ctx = exportWorkerContext(tenantId);
    const a = await this.o.kernel.read(ctx, async (tx) => {
      const r = await tx.query<{ storage_key: string; sha256: string; expires_at: Date }>(
        `select storage_key, sha256,
                coalesce(expires_at, created_at + make_interval(days => $2)) as expires_at
           from export.archive a
          where id = $1 and coalesce(expires_at, created_at + make_interval(days => $2)) <= now()
            and not exists (select 1 from export.archive_deletion d where d.archive_id = a.id)`,
        [archiveId, ARCHIVE_AVAILABLE_DAYS],
      );
      return r.rows[0];
    });
    if (!a) return false;
    try {
      await this.o.kernel.mutate(
        ctx,
        async (tx) => {
          // The deletion row goes first: its primary key makes a concurrent sweep fail here.
          await tx.query(
            `insert into export.archive_deletion (archive_id, tenant_id, reason)
             values ($1, $2, 'expired')`,
            [archiveId, tenantId],
          );
          await this.o.storage.delete(a.storage_key);
          await this.o.audit.record(tx, {
            action: "export.archive.delete",
            resourceType: "archive",
            resourceId: `${archiveId}:${a.sha256}`,
            after: { reason: "expired", expired_at: a.expires_at.toISOString() },
          });
        },
        { action: "export.archive.delete" },
      );
    } catch (e) {
      if ((e as { code?: unknown }).code === "23505") return false;
      throw e;
    }
    return true;
  }

  /**
   * Publish an Ecosystem event the product builds (D-13). `ExportCompleted` is signed (C-22): a
   * detached JWS over the JCS form of the event without its signature attribute, kept with the
   * archive so the proof can be re-verified later.
   */
  private async event(
    tx: Tx,
    event: "ExportRequested" | "ExportCompleted",
    data: Record<string, unknown>,
    sign = false,
  ): Promise<string | null> {
    const envelope = await this.o.ecosystemEvent?.(tx, event, data);
    if (!envelope) return null;
    const jws = sign
      ? await signDetachedJws({
          payload: cloudEventSigningPayload(envelope),
          kid: this.o.signer.kid,
          sign: this.o.signer.sign,
          typ: "JOSE",
        })
      : null;
    await this.o.outbox?.publish(tx, "export", { envelope });
    return jws;
  }
}
