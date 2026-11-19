// DigiLocker pulls by idempotency key (Udofin PR-UDF-040, R1-D-193; threat model §3.136). A KYC
// adapter keeps, per tenant and adapter, the key of each keyed `digilockerPull` and the documents it
// stored, so a retry after a time-out gets the same documents instead of `consent_used`. Ids,
// hashes and STORAGE references only: the key and the consent session are matched by SHA-256 (the
// key is never kept as given), each document by its reference, issuer and evidence, and no
// document content is kept. A record lives 24 hours (IPB-10-07's window,
// [ASSUMED – owner review] OWNER-QUESTIONS #144); after that the key is forgotten and the session
// stays used. `PgDigilockerPullStore` is the production store (`connectors.kyc_digilocker_pull`,
// migration 0010); `MemoryDigilockerPullStore` serves tests and a single process.
import { PortError } from "@infrabyx/contracts/errors";
import type { AuditSink, KernelContext, MutationKernel, Tx } from "@infrabyx/contracts/kernel";
import type { DIGILOCKER_DOC_TYPES, DigilockerDocument } from "@infrabyx/contracts/ports";
import { canonicalize, newId, sha256Hex } from "@infrabyx/crypto";

/** Hours a pull record is kept (IPB-10-07). */
export const DIGILOCKER_PULL_TTL_HOURS = 24;

export interface DigilockerPullRequest {
  tenantId: string;
  /** The adapter's descriptor name; each adapter keeps its own records. */
  adapter: string;
  idempotencyKey: string;
  consentSession: string;
  docTypes: readonly (typeof DIGILOCKER_DOC_TYPES)[number][];
}

/** What an earlier pull with the same key left. */
export type DigilockerPullFound =
  | { kind: "none" }
  /** A pull with this key reserved the session and did not finish (a crash or a time-out). */
  | { kind: "pending"; id: string }
  | { kind: "done"; documents: DigilockerDocument[] }
  /** The session was already used when this key first came. */
  | { kind: "refused" };

export type DigilockerPullReservation =
  | { kind: "new"; id: string }
  | Exclude<DigilockerPullFound, { kind: "none" }>
  /** Another key of this tenant already holds the session. */
  | { kind: "session_taken" };

export interface DigilockerPullStore {
  /** The live record for the key; `IPB-PORT-004` when it was for another session or other types. */
  find(r: DigilockerPullRequest): Promise<DigilockerPullFound>;
  /** Reserve the key for this pull, or report what another call with the key or session left. */
  reserve(r: DigilockerPullRequest): Promise<DigilockerPullReservation>;
  /** Record the documents; returns those of the record (an earlier finisher's, if any). */
  complete(
    r: DigilockerPullRequest,
    id: string,
    documents: DigilockerDocument[],
  ): Promise<DigilockerDocument[]>;
  /** The session was used elsewhere: a retry with the key is refused `consent_used` too. */
  refuse(r: DigilockerPullRequest, id: string): Promise<void>;
}

export const digilockerKeyHash = (key: string): string => sha256Hex(`digilocker-key:${key}`);
export const digilockerConsentHash = (s: string): string => sha256Hex(`digilocker-session:${s}`);
const requestHash = (r: DigilockerPullRequest): string =>
  sha256Hex(
    canonicalize({
      consent: digilockerConsentHash(r.consentSession),
      docTypes: [...new Set(r.docTypes)].sort(),
    }),
  );

export function digilockerPullConflict(adapter: string): PortError {
  return new PortError("IPB-PORT-004", "KYC", {
    adapter,
    detail: "idempotency key reused with another DigiLocker session or other document types",
    meta: { reason: "idempotency_conflict" },
  });
}

/** Only the fields the port defines, so nothing else a vendor sent is ever kept. */
function refsOnly(docs: readonly DigilockerDocument[]): DigilockerDocument[] {
  return docs.map((d) => ({
    docType: d.docType,
    file: { storageKey: d.file.storageKey, sha256: d.file.sha256 },
    issuer: d.issuer,
    ...(d.issuedAt !== undefined ? { issuedAt: d.issuedAt } : {}),
    ...(d.evidence
      ? {
          evidence: {
            vendorRef: d.evidence.vendorRef,
            adapter: d.evidence.adapter,
            modelVersion: d.evidence.modelVersion,
            checkedAt: d.evidence.checkedAt,
          },
        }
      : {}),
    signatureValid: d.signatureValid ?? null,
  }));
}

