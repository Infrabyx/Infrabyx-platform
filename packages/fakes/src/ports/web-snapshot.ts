// Web snapshot fake and contract (PR-LDC-40, R1-D-176; threat model §3.125). Every implementation
// of `WebSnapshotPort` passes the same cases: a page is kept with its hash and opened only as a
// download, another tenant sees nothing, a type off the list and a status other than 200 are
// refused, an infected copy is rejected, altered bytes are refused on open, and an agent is
// refused. Run `defineWebSnapshotContract(name, setup)` against the fake (here) and against
// `PlatformWebSnapshot` on PostgreSQL (`@infrabyx/connectors`).
import { PortError } from "@infrabyx/contracts/errors";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import {
  WebSnapshotRequest,
  WEB_SNAPSHOT_CONTENT_TYPES,
  webSnapshotDownloadHeaders,
  type OpenedWebSnapshot,
  type WebSnapshot,
  type WebSnapshotContentType,
  type WebSnapshotPort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { EICAR } from "./file-scan.js";

/** A page the fixture's egress serves. */
export interface FakeWebPage {
  status?: number;
  contentType: string;
  body: Uint8Array;
}

function hasEicar(b: Uint8Array): boolean {
  const s = new TextDecoder("latin1").decode(b);
  return s.includes(new TextDecoder("latin1").decode(EICAR));
}

/**
 * In-memory `WebSnapshotPort`: serves registered pages only (any other URL is `IPB-SEC-018`), keeps
 * copies per tenant, rejects the EICAR file, and refuses agents. No network, no database.
 */
export class FakeWebSnapshot implements WebSnapshotPort {
  readonly pages = new Map<string, FakeWebPage>();
  readonly copies = new Map<string, { snapshot: WebSnapshot; body: Uint8Array }>();

  serve(url: string, page: FakeWebPage): void {
    this.pages.set(url, page);
  }

  async archive(ctx: KernelContext, input: WebSnapshotRequest): Promise<WebSnapshot> {
    if (ctx.principal.type === "agent")
      throw new PortError("IPB-SEC-004", "EGRESS", { adapter: "fake", meta: { reason: "agent" } });
    const req = WebSnapshotRequest.parse(input);
    const page = this.pages.get(req.url);
    if (!page)
      throw new PortError("IPB-SEC-018", "EGRESS", {
        adapter: "fake",
        meta: { reason: "not_allowed" },
      });
    if ((page.status ?? 200) !== 200)
      throw new PortError("IPB-PORT-002", "EGRESS", {
        adapter: "fake",
        meta: { reason: "status" },
      });
    const type = page.contentType.split(";")[0]!.trim().toLowerCase();
    if (!(WEB_SNAPSHOT_CONTENT_TYPES as readonly string[]).includes(type))
      throw new PortError("IPB-SEC-010", "EGRESS", {
        adapter: "fake",
        meta: { reason: "content_type" },
      });
    const u = ulid();
    const id = `wsn_${u}`;
    const sha256 = sha256Hex(page.body);
    const infected = hasEicar(page.body);
    const now = new Date().toISOString();
    const snapshot: WebSnapshot = {
      id,
      tenantId: ctx.tenantId,
      requestedUrl: req.url,
      finalUrl: req.url,
      redirects: [],
      httpStatus: 200,
      contentType: type as WebSnapshotContentType,
      charset: null,
      contentEncoding: "identity",
      bytes: page.body.byteLength,
      sha256,
      fetchedAt: now,
      file: { storageKey: `${req.outputPrefix}/${u}.bin`, sha256 },
      bucketClass: req.bucketClass,
      compartment: req.compartment ?? null,
      state: infected ? "REJECTED" : "RELEASED",
      scan: {
        verdict: infected ? "INFECTED" : "CLEAN",
        engine: "fake-av 1",
        reason: null,
        threat: infected ? "Eicar-Test-Signature" : null,
        scannedAt: now,
      },
      reference: req.reference ?? null,
      requestedBy: ctx.principal.id,
      retainUntil: req.retainUntil ?? null,
    };
    this.copies.set(id, { snapshot, body: page.body.slice() });
    return snapshot;
  }

  async get(ctx: KernelContext, id: string): Promise<WebSnapshot | null> {
    const c = this.copies.get(id);
    return c && c.snapshot.tenantId === ctx.tenantId ? c.snapshot : null;
  }

  async open(ctx: KernelContext, id: string): Promise<OpenedWebSnapshot> {
    const s = await this.get(ctx, id);
    if (!s) throw new PortError("IPB-STOR-001", "EGRESS", { adapter: "fake" });
    if (s.state === "REJECTED") throw new PortError("IPB-SEC-011", "EGRESS", { adapter: "fake" });
    if (s.state !== "RELEASED")
      throw new PortError("IPB-SEC-015", "EGRESS", {
        adapter: "fake",
        meta: { reason: "quarantined" },
      });
    const body = this.copies.get(id)!.body;
    if (sha256Hex(body) !== s.sha256)
      throw new PortError("IPB-SEC-015", "EGRESS", {
        adapter: "fake",
        meta: { reason: "hash_mismatch" },
      });
    return { snapshot: s, body, headers: webSnapshotDownloadHeaders(s) };
  }

  async rescan(ctx: KernelContext, id: string): Promise<WebSnapshot> {
    const s = await this.get(ctx, id);
    if (!s) throw new PortError("IPB-STOR-001", "EGRESS", { adapter: "fake" });
    return s;
  }

  /** Tests: replace a copy's stored bytes (to prove `open` checks them). */
  corrupt(id: string): void {
    const c = this.copies.get(id);
    if (c) c.body = new TextEncoder().encode("altered");
  }
}
