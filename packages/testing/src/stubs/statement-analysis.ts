// A vendor-neutral statement analyser stub (Udofin PR-UDF-048, R1-D-202), from the shapes the
// `http-statement` adapter documents as stub-shaped [VERIFY]: a bearer key; `POST /v1/analyses`
// (`{ referenceId, documents: [{ fiType, sha256, contentType, content }] }`, de-duplicated on
// `referenceId`) and `GET /v1/analyses/<id>`, answered `{ id, status, method, failure?, report? }`;
// `GET /v1/health`. A document holding `STATEMENT_ANALYSIS_STUB.pendingMarker` stays PROCESSING
// until `complete`; one that is neither a JSON object nor a PDF FAILS `UNREADABLE`. The report is a
// count and the documents' digests, never their content. Proves adapter logic only; test data only.
import { randomBytes, sha256Hex, toHex } from "@infrabyx/crypto";
import { stubCredential, startStub, type StubRequest, type VendorStub } from "./http.js";

export const STATEMENT_ANALYSIS_STUB = {
  pendingMarker: "STUB-STATEMENT:PENDING",
  method: "stub-analyser-2.1",
} as const;

export interface StatementAnalysisStub extends VendorStub {
  apiKey: string;
  /** Test hook: the analyser finishes a PROCESSING analysis. */
  complete(vendorId: string, outcome: "COMPLETED" | "FAILED"): void;
  /** `POST /v1/analyses` requests received (each one an analysis asked for). */
  creates(): StubRequest[];
}

interface Analysis {
  id: string;
  referenceId: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  digests: string[];
  failure?: string;
}

const readable = (b: Buffer): boolean => {
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return true;
  try {
    const v: unknown = JSON.parse(b.toString("utf8"));
    return typeof v === "object" && v !== null && !Array.isArray(v);
  } catch {
    return false;
  }
};

export async function startStatementAnalysisStub(): Promise<StatementAnalysisStub> {
  const apiKey = stubCredential();
  const analyses = new Map<string, Analysis>();
  const byReference = new Map<string, string>();
  const answer = (a: Analysis) => ({
    id: a.id,
    status: a.status,
    method: STATEMENT_ANALYSIS_STUB.method,
    ...(a.failure ? { failure: a.failure } : {}),
    ...(a.status === "COMPLETED"
      ? {
          report: {
            schema: "stub.statement-report/1",
            documents: a.digests.length,
            digests: a.digests,
          },
        }
      : {}),
  });
  const stub = await startStub((r) => {
    if (r.headers.authorization !== `Bearer ${apiKey}`)
      return { status: 401, body: { error: "unauthorized" } };
    if (r.method === "GET" && r.path === "/v1/health") return { status: 200, body: { ok: true } };
    if (r.method === "POST" && r.path === "/v1/analyses") {
      const b = r.json<{
        referenceId?: string;
        documents?: Array<{ fiType?: string; sha256?: string; content?: string }>;
      }>();
      if (typeof b.referenceId !== "string" || !b.documents?.length)
        return { status: 422, body: { error: "referenceId and documents" } };
      if (r.headers["idempotency-key"] !== b.referenceId)
        return { status: 422, body: { error: "idempotency-key" } };
      const known = byReference.get(b.referenceId);
      if (known) return { status: 200, body: answer(analyses.get(known)!) };
      const bodies = b.documents.map((d) => Buffer.from(d.content ?? "", "base64"));
      if (bodies.some((x, i) => sha256Hex(x) !== b.documents![i]!.sha256))
        return { status: 422, body: { error: "a document does not match its sha256" } };
      const a: Analysis = {
        id: `an_${toHex(randomBytes(8))}`,
        referenceId: b.referenceId,
        status: "COMPLETED",
        digests: b.documents.map((d) => d.sha256!),
      };
      if (bodies.some((x) => x.toString("utf8").includes(STATEMENT_ANALYSIS_STUB.pendingMarker)))
        a.status = "PROCESSING";
      else if (!bodies.every(readable)) {
        a.status = "FAILED";
        a.failure = "UNREADABLE";
      }
      analyses.set(a.id, a);
      byReference.set(a.referenceId, a.id);
      return { status: 201, body: answer(a) };
    }
    const m = /^\/v1\/analyses\/([^/]+)$/.exec(r.path);
    if (r.method === "GET" && m) {
      const a = analyses.get(decodeURIComponent(m[1]!));
      return a ? { status: 200, body: answer(a) } : { status: 404, body: { error: "not found" } };
    }
    return { status: 404, body: { error: "no route" } };
  });
  return {
    ...stub,
    apiKey,
    complete(vendorId, outcome) {
      const a = analyses.get(vendorId);
      if (!a || a.status !== "PROCESSING") throw new Error("no processing analysis");
      a.status = outcome;
      if (outcome === "FAILED") a.failure = "UNSUPPORTED_BANK";
    },
    creates: () => stub.requests.filter((q) => q.method === "POST" && q.path === "/v1/analyses"),
  };
}
