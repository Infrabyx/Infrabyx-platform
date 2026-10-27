// The vendor-assurance mirror (IPB-08-01, 08-27…29; Ecosystem §6.34; PL5 plan §7.2). Operations Hub
// is the system of record; this consumer is the only writer of `trust.mirror_*` (PostgreSQL refuses
// any other principal). Per version:
//   ANNOUNCED  `VendorAssuranceDocumentPublished` recorded (once per event id; replay-safe)
//   FETCHED    the TRUST port gave a file URL and digest for it
//   VERIFIED   the digest matches the announced sha256 (and the bytes, when a fetcher is given)
//   VISIBLE    shown to the tenants `visibility` allows, when this product is a publication target;
//              older versions of the same document become SUPERSEDED only now
//   SUPERSEDED a newer version became visible, or OH said so
//   HIDDEN     WITHDRAWN, or the visibility or targets no longer include this product (at once)
// STALE is derived: no contact with OH for 7 days shows "as of" (`staleness()`).
// A digest mismatch leaves the version FETCHED, keeps the previous verified version visible, and
// raises `IPB-TRUST-009` with `MirrorDigestMismatch`. `reconcile()` runs daily: it fills gaps from
// `listDocuments`, then compares the mirror's digest with OH's publication digest (IPB-08-29).
import { IpbError } from "@infrabyx/contracts/errors";
import { PLATFORM_TENANT_ID } from "@infrabyx/contracts/ids";
import type {
  AuditSink,
  KernelContext,
  MutationKernel,
  OutboxWriter,
  Tx,
} from "@infrabyx/contracts/kernel";
import { VadDocument, type TrustPort, type VadState } from "@infrabyx/contracts/ports";
import {
  EcoVendorAssuranceDocumentPublished,
  EcoVendorAssuranceDocumentStateChanged,
  MirrorDigestMismatchData,
  TRUST_EVENTS,
} from "@infrabyx/contracts";
import { internalEvent } from "@infrabyx/config/events";
import { sha256Hex } from "@infrabyx/crypto";

export const TRUST_MIRROR_PRINCIPAL_ID = "svc_trust_mirror";
export const MIRROR_STALE_DAYS = 7;
export const MIRROR_STATES = [
  "ANNOUNCED",
  "FETCHED",
  "VERIFIED",
  "VISIBLE",
  "SUPERSEDED",
  "HIDDEN",
] as const;
export type MirrorState = (typeof MIRROR_STATES)[number];

const mirrorContext: KernelContext = {
  tenantId: PLATFORM_TENANT_ID,
  principal: { id: TRUST_MIRROR_PRINCIPAL_ID, type: "service", roles: [] },
};

export interface MirrorRow {
  vad_id: string;
  version: number;
  title: string;
  category: VadDocument["category"];
  type_key: string | null;
  cadence: VadDocument["cadence"];
  valid_from: string;
  valid_until: string | null;
  storage_ref: string;
  sha256: string;
  visibility: VadDocument["visibility"];
  publication_targets: string[];
  nda_required: boolean;
  summary: string;
  supersedes_vad_id: string | null;
  issuer_name: string | null;
  oh_state: VadState;
  mirror_state: MirrorState;
  digest_mismatch_at: Date | null;
  ended_at: Date | null;
  verified_at: Date | null;
  synced_at: Date;
}

/** The mirror's digest, computed the way OH computes its publication digest. */
export function publicationDigest(
  rows: readonly Pick<MirrorRow, "vad_id" | "version" | "oh_state" | "sha256">[],
): string {
  return sha256Hex(
    rows
      .map((d) => `${d.vad_id}:${d.version}:${d.oh_state}:${d.sha256}`)
      .sort()
      .join("\n"),
  );
}

