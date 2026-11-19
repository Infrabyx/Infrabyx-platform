// STATEMENT_ANALYSIS fake (Udofin PR-UDF-048, R1-D-202, ADR-0012). In memory and deterministic by
// the statements' bytes: one holding `FAKE_STATEMENT_ANALYSIS.pendingMarker` answers PENDING until
// `settle` (the analyser finishing), one in no format the port reads (`statementInputFormat`) is
// FAILED `unreadable_input`, any other is COMPLETED with a summary report in STORAGE (each input's
// FI type, SHA-256 and length; nothing from the statement). It keeps the port's rules as every
// adapter must: REGULATED only, inputs from the REGULATED class whose bytes match their SHA-256,
// one analysis per idempotency key, and only the state read back from a notification. Its webhook
// is signed with the C-22 profile already approved for regulated messages (`signRegulatedMessage`,
// ES256 under a `LocalKms` development key, a replay store), as the V-CIP hand-off fake is; the
// platform's real adapters refuse `handleWebhook` `unsupported` until a vendor's scheme is approved.
import { PortError } from "@infrabyx/contracts/errors";
import {
  StatementAnalysisRequest,
  assertStatementAnalysisClass,
  statementAnalysisRefusal,
  statementAnalysisResultOnly,
  statementInputFormat,
  storageTenantOf,
  type AdapterDescriptor,
  type PortCall,
  type PortHealth,
  type StatementAnalysis,
  type StatementAnalysisNotification,
  type StatementAnalysisPort,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import {
  LocalKms,
  MemoryReplayStore,
  RegulatedKeyRing,
  canonicalize,
  newId,
  sha256Hex,
  signRegulatedMessage,
  ulid,
  verifyRegulatedMessage,
  type ReplayStore,
} from "@infrabyx/crypto";
import { MemoryStorage } from "../core.js";

const PORT = "STATEMENT_ANALYSIS";
const ADAPTER = "fake-statement-analysis";

export const FAKE_STATEMENT_ANALYSIS = {
  /** A statement holding this text answers PENDING until `settle`. */
  pendingMarker: "FAKE-STATEMENT:PENDING",
  /** The development key that signs the fake's notifications. */
  webhookKid: "local:sign:fake-statement-analysis",
  /** The header carrying a notification's detached JWS. */
  signatureHeader: "x-ipb-signature",
  method: "fake-summary-v1",
} as const;

/** Inputs a STATEMENT_ANALYSIS adapter's contract run needs. */
export interface StatementAnalysisFixtures<
  P extends StatementAnalysisPort = StatementAnalysisPort,
> {
  /** The STORAGE the adapter reads its inputs from and writes its report to. */
  storage: StoragePort;
  /** `tenant/<tenant>/<module>/` where the cases write the statements. */
  inputPrefix: string;
  /** The same tenant's prefix for reports. */
  reportPrefix: string;
  /** A statement the analyser completes. */
  completed(): Uint8Array;
  /** A statement it answers FAILED. */
  failed(): Uint8Array;
  /** A statement it answers PENDING, and how it then finishes; absent for one that always answers at once. */
  pending?: {
    body(): Uint8Array;
    finish(p: P, analysisId: string, outcome: "COMPLETED" | "FAILED"): Promise<void>;
  };
  /** Analyses the analyser has been asked for so far; a keyed retry never adds one. */
  calls(p: P): number;
  /** A signed notification of `analysisId`, for an adapter that takes webhooks. */
  notify?(p: P, analysisId: string): Promise<{ body: Uint8Array; headers: Record<string, string> }>;
}

const enc = (s: string) => new TextEncoder().encode(s);
const devKms = new LocalKms();

/** Signs a notification of `analysisId` as the fake's analyser does. Tests and fixtures only. */
export async function signFakeStatementAnalysisNotification(
  analysisId: string,
  o: { kid?: string; now?: Date; event?: Record<string, unknown> } = {},
): Promise<{ body: Uint8Array; headers: Record<string, string> }> {
  const kid = o.kid ?? FAKE_STATEMENT_ANALYSIS.webhookKid;
  // The notification claims a state; the fake never trusts it (it reads the analysis back).
  const event = o.event ?? { analysisId, state: "COMPLETED" };
  const jws = await signRegulatedMessage({
    event,
    kid,
    sign: (m) => devKms.sign(kid, m, "ecdsa-p256-sha256"),
    ...(o.now ? { now: o.now } : {}),
  });
  return {
    body: enc(JSON.stringify(event)),
    headers: { [FAKE_STATEMENT_ANALYSIS.signatureHeader]: jws },
  };
}

/** A key ring that trusts the fake's development key. Tests and fixtures only. */
export async function fakeStatementAnalysisWebhookKeys(
  kid: string = FAKE_STATEMENT_ANALYSIS.webhookKid,
): Promise<RegulatedKeyRing> {
  return new RegulatedKeyRing([{ kid, key: await devKms.getPublicKey(kid) }]);
}

interface Rec {
  tenantId: string;
  reportPrefix: string;
  inputs: Array<{ fiType: string; sha256: string; bytes: number }>;
  result: StatementAnalysis;
}

export class FakeStatementAnalysis implements StatementAnalysisPort {
  readonly descriptor: AdapterDescriptor = {
    port: PORT,
    adapter: ADAPTER,
    residency: "IN",
    maxDataClass: "REGULATED",
  };
  /** Analyses started (the analyser's calls); a keyed retry never adds one. */
  analyses = 0;
  readonly storage: StoragePort;
  private readonly records = new Map<string, Rec>();
  private readonly keys = new Map<string, { request: string; analysisId: string }>();
  private readonly now: () => Date;
  private readonly webhookKeys: Promise<RegulatedKeyRing>;
  private readonly replay: ReplayStore;

  constructor(
    o: {
      storage?: StoragePort;
      now?: () => Date;
      webhookKeys?: RegulatedKeyRing | Promise<RegulatedKeyRing>;
      replay?: ReplayStore;
    } = {},
  ) {
    this.storage = o.storage ?? new MemoryStorage();
    this.now = o.now ?? (() => new Date());
    this.webhookKeys = Promise.resolve(o.webhookKeys ?? fakeStatementAnalysisWebhookKeys());
    this.replay = o.replay ?? new MemoryReplayStore(() => this.now());
  }

  async health(): Promise<PortHealth> {
    return { status: "up", latency_ms: 0, checked_at: this.now().toISOString() };
  }

  private tenant(prefix: string, call?: PortCall): string {
    const t = storageTenantOf(prefix)!;
    if (call?.tenantId && call.tenantId !== t)
      throw statementAnalysisRefusal(
        "IPB-PORT-001",
        ADAPTER,
        "tenant_mismatch",
        "the statements are another tenant's",
      );
    return t;
  }

  async analyse(raw: StatementAnalysisRequest, call?: PortCall): Promise<StatementAnalysis> {
    const r = StatementAnalysisRequest.parse(raw);
    assertStatementAnalysisClass(ADAPTER, call);
    const tenantId = this.tenant(r.reportPrefix, call);
    const request = sha256Hex(canonicalize(r));
    const keyed = call?.idempotencyKey
      ? `${tenantId}|${sha256Hex(`statement-analysis-key:${call.idempotencyKey}`)}`
      : undefined;
    const prior = keyed ? this.keys.get(keyed) : undefined;
    if (prior) {
      if (prior.request !== request)
        throw new PortError("IPB-PORT-004", PORT, {
          adapter: ADAPTER,
          detail: "idempotency key reused with other statements, subject or report prefix",
          meta: { reason: "idempotency_conflict" },
        });
      return structuredClone(this.records.get(prior.analysisId)!.result);
    }
    const bodies: Uint8Array[] = [];
    for (const i of r.inputs) {
      let obj;
      try {
        obj = await this.storage.get(i.storageKey);
      } catch {
        throw statementAnalysisRefusal(
          "IPB-PORT-001",
          ADAPTER,
          "input_missing",
          "no such statement",
        );
      }
      if (obj.meta.bucketClass !== "REGULATED")
        throw statementAnalysisRefusal(
          "IPB-PORT-003",
          ADAPTER,
          "residency",
          `a statement in the ${obj.meta.bucketClass} class, not REGULATED`,
        );
      if (sha256Hex(obj.body) !== i.sha256)
        throw statementAnalysisRefusal(
          "IPB-PORT-001",
          ADAPTER,
          "hash_mismatch",
          "the stored statement does not match its SHA-256",
        );
      bodies.push(obj.body);
    }
    this.analyses++;
    const analysisId = newId("sta");
    const rec: Rec = {
      tenantId,
      reportPrefix: r.reportPrefix,
      inputs: r.inputs.map((i, n) => ({
        fiType: i.fiType,
        sha256: i.sha256,
        bytes: bodies[n]!.byteLength,
      })),
      result: this.result(analysisId, "PENDING"),
    };
    this.records.set(analysisId, rec);
    if (keyed) this.keys.set(keyed, { request, analysisId });
    const text = bodies.map((b) => new TextDecoder().decode(b));
    if (text.some((t) => t.includes(FAKE_STATEMENT_ANALYSIS.pendingMarker)))
      return structuredClone(rec.result);
    if (bodies.some((b) => statementInputFormat(b) === undefined))
      rec.result = this.result(analysisId, "FAILED");
    else rec.result = await this.complete(analysisId, rec);
    return structuredClone(rec.result);
  }

  private result(
    analysisId: string,
    state: StatementAnalysis["state"],
    report?: StatementAnalysis["report"],
  ): StatementAnalysis {
    return statementAnalysisResultOnly({
      analysisId,
      state,
      ...(report ? { report } : {}),
      ...(state === "FAILED" ? { failureReason: "unreadable_input" as const } : {}),
      adapter: ADAPTER,
      method: FAKE_STATEMENT_ANALYSIS.method,
      vendorRef: `fake-${analysisId.slice(4).toLowerCase()}`,
      checkedAt: this.now().toISOString(),
    });
  }

  private async complete(analysisId: string, rec: Rec): Promise<StatementAnalysis> {
    const body = enc(
      JSON.stringify({ schema: "fake.statement-analysis/1", analysisId, inputs: rec.inputs }),
    );
    const sha256 = sha256Hex(body);
    const storageKey = `${rec.reportPrefix}${ulid()}.json`;
    await this.storage.put(storageKey, body, {
      bucketClass: "REGULATED",
      contentType: "application/json",
      sha256,
    });
    return this.result(analysisId, "COMPLETED", { storageKey, sha256 });
  }

  /** Test hook: the analyser finishes a pending analysis. */
  async settle(analysisId: string, outcome: "COMPLETED" | "FAILED"): Promise<void> {
    const rec = this.records.get(analysisId);
    if (!rec || rec.result.state !== "PENDING") throw new Error("no pending analysis");
    rec.result =
      outcome === "COMPLETED"
        ? await this.complete(analysisId, rec)
        : this.result(analysisId, "FAILED");
  }

  async status(analysisId: string, call?: PortCall): Promise<StatementAnalysis> {
    const rec = this.records.get(analysisId);
    if (!rec || (call?.tenantId && call.tenantId !== rec.tenantId))
      throw statementAnalysisRefusal(
        "IPB-PORT-001",
        ADAPTER,
        "unknown_analysis",
        "no such analysis",
      );
    return structuredClone(rec.result);
  }

  async handleWebhook(
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>> = {},
  ): Promise<StatementAnalysisNotification> {
    const invalid = (detail: string) =>
      new PortError("IPB-API-018", PORT, {
        adapter: ADAPTER,
        detail,
        meta: { reason: "webhook_invalid" },
      });
    let event: unknown;
    try {
      event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
    } catch {
      throw invalid("not JSON");
    }
    if (typeof event !== "object" || event === null || Array.isArray(event))
      throw invalid("not a notification");
    const jws = headers[FAKE_STATEMENT_ANALYSIS.signatureHeader];
    if (!jws) throw invalid("unsigned");
    const v = await verifyRegulatedMessage(event as Record<string, unknown>, jws, {
      keys: await this.webhookKeys,
      replay: this.replay,
      now: this.now(),
    });
    if (!v.ok) throw invalid(`the signature did not verify (${v.reason})`);
    const id = (event as { analysisId?: unknown }).analysisId;
    if (typeof id !== "string") throw invalid("a notification names its analysis");
    // Only the state read back is trusted, never the notification's own claim.
    return { analysisId: id, analysis: await this.status(id) };
  }
}
