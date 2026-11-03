// ESTAMP adapter `nesl-dde` (owner answer #100, R1-D-62; Finbyx PR-FBX-29, R1-D-52): NeSL's Digital
// Document Execution (DDE), the optional `dde*` methods of the ESTAMP port, over the egress client,
// no SDK. India-hosted (IN), REGULATED (executants' names). Off behind `int.estamp.nesl_dde.enabled`
// (default false) and `unproven` until the owner's NeSL account exists. Buying stamp duty is
// money-moving and is not built here (no ESTAMP purchase adapter is approved): `covers` answers
// false, and `quoteDuty`, `purchase`, `attach`, `verify` and `handleWebhook` are `unsupported`. A
// document is registered with the stamp certificate another ESTAMP adapter (or the product's
// physical stamping) procured.
//
// Vendor facts below are STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX ([VERIFY]); each lives in one
// small mapping function so the sandbox can correct it in one place:
// - host `dde.nesl.co.in`; auth: HTTP Basic with client id and secret;
// - register: `POST /dde/v1/documents` with `{ client_ref, stamp_ref, document (base64 PDF),
//   document_sha256, executants: [{ ref, name }] }`, answered `{ dde_id, status, executants }`;
//   `GET /dde/v1/documents?client_ref=…` finds a registration by our reference;
// - status: `GET /dde/v1/documents/{dde_id}` with `status` REGISTERED | PENDING_EXECUTION |
//   EXECUTED | EXPIRED | REJECTED and each executant's `status` SIGNED | PENDING;
// - executed document: `GET /dde/v1/documents/{dde_id}/executed` (a PDF with the IU's record);
// - callback: our C-19 secret as `ipb_token` on the URL; the record is always read back.
import { PortError } from "@infrabyx/contracts/errors";
import {
  DdeRegistration,
  isValidStorageKey,
  type AdapterDescriptor,
  type DdeRecord,
  type DdeState,
  type DocFileRef,
  type EstampPort,
  type PortCall,
  type PortHealth,
  type StoragePort,
  type WebhookRequestMeta,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { checkSharedSecret, parseJson, vendorError, webhookRefused } from "../messaging/common.js";

const ESTAMP = "ESTAMP";
const ADAPTER = "nesl-dde";
const HOST = "dde.nesl.co.in";

const UNSUPPORTED = ["quoteDuty", "purchase", "attach", "verify", "handleWebhook"] as const;

/** Where each registration writes its executed document (the product's durable store). */
export interface DdeRecordStore {
  get(ddeId: string): Promise<{ outputPrefix: string; documentSha256: string } | null>;
  put(ddeId: string, rec: { outputPrefix: string; documentSha256: string }): Promise<void>;
}

export class MemoryDdeRecordStore implements DdeRecordStore {
  private readonly m = new Map<string, { outputPrefix: string; documentSha256: string }>();
  async get(ddeId: string) {
    return this.m.get(ddeId) ?? null;
  }
  async put(ddeId: string, rec: { outputPrefix: string; documentSha256: string }) {
    this.m.set(ddeId, rec);
  }
}

export interface NeslDdeOptions {
  /** `int.estamp.nesl_dde.enabled`, read on every call; off until the owner's NeSL account exists. */
  enabled: () => Promise<boolean> | boolean;
  storage: StoragePort;
  records: DdeRecordStore;
  /** `secrets/<env>/estamp/nesl_dde/client_id` and `client_secret`. */
  clientId: () => Promise<string> | string;
  clientSecret: () => Promise<string> | string;
  /** Our C-19 URL secret for the callback (`ipb_token`), at least 32 random bytes. */
  webhookToken: () => Promise<string> | string;
  /** Tests only: the NeSL DDE stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

interface NeslDocument {
  dde_id?: string;
  client_ref?: string;
  status?: string;
  document_sha256?: string;
  executants?: Array<{ ref?: string; status?: string }>;
}

// ---- stub-shaped mappings (to confirm against the sandbox) -------------------------------------

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: NeSL's document status to the port's. */
export function mapNeslDdeState(status: string | undefined): DdeState {
  switch ((status ?? "").toUpperCase()) {
    case "REGISTERED":
      return "registered";
    case "PENDING_EXECUTION":
    case "PARTIALLY_EXECUTED":
      return "pending_execution";
    case "EXECUTED":
      return "executed";
    case "EXPIRED":
      return "expired";
    case "REJECTED":
      return "rejected";
    default:
      throw vendorError(ESTAMP, ADAPTER, 502, `unknown DDE status ${status ?? "(none)"}`);
  }
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: the executants who have signed, by our reference. */
export function neslExecuted(d: NeslDocument): string[] {
  return (d.executants ?? [])
    .filter((e) => (e.status ?? "").toUpperCase() === "SIGNED" && typeof e.ref === "string")
    .map((e) => e.ref as string);
}

// ------------------------------------------------------------------------------------------------

const refused = (detail: string, reason: string): PortError =>
  new PortError("IPB-PORT-001", ESTAMP, {
    adapter: ADAPTER,
    detail,
    meta: { reason, definite: true },
  });

/** Our reference for a registration, derived from its idempotency key (no personal data). */
const clientRef = (idempotencyKey: string) =>
  `dde${sha256Hex(`ipb/estamp/dde/${idempotencyKey}`).slice(0, 29)}`;

export class NeslDde implements EstampPort {
  readonly descriptor: AdapterDescriptor = {
    port: ESTAMP,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: {
      ddeRegister: "native",
      ddeStatus: "native",
      ddeDownloadExecuted: "native",
      ...Object.fromEntries(UNSUPPORTED.map((m) => [m, "unsupported"])),
    },
  };
  private readonly egress;
  private readonly base: string;

  constructor(private readonly o: NeslDdeOptions) {
    this.base = (o.baseUrl ?? `https://${HOST}`).replace(/\/$/, "");
    this.egress = createEgress({
      port: ESTAMP,
      adapter: ADAPTER,
      allow: [HOST],
      retries: 1,
      maxBytes: 64 * 1024 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw refused(
        "the NeSL DDE adapter is off (int.estamp.nesl_dde.enabled)",
        "adapter_disabled",
      );
  }

  private async headers(accept = "application/json"): Promise<Record<string, string>> {
    const basic = Buffer.from(`${await this.o.clientId()}:${await this.o.clientSecret()}`).toString(
      "base64",
    );
    return { authorization: `Basic ${basic}`, accept, "content-type": "application/json" };
  }

  private record(d: NeslDocument): DdeRecord {
    if (!d.dde_id) throw vendorError(ESTAMP, ADAPTER, 502, "DDE record without its id");
    return {
      ddeId: d.dde_id,
      state: mapNeslDdeState(d.status),
      executed: neslExecuted(d),
      vendorRef: d.dde_id,
      adapter: ADAPTER,
    };
  }

  private async read(ddeId: string): Promise<NeslDocument> {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(ddeId)) throw refused("not a NeSL DDE id", "invalid_request");
    const res = await this.egress(`${this.base}/dde/v1/documents/${encodeURIComponent(ddeId)}`, {
      method: "GET",
      headers: await this.headers(),
    });
    if (res.status === 404) throw refused("unknown DDE", "not_found");
    if (res.status !== 200) throw vendorError(ESTAMP, ADAPTER, res.status, "NeSL DDE status");
    return res.json<NeslDocument>();
  }

  private async findByRef(ref: string): Promise<NeslDocument | null> {
    const res = await this.egress(
      `${this.base}/dde/v1/documents?client_ref=${encodeURIComponent(ref)}`,
      { method: "GET", headers: await this.headers() },
    );
    if (res.status === 404) return null;
    if (res.status !== 200) throw vendorError(ESTAMP, ADAPTER, res.status, "NeSL DDE search");
    const list = res.json<{ documents?: NeslDocument[] }>().documents ?? [];
    if (list.length > 1)
      throw vendorError(ESTAMP, ADAPTER, 502, "two registrations carry one idempotency reference");
    return list[0] ?? null;
  }

  async ddeRegister(
    raw: Parameters<NonNullable<EstampPort["ddeRegister"]>>[0],
    idempotencyKey: string,
    _call?: PortCall,
  ): Promise<DdeRecord> {
    const r = DdeRegistration.parse(raw);
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey ?? ""))
      throw refused("a DDE registration needs an idempotency key", "invalid_request");
    await this.guard();
    const ref = clientRef(idempotencyKey);
    // A retry with the same key finds the first registration; another document under it is refused.
    const prior = await this.findByRef(ref);
    if (prior) {
      if (prior.document_sha256 !== r.document.sha256)
        throw new PortError("IPB-PORT-004", ESTAMP, {
          adapter: ADAPTER,
          detail: "idempotency key reused with a different document",
        });
      const out = this.record(prior);
      // The first call may have ended before it recorded where the executed document goes.
      if (!(await this.o.records.get(out.ddeId)))
        await this.o.records.put(out.ddeId, {
          outputPrefix: r.outputPrefix,
          documentSha256: r.document.sha256,
        });
      return out;
    }
    const o = await this.o.storage.get(r.document.storageKey);
    if (sha256Hex(o.body) !== r.document.sha256)
      throw refused("the stored document does not match its SHA-256", "hash_mismatch");
    if (Buffer.from(o.body.subarray(0, 5)).toString("latin1") !== "%PDF-")
      throw refused("only PDF documents are executed", "invalid_request");
    const res = await this.egress(`${this.base}/dde/v1/documents`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        client_ref: ref,
        stamp_ref: r.certificateId,
        document: Buffer.from(o.body).toString("base64"),
        document_sha256: r.document.sha256,
        executants: r.executants.map((e) => ({ ref: e.partyRef, name: e.name })),
      }),
    });
    if (res.status === 400 || res.status === 422)
      throw refused("NeSL refused the registration", "vendor_rejected");
    if (res.status !== 200 && res.status !== 201)
      throw vendorError(ESTAMP, ADAPTER, res.status, "NeSL DDE register");
    const out = this.record(res.json<NeslDocument>());
    await this.o.records.put(out.ddeId, {
      outputPrefix: r.outputPrefix,
      documentSha256: r.document.sha256,
    });
    return out;
  }

  async ddeStatus(ddeId: string): Promise<DdeRecord> {
    await this.guard();
    return this.record(await this.read(ddeId));
  }

  async ddeDownloadExecuted(ddeId: string): Promise<DocFileRef> {
    await this.guard();
    const rec = await this.o.records.get(ddeId);
    if (!rec) throw refused("no registration of ours has this id", "not_found");
    const d = this.record(await this.read(ddeId));
    if (d.state !== "executed") throw refused(`the document is ${d.state}`, "invalid_state");
    const res = await this.egress(
      `${this.base}/dde/v1/documents/${encodeURIComponent(ddeId)}/executed`,
      { method: "GET", headers: await this.headers("application/pdf") },
    );
    if (res.status !== 200) throw vendorError(ESTAMP, ADAPTER, res.status, "NeSL DDE download");
    if (Buffer.from(res.body.subarray(0, 5)).toString("latin1") !== "%PDF-")
      throw vendorError(ESTAMP, ADAPTER, 502, "the executed document is not a PDF");
    const sha256 = sha256Hex(res.body);
    const storageKey = `${rec.outputPrefix.replace(/\/$/, "")}/${ulid()}.pdf`;
    if (!isValidStorageKey(storageKey))
      throw refused("the output prefix is not a tenant module prefix", "invalid_request");
    await this.o.storage.put(storageKey, res.body, {
      bucketClass: "REGULATED",
      contentType: "application/pdf",
      sha256,
    });
    return { storageKey, sha256 };
  }

  /** NeSL's callback is only a trigger: the record returned is the one read back from NeSL. */
  async handleDdeWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>,
    meta?: WebhookRequestMeta,
  ): Promise<DdeRecord> {
    await this.guard();
    await checkSharedSecret(
      ESTAMP,
      ADAPTER,
      { secret: this.o.webhookToken },
      headers,
      meta?.sourceIp,
      meta?.query,
    );
    const body = parseJson(ESTAMP, ADAPTER, rawBody) as { dde_id?: unknown };
    if (typeof body.dde_id !== "string" || !body.dde_id)
      throw webhookRefused(ESTAMP, ADAPTER, "no DDE id");
    if (!(await this.o.records.get(body.dde_id)))
      throw webhookRefused(ESTAMP, ADAPTER, "unknown DDE");
    return this.record(await this.read(body.dde_id));
  }

  /** No stamp purchase here: nothing is covered. */
  async covers(): Promise<boolean> {
    return false;
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else {
        // An unknown id: 404 proves the credentials and the route; 401/403/5xx are down.
        const res = await this.egress(`${this.base}/dde/v1/documents/ipb-health`, {
          method: "GET",
          headers: await this.headers(),
        });
        if (res.status >= 500 || res.status === 401 || res.status === 403) status = "down";
      }
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }

  private async unsupported(method: string): Promise<never> {
    throw refused(`${ADAPTER} does not provide ${method}`, "unsupported");
  }
  quoteDuty(): Promise<never> {
    return this.unsupported("quoteDuty");
  }
  purchase(): Promise<never> {
    return this.unsupported("purchase");
  }
  attach(): Promise<never> {
    return this.unsupported("attach");
  }
  verify(): Promise<never> {
    return this.unsupported("verify");
  }
  handleWebhook(): Promise<never> {
    return this.unsupported("handleWebhook");
  }
}