/** In-memory store for tests and a single process. */
export class MemoryDigilockerPullStore implements DigilockerPullStore {
  private readonly rows = new Map<
    string,
    {
      id: string;
      /** Tenant and adapter. */
      scope: string;
      consent: string;
      request: string;
      state: "pending" | "done" | "refused";
      documents?: DigilockerDocument[];
      expiresAt: number;
    }
  >();
  constructor(private readonly o: { now?: () => Date; ttlHours?: number } = {}) {}
  private now(): number {
    return (this.o.now?.() ?? new Date()).getTime();
  }
  private k(r: DigilockerPullRequest): string {
    return `${r.tenantId}|${r.adapter}|${digilockerKeyHash(r.idempotencyKey)}`;
  }
  private live(r: DigilockerPullRequest) {
    const row = this.rows.get(this.k(r));
    return row && row.expiresAt > this.now() ? row : undefined;
  }
  private found(r: DigilockerPullRequest, adapter: string): DigilockerPullFound {
    const row = this.live(r);
    if (!row) return { kind: "none" };
    if (row.request !== requestHash(r)) throw digilockerPullConflict(adapter);
    if (row.state === "done") return { kind: "done", documents: structuredClone(row.documents!) };
    return row.state === "pending" ? { kind: "pending", id: row.id } : { kind: "refused" };
  }

  async find(r: DigilockerPullRequest): Promise<DigilockerPullFound> {
    return this.found(r, r.adapter);
  }

  async reserve(r: DigilockerPullRequest): Promise<DigilockerPullReservation> {
    const cur = this.found(r, r.adapter);
    if (cur.kind !== "none") return cur;
    const consent = digilockerConsentHash(r.consentSession);
    for (const row of this.rows.values())
      if (row.scope === `${r.tenantId}|${r.adapter}` && row.consent === consent)
        if (row.expiresAt > this.now()) return { kind: "session_taken" };
    const id = newId("kdl");
    this.rows.set(this.k(r), {
      id,
      scope: `${r.tenantId}|${r.adapter}`,
      consent,
      request: requestHash(r),
      state: "pending",
      expiresAt: this.now() + (this.o.ttlHours ?? DIGILOCKER_PULL_TTL_HOURS) * 3600_000,
    });
    return { kind: "new", id };
  }

  async complete(
    r: DigilockerPullRequest,
    id: string,
    documents: DigilockerDocument[],
  ): Promise<DigilockerDocument[]> {
    const row = this.rows.get(this.k(r));
    if (!row || row.id !== id) return refsOnly(documents);
    if (row.state === "pending") {
      row.state = "done";
      row.documents = refsOnly(documents);
    }
    return structuredClone(row.documents ?? refsOnly(documents));
  }

  async refuse(r: DigilockerPullRequest, id: string): Promise<void> {
    const row = this.rows.get(this.k(r));
    if (row && row.id === id && row.state === "pending") row.state = "refused";
  }
}

export interface PgDigilockerPullStoreOptions {
  kernel: MutationKernel;
  audit: AuditSink;
  /** The kernel context to write a tenant's records in (the adapter's service principal). */
  context: (tenantId: string) => KernelContext;
  ttlHours?: number;
}

interface Row {
  id: string;
  request_hash: string;
  state: "pending" | "done" | "refused";
  documents: DigilockerDocument[] | null;
}

/**
 * PostgreSQL store on `connectors.kyc_digilocker_pull`. Every write goes through the kernel with a
 * ledger entry that names the adapter, the key's hash, the state and the number of documents; never
 * a storage key, the key or the session.
 */
export class PgDigilockerPullStore implements DigilockerPullStore {
  constructor(private readonly o: PgDigilockerPullStoreOptions) {}

  private ctx(tenantId: string): KernelContext {
    const ctx = this.o.context(tenantId);
    if (ctx.tenantId !== tenantId)
      throw new PortError("IPB-PORT-001", "KYC", {
        detail: "the DigiLocker pull store's context names another tenant",
        meta: { reason: "tenant_mismatch" },
      });
    return ctx;
  }

  private static readonly LIVE = `select id, request_hash, state, documents
      from connectors.kyc_digilocker_pull
     where tenant_id = $1 and adapter = $2 and key_hash = $3 and expires_at > now()`;

  private static map(r: DigilockerPullRequest, row: Row | undefined): DigilockerPullFound {
    if (!row) return { kind: "none" };
    if (row.request_hash !== requestHash(r)) throw digilockerPullConflict(r.adapter);
    if (row.state === "done") return { kind: "done", documents: row.documents ?? [] };
    return row.state === "pending" ? { kind: "pending", id: row.id } : { kind: "refused" };
  }

  async find(r: DigilockerPullRequest): Promise<DigilockerPullFound> {
    const ctx = this.ctx(r.tenantId);
    const row = await this.o.kernel.read(
      ctx,
      async (tx) =>
        (
          await tx.query<Row>(PgDigilockerPullStore.LIVE, [
            ctx.tenantId,
            r.adapter,
            digilockerKeyHash(r.idempotencyKey),
          ])
        ).rows[0],
    );
    return PgDigilockerPullStore.map(r, row);
  }

