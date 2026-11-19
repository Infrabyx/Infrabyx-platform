// What the STATEMENT_ANALYSIS adapters share (PR-UDF-048, R1-D-202; threat model §3.144): the order
// every `analyse` keeps (parse; the class, REGULATED only; the adapter's flag and configuration; the
// tenant; each input read from STORAGE, in the REGULATED class and matching its SHA-256; the store's
// record and key; the analyser; the answer kept) and the `status` read of a kept record. Every
// refusal before the analyser is definite: nothing was sent.
import {
  StatementAnalysisRequest,
  assertStatementAnalysisClass,
  statementAnalysisRefusal,
  storageTenantOf,
  type PortCall,
  type StatementAnalysis,
  type StatementAnalysisInput,
  type StoragePort,
} from "@infrabyx/contracts/ports";
import { sha256Hex } from "@infrabyx/crypto";
import type { StatementAnalysisRecord, StatementAnalysisStore } from "./store.js";

/** A statement read from STORAGE and checked. */
export interface LoadedStatement extends StatementAnalysisInput {
  body: Uint8Array;
  contentType: string;
}

export interface AnalysisRun {
  analysisId: string;
  tenantId: string;
  request: ReturnType<typeof StatementAnalysisRequest.parse>;
  inputs: LoadedStatement[];
}

/** The tenant of a call: the report prefix's, which the call and the tenancy context must agree with. */
export function analysisTenant(
  adapter: string,
  prefix: string,
  call: PortCall | undefined,
  context: (() => string | undefined) | undefined,
): string {
  const t = storageTenantOf(prefix)!;
  for (const other of [call?.tenantId, context?.()])
    if (other !== undefined && other !== t)
      throw statementAnalysisRefusal(
        "IPB-PORT-001",
        adapter,
        "tenant_mismatch",
        "the statements are another tenant's",
      );
  return t;
}

/** Each input from STORAGE: present, in the REGULATED class, and matching its SHA-256. */
export async function loadStatements(
  adapter: string,
  storage: StoragePort,
  inputs: readonly StatementAnalysisInput[],
): Promise<LoadedStatement[]> {
  const out: LoadedStatement[] = [];
  for (const i of inputs) {
    let obj;
    try {
      obj = await storage.get(i.storageKey);
    } catch (e) {
      if ((e as { code?: string }).code === "IPB-STOR-001")
        throw statementAnalysisRefusal(
          "IPB-PORT-001",
          adapter,
          "input_missing",
          "no such statement",
        );
      throw e;
    }
    if (obj.meta.bucketClass !== "REGULATED")
      throw statementAnalysisRefusal(
        "IPB-PORT-003",
        adapter,
        "residency",
        `a statement in the ${obj.meta.bucketClass} class, not REGULATED`,
      );
    if (sha256Hex(obj.body) !== i.sha256)
      throw statementAnalysisRefusal(
        "IPB-PORT-001",
        adapter,
        "hash_mismatch",
        "the stored statement does not match its SHA-256",
      );
    out.push({
      fiType: i.fiType,
      storageKey: i.storageKey,
      sha256: i.sha256,
      body: obj.body,
      contentType: obj.meta.contentType ?? "application/octet-stream",
    });
  }
  return out;
}

/** The `analyse` flow both adapters run around their own analyser. */
export async function analyseKept(o: {
  adapter: string;
  raw: unknown;
  call: PortCall | undefined;
  storage: StoragePort;
  store: StatementAnalysisStore;
  tenantContext?: () => string | undefined;
  /** The adapter's flag and configuration; throws when it may not run. */
  guard: () => Promise<void>;
  /** The analyser. A keyed retry of a call that left no answer runs it again with the same id. */
  run: (r: AnalysisRun) => Promise<StatementAnalysis>;
}): Promise<StatementAnalysis> {
  const request = StatementAnalysisRequest.parse(o.raw);
  assertStatementAnalysisClass(o.adapter, o.call);
  await o.guard();
  const tenantId = analysisTenant(o.adapter, request.reportPrefix, o.call, o.tenantContext);
  const inputs = await loadStatements(o.adapter, o.storage, request.inputs);
  const res = await o.store.reserve({
    tenantId,
    adapter: o.adapter,
    ...(o.call?.idempotencyKey ? { idempotencyKey: o.call.idempotencyKey } : {}),
    request,
  });
  if (res.kind === "answered") return res.result;
  const result = await o.run({ analysisId: res.analysisId, tenantId, request, inputs });
  return o.store.record(tenantId, o.adapter, res.analysisId, result);
}

/** The tenant's kept record for `status`, or `unknown_analysis`. */
export async function keptRecord(o: {
  adapter: string;
  analysisId: string;
  call: PortCall | undefined;
  store: StatementAnalysisStore;
  tenantContext?: () => string | undefined;
}): Promise<{ tenantId: string; record: StatementAnalysisRecord & { result: StatementAnalysis } }> {
  const unknown = () =>
    statementAnalysisRefusal("IPB-PORT-001", o.adapter, "unknown_analysis", "no such analysis");
  const tenantId = o.call?.tenantId ?? o.tenantContext?.();
  if (!tenantId || !/^sta_[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(o.analysisId)) throw unknown();
  const record = await o.store.get(tenantId, o.adapter, o.analysisId);
  // A record with no answer is a call that failed before one: its caller saw that error.
  if (!record?.result) throw unknown();
  return { tenantId, record: record as StatementAnalysisRecord & { result: StatementAnalysis } };
}
