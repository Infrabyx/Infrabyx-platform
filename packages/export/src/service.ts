// Export jobs and downloads (PL3 plan §7.3, PL3-D-22). `request` records a job (ids only) and
// enqueues it after commit; a worker calls `run`, which snapshots the tenant, writes the signed
// archive (C-22) to STORAGE and records it; `download` returns a presigned URL and ledgers the
// archive SHA-256, which is the same on every download of the same archive (IPB-09-37).
// Tenant export is always available to ORG_OWNER (IPB-02-18, 02-82); it is rate-limited, never
// blocked. Restricted folders are refused (IPB-EXP-001) until a product needs them (PL3-D-06), and
// a new destination (IPB-07-27(c)) is refused until a destination connector exists (IPB-EXP-002).
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
import { NotFoundError } from "@infrabyx/tenancy";
import {
  buildArchive,
  FOLDER_PROFILE,
  ARCHIVE_STANDARD_VERSION,
  type ArchiveSigner,
} from "./archive.js";
import { entitiesFor, readSnapshot } from "./snapshot.js";

export const EXPORT_PRINCIPAL_ID = "svc_export";
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
  /** Called after the request commits; enqueue `{ tenantId, jobId }` (ids only) on QUEUE. */
  enqueue?: (tenantId: string, jobId: string) => Promise<void>;
  /** Roles that may request and download (always includes ORG_OWNER). */
  roles?: readonly string[];
  /** `api.export`: concurrent jobs and jobs per day per principal (default 5 and 20). */
  limits?: { concurrent?: number; perDay?: number };
}

interface JobRow {
  id: string;
  scope_type: string;
  scope_ref: string | null;
  map_version: string;
  requester_id: string;
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
  archiveId: r.archive_id,
  bytes: r.bytes === null ? null : Number(r.bytes),
  fileCount: r.file_count,
  manifestHash: r.manifest_hash,
  errorCode: r.error_code,
  createdAt: r.created_at,
});

export class ExportService {
  private readonly roles: readonly string[];
  constructor(private readonly o: ExportServiceOptions) {
    this.roles = [...new Set(["ORG_OWNER", ...(o.roles ?? [])])];
  }

  private role(ctx: KernelContext): string {
    const r = ctx.principal.roles.find((x) => this.roles.includes(x));
    if (!r || ctx.principal.type !== "user") throw new IpbError("IPB-EXP-005");
    return r;
  }

  /** Record an export job for the caller's tenant (R0 for ORG_OWNER) and enqueue it. */
  async request(ctx: KernelContext, req: ExportRequest): Promise<ExportJob> {
    const role = this.role(ctx);
    if (req.restricted?.length) throw new IpbError("IPB-EXP-001");
    if ((req.destination ?? "download") !== "download")
      throw new IpbError("IPB-EXP-002", { detail: "only download destinations exist yet" });
    const scope = { type: req.scope.type, ref: req.scope.ref ?? null };
    entitiesFor(this.o.map, scope);
    const concurrent = this.o.limits?.concurrent ?? 5;
    const perDay = this.o.limits?.perDay ?? 20;
    const job = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const n = await tx.query<{ open: number; day: number }>(
          `select count(*) filter (where state in ('requested', 'running'))::int as open,
                  count(*) filter (where created_at > now() - interval '1 day')::int as day
             from export.export_job where requester_id = $1`,
          [ctx.principal.id],
        );
        const c = n.rows[0] ?? { open: 0, day: 0 };
        if (c.open >= concurrent || c.day >= perDay)
          throw new IpbError("IPB-SEC-019", { meta: { limit: "api.export" } });
        const id = newId("exj");
        const r = await tx.query<JobRow>(
          `insert into export.export_job
             (id, tenant_id, scope_type, scope_ref, map_version, requester_id, requester_role)
           values ($1, $2, $3, $4, $5, $6, $7) returning *`,
          [id, ctx.tenantId, scope.type, scope.ref, this.o.map.map_version, ctx.principal.id, role],
        );
        await this.o.audit.record(tx, {
          action: "export.job.request",
          resourceType: "export_job",
          resourceId: id,
          after: { scope_type: scope.type, map_version: this.o.map.map_version },
        });
        await this.event(
          tx,
          "ExportRequested",
          ExportRequestedData.parse({
            job_id: id,
            scope_type: scope.type,
            data_classes: ["INTERNAL", "CONFIDENTIAL"],
            destination_type: "download",
            requester_role: role,
          }),
        );
        return toJob(r.rows[0] as JobRow);
      },
      { action: "export.job.request" },
    );
    await this.o.enqueue?.(ctx.tenantId, job.id);
    return job;
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
      const predecessor = await this.o.kernel.read(ctx, async (tx) => {
        const p = await tx.query<{ id: string }>(
          "select id from export.archive where scope_type = $1 order by created_at desc, id desc limit 1",
          [job.scope_type],
        );
        return p.rows[0]?.id ?? null;
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
        approvers: [],
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
                signing_kid, manifest_jws, completed_event_jws, predecessor_archive_id, as_of)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
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
   * (`export.archive.download`, resource `<archive id>:<sha256>`).
   */
  async download(ctx: KernelContext, archiveId: string): Promise<{ url: string; sha256: string }> {
    this.role(ctx);
    const row = await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const r = await tx.query<{ storage_key: string; sha256: string }>(
          "select storage_key, sha256 from export.archive where id = $1",
          [archiveId],
        );
        const a = r.rows[0];
        if (!a) throw new NotFoundError("archive");
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
