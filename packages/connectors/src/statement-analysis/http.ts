// STATEMENT_ANALYSIS alternative adapter `http-statement` (Udofin PR-UDF-048, R1-D-202, ADR-0012):
// a vendor-neutral HTTP analyser client over the egress client (no SDK; IPB-02-43). No vendor is
// chosen (#152; owner answer #102), so every vendor fact below is STUB-SHAPED, TO CONFIRM AGAINST
// THE CHOSEN VENDOR'S SANDBOX ([VERIFY]), each in one small mapping function:
// - auth: `authorization: Bearer <key>` (SECRETS `secrets/<env>/statement_analysis/http/api_key`);
//   the host is `int.statement_analysis.http.host`, the only one on the egress allow-list, and must
//   be an analyser processing in India (its DPA in the Vendor Assurance Room);
// - create: `POST /v1/analyses` with `{ referenceId, documents: [{ fiType, sha256, contentType,
//   content }] }` (content base64) and an `idempotency-key` header equal to `referenceId` (the
//   platform's analysis id, on which the vendor is expected to de-duplicate a resend), answered
//   `{ id, status: COMPLETED | PROCESSING | QUEUED | FAILED, method?, failure?, report? }`;
// - read: `GET /v1/analyses/<id>`, the same answer;
// - health: `GET /v1/health`.
// The subject reference never leaves the platform. A report is stored as received, in the REGULATED
// class under the request's prefix, with its SHA-256; only the reference is returned. Webhooks: no
// approved scheme fits an unnamed vendor (C-13 names its vendors; Standard Webhooks waits for #150),
// so `handleWebhook` is `unsupported` and a product follows a PENDING analysis with `status`.
// Off behind `int.statement_analysis.http.enabled` (default false) and `unproven`.
import {
  STATEMENT_ANALYSIS_FAILURES,
  statementAnalysisRefusal,
  type AdapterDescriptor,
  type PortCall,
  type PortHealth,
  type StatementAnalysis,
  type StatementAnalysisFailure,
  type StatementAnalysisNotification,
  type StatementAnalysisPort,
  type StatementAnalysisRequest,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";
import { analyseKept, keptRecord, type AnalysisRun, type LoadedStatement } from "./common.js";
import { MemoryStatementAnalysisStore, type StatementAnalysisStore } from "./store.js";

const PORT = "STATEMENT_ANALYSIS";
const ADAPTER = "http-statement";
const HOST =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface HttpStatementAnalyserOptions {
  storage: StoragePort;
  /** `int.statement_analysis.http.enabled`, read on every call; off by default. */
  enabled: () => Promise<boolean> | boolean;
  /** `int.statement_analysis.http.host`, read on every call; empty refuses `adapter_unconfigured`. */
  host: () => Promise<string> | string;
  /** `secrets/<env>/statement_analysis/http/api_key`. */
  apiKey: () => Promise<string> | string;
  store?: StatementAnalysisStore;
  /** The tenancy context's tenant, for a `status` call that names none. */
  tenantId?: () => string | undefined;
  now?: () => Date;
  /** Tests only: the stub's base URL instead of `https://<host>`. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

// ---- stub-shaped mappings (to confirm against the chosen vendor's sandbox) ----------------------

/** STUB-SHAPED [VERIFY]: the create body. The subject reference is never sent. */
export function httpStatementBody(analysisId: string, inputs: readonly LoadedStatement[]) {
  return {
    referenceId: analysisId,
    documents: inputs.map((i) => ({
      fiType: i.fiType,
      sha256: i.sha256,
      contentType: i.contentType,
      content: Buffer.from(i.body).toString("base64"),
    })),
  };
}

/** STUB-SHAPED [VERIFY]: a vendor failure label to the port's. */
export function httpStatementFailure(v: unknown): StatementAnalysisFailure {
  const m: Record<string, StatementAnalysisFailure> = {
    UNREADABLE: "unreadable_input",
    PASSWORD_PROTECTED: "unreadable_input",
    UNSUPPORTED_BANK: "unsupported_input",
    UNSUPPORTED: "unsupported_input",
  };
  const f = typeof v === "string" ? (m[v.toUpperCase()] ?? v.toLowerCase()) : "vendor_failed";
  return (STATEMENT_ANALYSIS_FAILURES as readonly string[]).includes(f)
    ? (f as StatementAnalysisFailure)
    : "vendor_failed";
}

/** STUB-SHAPED [VERIFY]: the vendor's answer, read to what the port keeps. */
export function mapHttpStatement(body: unknown): {
  id: string;
  state: StatementAnalysis["state"];
  method: string;
  failure?: StatementAnalysisFailure;
  report?: unknown;
} {
  const b = body as Record<string, unknown> | undefined;
  if (typeof b?.id !== "string" || b.id.length < 1 || b.id.length > 200)
    throw vendorError(PORT, ADAPTER, 502, "analysis answer without its id");
  const status = typeof b.status === "string" ? b.status.toUpperCase() : "";
  const state =
    status === "COMPLETED"
      ? "COMPLETED"
      : status === "FAILED"
        ? "FAILED"
        : status === "PROCESSING" || status === "QUEUED" || status === "PENDING"
          ? "PENDING"
          : undefined;
  if (!state) throw vendorError(PORT, ADAPTER, 502, "analysis answer without a known status");
  if (state === "COMPLETED" && (typeof b.report !== "object" || b.report === null))
    throw vendorError(PORT, ADAPTER, 502, "a completed analysis without its report");
  const method =
    typeof b.method === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,90}$/.test(b.method)
      ? `http:${b.method}`
      : "http:unknown";
  return {
    id: b.id,
    state,
    method,
    ...(state === "FAILED" ? { failure: httpStatementFailure(b.failure) } : {}),
    ...(state === "COMPLETED" ? { report: b.report } : {}),
  };
}

export class HttpStatementAnalyser implements StatementAnalysisPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: { handleWebhook: "unsupported" },
  };
  private readonly store: StatementAnalysisStore;
  private readonly now: () => Date;
  private readonly egress = new Map<string, ReturnType<typeof createEgress>>();

  constructor(private readonly o: HttpStatementAnalyserOptions) {
    this.now = o.now ?? (() => new Date());
    this.store = o.store ?? new MemoryStatementAnalysisStore({ now: this.now });
  }

  private async target(): Promise<{ base: string; egress: ReturnType<typeof createEgress> }> {
    const host = String(await this.o.host())
      .trim()
      .toLowerCase();
    if (!HOST.test(host))
      throw statementAnalysisRefusal(
        "IPB-PORT-001",
        ADAPTER,
        "adapter_unconfigured",
        "no analyser host (int.statement_analysis.http.host)",
      );
    let egress = this.egress.get(host);
    if (!egress) {
      egress = createEgress({
        port: PORT,
        adapter: ADAPTER,
        allow: [host],
        retries: 1,
        timeoutMs: 30_000,
        maxBytes: 16 * 1024 * 1024,
        ...(this.o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
      });
      this.egress.set(host, egress);
    }
    return { base: (this.o.baseUrl ?? `https://${host}`).replace(/\/$/, ""), egress };
  }

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw statementAnalysisRefusal(
        "IPB-PORT-001",
        ADAPTER,
        "adapter_disabled",
        "the HTTP statement analyser is off (int.statement_analysis.http.enabled)",
      );
    await this.target();
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      authorization: `Bearer ${await this.o.apiKey()}`,
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  async analyse(raw: StatementAnalysisRequest, call?: PortCall): Promise<StatementAnalysis> {
    return analyseKept({
      adapter: ADAPTER,
      raw,
      call,
      storage: this.o.storage,
      store: this.store,
      ...(this.o.tenantId ? { tenantContext: this.o.tenantId } : {}),
      guard: () => this.guard(),
      run: (r) => this.run(r),
    });
  }

  private async run(r: AnalysisRun): Promise<StatementAnalysis> {
    const { base, egress } = await this.target();
    const res = await egress(`${base}/v1/analyses`, {
      method: "POST",
      headers: { ...(await this.headers()), "idempotency-key": r.analysisId },
      body: JSON.stringify(httpStatementBody(r.analysisId, r.inputs)),
    });
    if (res.status !== 200 && res.status !== 201 && res.status !== 202)
      throw vendorError(PORT, ADAPTER, res.status, "analysis create");
    return this.answer(r.analysisId, r.request.reportPrefix, mapHttpStatement(res.json()));
  }

  /** The port's answer; a completed analysis's report goes to STORAGE first. */
  private async answer(
    analysisId: string,
    reportPrefix: string,
    v: ReturnType<typeof mapHttpStatement>,
  ): Promise<StatementAnalysis> {
    const base = {
      analysisId,
      adapter: ADAPTER,
      method: v.method,
      vendorRef: v.id,
      checkedAt: this.now().toISOString(),
    };
    if (v.state === "PENDING") return { ...base, state: "PENDING" };
    if (v.state === "FAILED")
      return { ...base, state: "FAILED", failureReason: v.failure ?? "vendor_failed" };
    const body = new TextEncoder().encode(JSON.stringify(v.report));
    const sha256 = sha256Hex(body);
    const storageKey = `${reportPrefix}${ulid()}.json`;
    await this.o.storage.put(storageKey, body, {
      bucketClass: "REGULATED",
      contentType: "application/json",
      sha256,
    });
    return { ...base, state: "COMPLETED", report: { storageKey, sha256 } };
  }

  /** A final answer from the record; a PENDING one is read from the analyser and kept. */
  async status(analysisId: string, call?: PortCall): Promise<StatementAnalysis> {
    await this.guard();
    const { tenantId, record } = await keptRecord({
      adapter: ADAPTER,
      analysisId,
      call,
      store: this.store,
      ...(this.o.tenantId ? { tenantContext: this.o.tenantId } : {}),
    });
    if (record.result.state !== "PENDING") return record.result;
    const { base, egress } = await this.target();
    const res = await egress(`${base}/v1/analyses/${encodeURIComponent(record.result.vendorRef)}`, {
      headers: await this.headers(),
    });
    if (res.status !== 200) throw vendorError(PORT, ADAPTER, res.status, "analysis read");
    const v = mapHttpStatement(res.json());
    if (v.id !== record.result.vendorRef)
      throw vendorError(PORT, ADAPTER, 502, "the analyser answered another analysis");
    if (v.state === "PENDING") return record.result;
    return this.store.record(
      tenantId,
      ADAPTER,
      analysisId,
      await this.answer(analysisId, record.reportPrefix, v),
    );
  }

  /** No approved webhook scheme fits an unnamed vendor yet (#150, #152). */
  async handleWebhook(): Promise<StatementAnalysisNotification> {
    throw statementAnalysisRefusal(
      "IPB-PORT-001",
      ADAPTER,
      "unsupported",
      `${ADAPTER} takes no webhook until its vendor's scheme is approved; poll status`,
    );
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else {
        const { base, egress } = await this.target();
        const res = await egress(`${base}/v1/health`, { headers: await this.headers() });
        if (res.status !== 200) status = "down";
      }
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: this.now().toISOString(),
    };
  }
}