  async reserve(r: DigilockerPullRequest): Promise<DigilockerPullReservation> {
    const ctx = this.ctx(r.tenantId);
    const kh = digilockerKeyHash(r.idempotencyKey);
    const ch = digilockerConsentHash(r.consentSession);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        // An expired record of this key or session is forgotten before the new one is written.
        await tx.query(
          `delete from connectors.kyc_digilocker_pull
            where tenant_id = $1 and adapter = $2 and (key_hash = $3 or consent_hash = $4)
              and expires_at <= now()`,
          [ctx.tenantId, r.adapter, kh, ch],
        );
        const id = newId("kdl");
        const ins = await tx.query<{ id: string }>(
          `insert into connectors.kyc_digilocker_pull
             (id, tenant_id, adapter, key_hash, consent_hash, request_hash, state, expires_at)
           values ($1, $2, $3, $4, $5, $6, 'pending', now() + make_interval(hours => $7))
           on conflict do nothing returning id`,
          [
            id,
            ctx.tenantId,
            r.adapter,
            kh,
            ch,
            requestHash(r),
            this.o.ttlHours ?? DIGILOCKER_PULL_TTL_HOURS,
          ],
        );
        if (ins.rowCount) {
          await this.ledger(tx, "reserve", id, r.adapter, kh, "pending", 0);
          return { kind: "new", id } as DigilockerPullReservation;
        }
        const row = (
          await tx.query<Row>(`${PgDigilockerPullStore.LIVE} for update`, [
            ctx.tenantId,
            r.adapter,
            kh,
          ])
        ).rows[0];
        // Not this key: another key of the tenant holds the session.
        if (!row) {
          await this.ledger(tx, "session_taken", kh, r.adapter, kh, "refused", 0);
          return { kind: "session_taken" } as DigilockerPullReservation;
        }
        const found = PgDigilockerPullStore.map(r, row) as DigilockerPullReservation;
        await this.ledger(
          tx,
          found.kind === "done" ? "replay" : "found",
          row.id,
          r.adapter,
          kh,
          row.state,
          row.documents?.length ?? 0,
        );
        return found;
      },
      { action: "connectors.kyc_digilocker.reserve" },
    );
  }

  async complete(
    r: DigilockerPullRequest,
    id: string,
    documents: DigilockerDocument[],
  ): Promise<DigilockerDocument[]> {
    const ctx = this.ctx(r.tenantId);
    const kh = digilockerKeyHash(r.idempotencyKey);
    const refs = refsOnly(documents);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const up = await tx.query<{ documents: DigilockerDocument[] }>(
          `update connectors.kyc_digilocker_pull set state = 'done', documents = $2::jsonb
            where id = $1 and state = 'pending' returning documents`,
          [id, JSON.stringify(refs)],
        );
        if (up.rowCount) {
          await this.ledger(tx, "complete", id, r.adapter, kh, "done", refs.length);
          return up.rows[0]!.documents;
        }
        // A concurrent retry with the key finished first: its documents are the answer.
        const row = (
          await tx.query<Row>(
            `select id, request_hash, state, documents from connectors.kyc_digilocker_pull where id = $1`,
            [id],
          )
        ).rows[0];
        const docs = row?.state === "done" && row.documents ? row.documents : refs;
        await this.ledger(tx, "replay", id, r.adapter, kh, row?.state ?? "none", docs.length);
        return docs;
      },
      { action: "connectors.kyc_digilocker.complete" },
    );
  }

  async refuse(r: DigilockerPullRequest, id: string): Promise<void> {
    const ctx = this.ctx(r.tenantId);
    const kh = digilockerKeyHash(r.idempotencyKey);
    await this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const up = await tx.query(
          `update connectors.kyc_digilocker_pull set state = 'refused'
            where id = $1 and state = 'pending'`,
          [id],
        );
        await this.ledger(
          tx,
          "refuse",
          id,
          r.adapter,
          kh,
          up.rowCount ? "refused" : "unchanged",
          0,
        );
      },
      { action: "connectors.kyc_digilocker.refuse" },
    );
  }

  /** Delete this tenant's expired records (IPB-10-07); a product's maintenance job calls it. */
  async purgeExpired(tenantId: string): Promise<number> {
    const ctx = this.ctx(tenantId);
    return this.o.kernel.mutate(
      ctx,
      async (tx) => {
        const d = await tx.query(
          `delete from connectors.kyc_digilocker_pull where tenant_id = $1 and expires_at <= now()`,
          [ctx.tenantId],
        );
        await this.o.audit.record(tx, {
          action: "connectors.kyc_digilocker.purge",
          resourceType: "connectors.kyc_digilocker_pull",
          resourceId: ctx.tenantId,
          after: { deleted: d.rowCount ?? 0 },
        });
        return d.rowCount ?? 0;
      },
      { action: "connectors.kyc_digilocker.purge" },
    );
  }

  private async ledger(
    tx: Tx,
    step: string,
    id: string,
    adapter: string,
    kh: string,
    state: string,
    documents: number,
  ): Promise<void> {
    await this.o.audit.record(tx, {
      action: `connectors.kyc_digilocker.${step}`,
      resourceType: "connectors.kyc_digilocker_pull",
      resourceId: id,
      after: { adapter, key_hash: kh, state, documents },
    });
  }
}
