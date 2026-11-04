// NeSL Digital Document Execution stub (owner answer #100, R1-D-62), from the request and response
// shapes the `nesl-dde` adapter documents as stub-shaped [VERIFY]: HTTP Basic; `POST
// /dde/v1/documents`, `GET /dde/v1/documents?client_ref=…`, `GET /dde/v1/documents/{id}` and
// `GET /dde/v1/documents/{id}/executed`. A registration names its `stamp_ref`, or is
// `non_stampable` with a `reason_code` (NOT_AN_INSTRUMENT, ACKNOWLEDGEMENT, OTHERS with `remarks`);
// each signed executant carries `signed_at`, `sign_mode`, `esp_txn_id` and `ip_address` (PR-FBX-35,
// R1-D-84; all stub-shaped [VERIFY]). Proves adapter logic only; the sandbox leg proves the vendor
// once the owner's NeSL account exists. Test documents only.
import { sha256Hex } from "@infrabyx/crypto";
import { startStub, stubCredential, type VendorStub } from "./http.js";

interface StubExecutant {
  ref: string;
  status: string;
  signed_at?: string;
  sign_mode?: string;
  esp_txn_id?: string;
  ip_address?: string;
}

interface StubDocument {
  dde_id: string;
  client_ref: string;
  status: string;
  document_sha256: string;
  stamp_ref?: string;
  non_stampable?: { reason_code: string };
  executants: StubExecutant[];
}

const NON_STAMPABLE_CODES = ["NOT_AN_INSTRUMENT", "ACKNOWLEDGEMENT", "OTHERS"];

export interface NeslDdeStub extends VendorStub {
  clientId: string;
  clientSecret: string;
  /**
   * An executant signs at the information utility (Aadhaar OTP eSign there). `evidence` overrides
   * the signing evidence NeSL records (`signed_at`, `sign_mode`, `esp_txn_id`, `ip_address`); a
   * `null` value leaves that field out.
   */
  execute(ddeId: string, partyRef: string, evidence?: Record<string, string | null>): void;
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
          non_stampable?: { reason_code?: string; remarks?: string };
          document?: string;
          document_sha256?: string;
          executants?: Array<{ ref?: string; name?: string }>;
        }>();
        const pdf = Buffer.from(b.document ?? "", "base64");
        const ns = b.non_stampable;
        // Exactly one of a stamp reference or a non-stampable declaration (OTHERS with remarks).
        const stamping = b.stamp_ref
          ? ns === undefined
          : ns !== undefined &&
            NON_STAMPABLE_CODES.includes(ns.reason_code ?? "") &&
            (ns.reason_code !== "OTHERS" || !!ns.remarks);
        if (
          !b.client_ref ||
          !stamping ||
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
          ...(b.stamp_ref
            ? { stamp_ref: b.stamp_ref }
            : { non_stampable: { reason_code: ns!.reason_code as string } }),
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
    execute(ddeId: string, partyRef: string, evidence: Record<string, string | null> = {}) {
      const d = docs.get(ddeId);
      if (!d) throw new Error("unknown DDE");
      for (const e of d.executants)
        if (e.ref === partyRef && e.status !== "SIGNED") {
          const n = d.executants.indexOf(e) + 1;
          const ev: Record<string, string | null> = {
            signed_at: new Date().toISOString(),
            sign_mode: "AADHAAR_OTP",
            esp_txn_id: `ESP-${d.dde_id}-${n}`,
            // Documentation range (RFC 5737): test addresses only.
            ip_address: `203.0.113.${n}`,
            ...evidence,
          };
          for (const [k, v] of Object.entries(ev)) if (v !== null) Object.assign(e, { [k]: v });
          e.status = "SIGNED";
        }
      d.status = d.executants.every((e) => e.status === "SIGNED")
        ? "EXECUTED"
        : "PENDING_EXECUTION";
    },
  });
  return ref.s;
}