export class TrustMirror {
  constructor(
    private readonly o: {
      kernel: MutationKernel;
      audit: AuditSink;
      /** This product's code as OH lists it in `publication_targets` (`OH`, `LD`, `FBX`…). */
      product: string;
      trust: TrustPort;
      outbox?: OutboxWriter;
      /** Fetch the file to hash its bytes; without it the port's digest is compared. */
      fetchBytes?: (url: string) => Promise<Uint8Array>;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private targetsUs(targets: readonly string[]): boolean {
    return targets.includes(this.o.product);
  }

  /** `VendorAssuranceDocumentPublished` (once per event id). */
  async onPublished(e: { eventId: string; data: unknown }): Promise<MirrorState | null> {
    const d = EcoVendorAssuranceDocumentPublished.parse(e.data);
    const recorded = await this.announce({ ...d, state: "PUBLISHED" }, e.eventId);
    if (!recorded) return null;
    return this.verify(d.vad_id, d.version);
  }

  /** Record an announced version; false when the event was already processed. */
  private async announce(d: VadDocument, eventId: string): Promise<boolean> {
    return this.o.kernel.mutate(
      mirrorContext,
      async (tx) => {
        if (!(await this.firstTime(tx, eventId))) {
          await this.o.audit.record(tx, {
            action: "trust.mirror.duplicate",
            resourceType: "vad",
            resourceId: d.vad_id,
            after: { event_id: eventId },
          });
          return false;
        }
        const ended = d.state === "PUBLISHED" ? null : this.now();
        await tx.query(
          `insert into trust.mirror_document (vad_id, version, title, category, type_key, cadence, valid_from, valid_until,
             storage_ref, sha256, visibility, publication_targets, nda_required, summary, supersedes_vad_id, issuer_name,
             oh_state, mirror_state, ended_at, source_event_id, announced_at, synced_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'ANNOUNCED', $18, $19, $20, $20)
           on conflict (vad_id, version) do nothing`,
          [
            d.vad_id,
            d.version,
            d.title,
            d.category,
            d.type_key ?? null,
            d.cadence,
            d.valid_from,
            d.valid_until,
            d.storage_ref,
            d.sha256,
            d.visibility,
            d.publication_targets,
            d.nda_required,
            d.summary,
            d.supersedes_vad_id ?? null,
            d.issuer_name ?? null,
            d.state,
            ended,
            eventId,
            this.now(),
          ],
        );
        await this.contact(tx, "event");
        await this.o.audit.record(tx, {
          action: "trust.mirror.announced",
          resourceType: "vad",
          resourceId: d.vad_id,
          after: { version: d.version, sha256: d.sha256, visibility: d.visibility },
        });
        return true;
      },
      { action: "trust.mirror.announced" },
    );
  }

  private async firstTime(tx: Tx, eventId: string): Promise<boolean> {
    const r = await tx.query(
      `insert into trust.inbox (consumer, event_id, tenant_id) values ('trust.mirror', $1, $2)
       on conflict do nothing returning event_id`,
      [eventId, PLATFORM_TENANT_ID],
    );
    return !!r.rowCount;
  }

  private async contact(tx: Tx, kind: "event" | "reconcile" | "fetch"): Promise<void> {
    const now = this.now();
    await tx.query(
      `insert into trust.mirror_sync (product, last_contact_at, last_event_at, last_reconciled_at)
       values ($1, $2, case when $3 = 'event' then $2::timestamptz end, case when $3 = 'reconcile' then $2::timestamptz end)
       on conflict (product) do update set last_contact_at = excluded.last_contact_at,
         last_event_at = coalesce(excluded.last_event_at, trust.mirror_sync.last_event_at),
         last_reconciled_at = coalesce(excluded.last_reconciled_at, trust.mirror_sync.last_reconciled_at)`,
      [this.o.product, now, kind],
    );
  }

  private async row(vadId: string, version: number): Promise<MirrorRow | undefined> {
    return this.o.kernel.read(mirrorContext, async (tx) => {
      const r = await tx.query<MirrorRow>(
        "select * from trust.mirror_document where vad_id = $1 and version = $2",
        [vadId, version],
      );
      return r.rows[0];
    });
  }

  /**
   * FETCHED → VERIFIED → VISIBLE for one announced version. OH unreachable leaves it ANNOUNCED for
   * the next reconcile; a digest mismatch leaves it FETCHED and raises `IPB-TRUST-009`.
   */
  async verify(vadId: string, version: number): Promise<MirrorState> {
    const cur = await this.row(vadId, version);
    if (!cur) throw new IpbError("IPB-TRUST-001", { detail: `${vadId} v${version} not mirrored` });
    if (cur.mirror_state !== "ANNOUNCED" && cur.mirror_state !== "FETCHED") return cur.mirror_state;
    let file: { url: string; sha256: string };
    let actual: string;
    try {
      file = await this.o.trust.fileUrl(vadId);
      actual = this.o.fetchBytes ? sha256Hex(await this.o.fetchBytes(file.url)) : file.sha256;
    } catch {
      return "ANNOUNCED";
    }
    return this.o.kernel.mutate(
      mirrorContext,
      async (tx) => {
        await this.contact(tx, "fetch");
        if (actual !== cur.sha256 || file.sha256 !== cur.sha256) {
          await tx.query(
            `update trust.mirror_document set mirror_state = 'FETCHED', digest_mismatch_at = $3, synced_at = $3
              where vad_id = $1 and version = $2`,
            [vadId, version, this.now()],
          );
          await this.mismatch(tx, cur.sha256, actual, `${vadId}:v${version}`);
          return "FETCHED" as const;
        }
        const show =
          cur.oh_state === "PUBLISHED" &&
          cur.visibility !== "AUDITOR" &&
          this.targetsUs(cur.publication_targets);
        const newer = await tx.query(
          `select 1 from trust.mirror_document where vad_id = $1 and version > $2 and mirror_state = 'VISIBLE'`,
          [vadId, version],
        );
        const state: MirrorState = !show ? "HIDDEN" : newer.rowCount ? "SUPERSEDED" : "VISIBLE";
        await tx.query(
          `update trust.mirror_document set mirror_state = $3, verified_at = $4, synced_at = $4, digest_mismatch_at = null,
             oh_state = case when $3 = 'SUPERSEDED' then 'SUPERSEDED' else oh_state end,
             ended_at = case when $3 = 'SUPERSEDED' then coalesce(ended_at, $4) else ended_at end
            where vad_id = $1 and version = $2`,
          [vadId, version, state, this.now()],
        );
        if (state === "VISIBLE") {
          // Older versions of this document, and the document this one supersedes, step back.
          await tx.query(
            `update trust.mirror_document set mirror_state = 'SUPERSEDED', synced_at = $3,
               oh_state = case when oh_state = 'PUBLISHED' then 'SUPERSEDED' else oh_state end,
               ended_at = coalesce(ended_at, $3)
              where mirror_state in ('VISIBLE', 'ANNOUNCED', 'FETCHED', 'VERIFIED')
                and ((vad_id = $1 and version < $2) or vad_id = $4)`,
            [vadId, version, this.now(), cur.supersedes_vad_id ?? ""],
          );
        }
        await this.o.audit.record(tx, {
          action: "trust.mirror.verified",
          resourceType: "vad",
          resourceId: vadId,
          after: { version, mirror_state: state },
        });
        return state;
      },
      { action: "trust.mirror.verified" },
    );
  }

  private async mismatch(tx: Tx, expected: string, actual: string, what: string): Promise<void> {
    await this.o.audit.record(tx, {
      action: "trust.mirror.digest_mismatch",
      resourceType: "vad",
      resourceId: what,
      after: { code: "IPB-TRUST-009", expected, actual },
    });
    if (this.o.outbox)
      await this.o.outbox.publish(tx, "trust", {
        envelope: internalEvent({
          product: this.o.product,
          event: TRUST_EVENTS.MirrorDigestMismatch,
          tenantId: PLATFORM_TENANT_ID,
          dataclass: "INTERNAL",
          data: MirrorDigestMismatchData.parse({ product: this.o.product, expected, actual }),
        }),
      });
  }

  /**
   * `VendorAssuranceDocumentStateChanged`: SUPERSEDED, EXPIRED, WITHDRAWN, or new visibility and
   * targets. WITHDRAWN or narrowed visibility hides the version in the same transaction.
   */
  async onStateChanged(e: { eventId: string; data: unknown }): Promise<MirrorState | null> {
    const d = EcoVendorAssuranceDocumentStateChanged.parse(e.data);
    return this.o.kernel.mutate(
      mirrorContext,
      async (tx) => {
        if (!(await this.firstTime(tx, e.eventId))) {
          await this.o.audit.record(tx, {
            action: "trust.mirror.duplicate",
            resourceType: "vad",
            resourceId: d.vad_id,
            after: { event_id: e.eventId },
          });
          return null;
        }
        const cur = (
          await tx.query<MirrorRow>(
            "select * from trust.mirror_document where vad_id = $1 and version = $2 for update",
            [d.vad_id, d.version],
          )
        ).rows[0];
        if (!cur) {
          // A state for a version this product never saw: reconcile fetches it.
          await this.o.audit.record(tx, {
            action: "trust.mirror.state_unknown",
            resourceType: "vad",
            resourceId: d.vad_id,
            after: { version: d.version, state: d.state },
          });
          return null;
        }
        const narrowed =
          d.state === "WITHDRAWN" ||
          d.visibility === "AUDITOR" ||
          !this.targetsUs(d.publication_targets);
        // Re-publishing a verified version (the rollback after a withdrawal) shows it again.
        const state: MirrorState = narrowed
          ? "HIDDEN"
          : d.state === "SUPERSEDED"
            ? "SUPERSEDED"
            : d.state === "PUBLISHED" && cur.verified_at && cur.mirror_state !== "VISIBLE"
              ? "VISIBLE"
              : cur.mirror_state;
        const at = new Date(d.changed_at);
        await tx.query(
          `update trust.mirror_document set oh_state = $3, visibility = $4, publication_targets = $5, mirror_state = $6,
             ended_at = case when $3 = 'PUBLISHED' then null else coalesce(ended_at, $7) end, synced_at = $8
            where vad_id = $1 and version = $2`,
          [
            d.vad_id,
            d.version,
            d.state,
            d.visibility,
            d.publication_targets,
            state,
            at,
            this.now(),
          ],
        );
        await this.contact(tx, "event");
        await this.o.audit.record(tx, {
          action: "trust.mirror.state",
          resourceType: "vad",
          resourceId: d.vad_id,
          before: { oh_state: cur.oh_state, mirror_state: cur.mirror_state },
          after: {
            version: d.version,
            oh_state: d.state,
            mirror_state: state,
            reason: d.reason_code ?? null,
          },
        });
        return state;
      },
      { action: "trust.mirror.state" },
    );
  }

  /** Every mirrored version (for the digest and for tests); the mirror is small. */
  async rows(): Promise<MirrorRow[]> {
    return this.o.kernel.read(mirrorContext, async (tx) => {
      const r = await tx.query<MirrorRow>(
        "select * from trust.mirror_document order by vad_id, version",
      );
      return r.rows;
    });
  }

  /**
   * The daily reconciliation (IPB-08-29): announce what the mirror lacks, verify what is pending,
   * then compare digests. Returns `reachable: false` when OH cannot be reached (the mirror goes on
   * serving its last verified state with an "as of" label).
   */
  async reconcile(): Promise<{ reachable: boolean; announced: number; digestOk: boolean | null }> {
    let docs: VadDocument[];
    let ohDigest: string;
    try {
      docs = (await this.o.trust.listDocuments(null)).map((x) => VadDocument.parse(x));
      ohDigest = await this.o.trust.publicationDigest();
    } catch {
      return { reachable: false, announced: 0, digestOk: null };
    }
    const have = new Set((await this.rows()).map((r) => `${r.vad_id}:${r.version}`));
    let announced = 0;
    for (const d of docs.filter((x) => this.targetsUs(x.publication_targets)))
      if (!have.has(`${d.vad_id}:${d.version}`)) {
        await this.announce(d, `reconcile:${d.vad_id}:${d.version}`);
        announced++;
      }
    for (const r of await this.rows())
      if (r.mirror_state === "ANNOUNCED" || r.mirror_state === "FETCHED")
        await this.verify(r.vad_id, r.version);
    const ours = (await this.rows()).filter((r) => this.targetsUs(r.publication_targets));
    const mine = publicationDigest(ours);
    const digestOk = mine === ohDigest;
    await this.o.kernel.mutate(
      mirrorContext,
      async (tx) => {
        await this.contact(tx, "reconcile");
        await tx.query(
          "update trust.mirror_sync set oh_digest = $2, mirror_digest = $3, digest_ok = $4 where product = $1",
          [this.o.product, ohDigest, mine, digestOk],
        );
        if (!digestOk) await this.mismatch(tx, ohDigest, mine, "publication_set");
        else
          await this.o.audit.record(tx, {
            action: "trust.mirror.reconciled",
            resourceType: "vad",
            resourceId: "publication_set",
            after: { digest: mine, announced },
          });
      },
      { action: "trust.mirror.reconciled" },
    );
    return { reachable: true, announced, digestOk };
  }

  /** When OH was last heard from, and whether the mirror is STALE (7 days) or past `staleMinutes`. */
  async staleness(
    staleMinutes = 60,
  ): Promise<{ asOf: string | null; stale: boolean; label: boolean }> {
    const r = await this.o.kernel.read(mirrorContext, async (tx) =>
      tx.query<{ last_contact_at: Date | null }>(
        "select last_contact_at from trust.mirror_sync where product = $1",
        [this.o.product],
      ),
    );
    const at = r.rows[0]?.last_contact_at ?? null;
    const age = at ? this.now().getTime() - at.getTime() : Infinity;
    return {
      asOf: at?.toISOString() ?? null,
      stale: age > MIRROR_STALE_DAYS * 86_400_000,
      label: age > staleMinutes * 60_000,
    };
  }
}
