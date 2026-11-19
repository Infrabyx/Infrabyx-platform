// STATEMENT_ANALYSIS reference adapter `platform-statement` (Udofin PR-UDF-048, R1-D-202, ADR-0012):
// an in-platform, deterministic analyser with no vendor and no egress. The repository names no
// statement-analysis vendor and the owner has said no new recurring vendor now (#102), so the
// reference proves the port's plumbing, not a credit analysis (#152): each statement is read from
// STORAGE, checked (REGULATED class, its SHA-256), and recognised by its shape (ReBIT JSON as AA_FIU
// stores it, or a PDF by its signature); the report is a checksum summary (per statement its FI
// type, SHA-256, length and format; method `checksum-summary-v1`) written to the REGULATED class
// under the request's prefix, and holds nothing from a statement's content. A statement in neither
// shape is FAILED `unreadable_input`. It answers at once, so it is never PENDING and takes no
// webhook (`unsupported`). Off behind `int.statement_analysis.platform.enabled` (default false).
import {
  statementAnalysisRefusal,
  statementInputFormat,
  type AdapterDescriptor,
  type PortCall,
  type PortHealth,
  type StatementAnalysis,
  type StatementAnalysisNotification,
  type StatementAnalysisPort,
  type StatementAnalysisRequest,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex, ulid } from "@infrabyx/crypto";
import { analyseKept, keptRecord, type AnalysisRun } from "./common.js";
import { MemoryStatementAnalysisStore, type StatementAnalysisStore } from "./store.js";

const PORT = "STATEMENT_ANALYSIS";
const ADAPTER = "platform-statement";
export const PLATFORM_STATEMENT_METHOD = "checksum-summary-v1";
/** The report's schema name. */
export const PLATFORM_STATEMENT_REPORT_SCHEMA = "ipb.statement-analysis.checksum-summary/1";

export interface PlatformStatementAnalyserOptions {
  storage: StoragePort;
  /** `int.statement_analysis.platform.enabled`, read on every call; off by default. */
  enabled: () => Promise<boolean> | boolean;
  /** The analyses kept (`PgStatementAnalysisStore` in production; in memory by default). */
  store?: StatementAnalysisStore;
  /** The tenancy context's tenant, for a `status` call that names none. */
  tenantId?: () => string | undefined;
  now?: () => Date;
}

export class PlatformStatementAnalyser implements StatementAnalysisPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: { handleWebhook: "unsupported" },
  };
  /** Analyses run (the analyser's calls); a keyed retry never adds one. */
  analyses = 0;
  private readonly store: StatementAnalysisStore;
  private readonly now: () => Date;

  constructor(private readonly o: PlatformStatementAnalyserOptions) {
    this.now = o.now ?? (() => new Date());
    this.store = o.store ?? new MemoryStatementAnalysisStore({ now: this.now });
  }

  private async guard(): Promise<void> {
    if (!(await this.o.enabled()))
      throw statementAnalysisRefusal(
        "IPB-PORT-001",
        ADAPTER,
        "adapter_disabled",
        "the in-platform statement analyser is off (int.statement_analysis.platform.enabled)",
      );
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
    this.analyses++;
    const base = {
      analysisId: r.analysisId,
      adapter: ADAPTER,
      method: PLATFORM_STATEMENT_METHOD,
      vendorRef: r.analysisId,
      checkedAt: this.now().toISOString(),
    };
    const formats = r.inputs.map((i) => statementInputFormat(i.body));
    if (formats.some((f) => f === undefined))
      return { ...base, state: "FAILED", failureReason: "unreadable_input" };
    const body = new TextEncoder().encode(
      JSON.stringify({
        schema: PLATFORM_STATEMENT_REPORT_SCHEMA,
        analysisId: r.analysisId,
        method: PLATFORM_STATEMENT_METHOD,
        statements: r.inputs.map((i, n) => ({
          fiType: i.fiType,
          sha256: i.sha256,
          bytes: i.body.byteLength,
          format: formats[n],
        })),
      }),
    );
    const sha256 = sha256Hex(body);
    const storageKey = `${r.request.reportPrefix}${ulid()}.json`;
    await this.o.storage.put(storageKey, body, {
      bucketClass: "REGULATED",
      contentType: "application/json",
      sha256,
    });
    return { ...base, state: "COMPLETED", report: { storageKey, sha256 } };
  }

  /** The kept answer: the analyser answers at once, so there is nothing to ask again. */
  async status(analysisId: string, call?: PortCall): Promise<StatementAnalysis> {
    await this.guard();
    const { record } = await keptRecord({
      adapter: ADAPTER,
      analysisId,
      call,
      store: this.store,
      ...(this.o.tenantId ? { tenantContext: this.o.tenantId } : {}),
    });
    return record.result;
  }

  /** Never PENDING, so nothing to be notified of. */
  async handleWebhook(): Promise<StatementAnalysisNotification> {
    throw statementAnalysisRefusal(
      "IPB-PORT-001",
      ADAPTER,
      "unsupported",
      `${ADAPTER} answers at once and takes no webhook`,
    );
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else if ((await this.o.storage.health()).status === "down") status = "down";
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
