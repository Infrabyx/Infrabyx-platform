// NeSL Digital Document Execution stub (owner answer #100, R1-D-62), from the request and response
// shapes the `nesl-dde` adapter documents as stub-shaped [VERIFY]: HTTP Basic; `POST
// /dde/v1/documents`, `GET /dde/v1/documents?client_ref=…`, `GET /dde/v1/documents/{id}` and
// `GET /dde/v1/documents/{id}/executed`. Proves adapter logic only; the sandbox leg proves the
// vendor once the owner's NeSL account exists. Test documents only.
import { sha256Hex } from "@infrabyx/crypto";
import { startStub, stubCredential, type VendorStub } from "./http.js";

interface StubDocument {
  dde_id: string;
  client_ref: string;
  status: string;
  document_sha256: string;
  executants: Array<{ ref: string; status: string }>;
}

export interface NeslDdeStub extends VendorStub {
  clientId: string;
  clientSecret: string;
  /** An executant signs at the information utility (Aadhaar eSign there). */
  execute(ddeId: string, partyRef: string): void;
}

let seq = 0;

export async function startNeslDdeStub(): Promise<NeslDdeStub> {
  const ref: { s?: NeslDdeStub } = {};
  const docs = new Map<string, StubDocument>();
  const stub = await startStub((r) => {
    const s = ref.s!;
    const basic = `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`;
    if (r.headers.authorization !== basic) return { status: 401, body: { code: "UNAUTHORIZED" } };
    if (r.path === "/dde/v1/documents") {
      if (r.method === "GET") {
        const want = r.query.get("client_ref");
        return {
          status: 200,
          body: { documents: [...docs.values()].filter((d) => d.client_ref === want) },
        };
      }
      if (r.method === "POST") {
        const b = r.json<{
          client_ref?: string;
          stamp_ref?: string;
          document?: string;
          document_sha256?: string;
          executants?: Array<{ ref?: string; name?: string }>;
        }>();
        const pdf = Buffer.from(b.document ?? "", "base64");
        if (
          !b.client_ref ||
          !b.stamp_ref ||
          pdf.subarray(0, 5).toString("latin1") !== "%PDF-" ||
          sha256Hex(pdf) !== b.document_sha256 ||
          !b.executants?.length ||
          b.executants.some((e) => !e.ref || !e.name)
        )
          return { status: 400, body: { code: "BAD_REQUEST" } };
        const d: StubDocument = {
          dde_id: `DDE${String(++seq).padStart(12, "0")}`,
          client_ref: b.client_ref,
          status: "PENDING_EXECUTION",
          document_sha256: b.document_sha256 as string,
          executants: b.executants.map((e) => ({ ref: e.ref as string, status: "PENDING" })),
        };
        docs.set(d.dde_id, d);
        return { status: 201, body: d };
      }
    }
    const one = /^\/dde\/v1\/documents\/([A-Za-z0-9_-]+)(\/executed)?$/.exec(r.path);
    if (r.method === "GET" && one) {
      const d = docs.get(one[1]!);
      if (!d) return { status: 404, body: { code: "NOT_FOUND" } };
      if (!one[2]) return { status: 200, body: d };
      if (d.status !== "EXECUTED") return { status: 409, body: { code: "NOT_EXECUTED" } };
      return {
        status: 200,
        body: `%PDF-1.7\n% executed ${d.dde_id} ${d.document_sha256}\n%%EOF\n`,
        headers: { "content-type": "application/pdf" },
      };
    }
    return { status: 404, body: { code: "NOT_FOUND" } };
  });
  ref.s = Object.assign(stub, {
    clientId: `nesl-${stubCredential().slice(0, 12)}`,
    clientSecret: stubCredential(),
    execute(ddeId: string, partyRef: string) {
      const d = docs.get(ddeId);
      if (!d) throw new Error("unknown DDE");
      for (const e of d.executants) if (e.ref === partyRef) e.status = "SIGNED";
      d.status = d.executants.every((e) => e.status === "SIGNED")
        ? "EXECUTED"
        : "PENDING_EXECUTION";
    },
  });
  return ref.s;
}
