// Leegality and Digio stubs (PL3 plan §8), from the vendors' published request and response shapes
// as far as the session 1 spike and later searches could read them; [VERIFY] until the sandbox
// legs. Each stub keeps its documents in memory, lets a test sign, reject or expire an invitation,
// and builds the vendor's webhook. The Leegality webhook `mac` (HMAC-SHA1 of the document id with
// the private salt) is computed with the openssl CLI, because the platform's crypto package only
// verifies it (C-25) and testing never imports node:crypto.
import { execFileSync } from "node:child_process";
import { startStub, stubCredential, type VendorStub } from "./http.js";

const SIGNED_PDF = (id: string) => Buffer.from(`%PDF-1.7\n% signed by stub for ${id}\n%%EOF\n`);

/** HMAC-SHA1 hex with the openssl CLI (test-only; the platform never computes HMAC-SHA1). */
export function opensslHmacSha1(key: string, data: string): string {
  const out = execFileSync("openssl", ["dgst", "-sha1", "-hmac", key, "-r"], { input: data });
  return out.toString("utf8").trim().split(/\s+/)[0] as string;
}

interface LgInvitation {
  name: string;
  email?: string;
  phone?: string;
  signUrl: string;
  signed: boolean;
  rejected: boolean;
  expired: boolean;
  deleted: boolean;
  signedAt?: string;
}

export interface LeegalityStub extends VendorStub {
  authToken: string;
  privateSalt: string;
  readonly documents: Map<
    string,
    { profileId: string; irn?: string; pdf: Buffer; invitations: LgInvitation[]; status: string }
  >;
  sign(documentId: string, index: number): void;
  reject(documentId: string, index: number): void;
  expire(documentId: string): void;
  /** The webhook body Leegality would send, with a correct `mac` unless `mac` is given. */
  webhook(documentId: string, o?: { mac?: string; timestamp?: string }): Buffer;
}

let lgSeq = 0;

export async function startLeegalityStub(): Promise<LeegalityStub> {
  const documents: LeegalityStub["documents"] = new Map();
  const ref: { s?: LeegalityStub } = {};
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.headers["x-auth-token"] !== s.authToken)
      return { status: 401, body: { status: 0, messages: [{ code: "auth.invalid" }] } };
    if (r.method === "POST" && r.path === "/v3.1/sign/request") {
      const b = r.json<{
        profileId?: string;
        file?: { name?: string; file?: string };
        invitees?: Array<{ name: string; email?: string; phone?: string }>;
        irn?: string;
      }>();
      if (!b.profileId || !b.file?.file || !b.invitees?.length)
        return { status: 200, body: { status: 0, messages: [{ code: "request.invalid" }] } };
      const pdf = Buffer.from(b.file.file, "base64");
      if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
        return { status: 200, body: { status: 0, messages: [{ code: "file.invalid" }] } };
      const documentId = `LGDOC${String(++lgSeq).padStart(6, "0")}`;
      const invitations = b.invitees.map((i, n) => ({
        ...i,
        signUrl: `https://sandbox.leegality.com/sign/${documentId}-${n}-${stubCredential().slice(0, 12)}`,
        signed: false,
        rejected: false,
        expired: false,
        deleted: false,
      }));
      documents.set(documentId, {
        profileId: b.profileId,
        ...(b.irn ? { irn: b.irn } : {}),
        pdf,
        invitations,
        status: "SENT",
      });
      return {
        status: 200,
        body: {
          status: 1,
          messages: [],
          data: {
            documentId,
            irn: b.irn ?? null,
            invitations: invitations.map((i) => ({
              name: i.name,
              signUrl: i.signUrl,
              active: true,
            })),
          },
        },
      };
    }
    const docId = r.query.get("documentId") ?? "";
    const d = documents.get(docId);
    if (
      r.method === "GET" &&
      (r.path === "/v3.2/sign/request" || r.path === "/v3.0/document/details")
    ) {
      if (!d)
        return { status: 200, body: { status: 0, messages: [{ code: "document.not.found" }] } };
      const all = d.invitations.filter((i) => !i.deleted);
      const completed = all.length > 0 && all.every((i) => i.signed);
      return {
        status: 200,
        body: {
          status: 1,
          data: {
            documentId: docId,
            status: completed ? "COMPLETED" : d.status,
            invitations: all.map((i) => ({
              name: i.name,
              signUrl: i.signUrl,
              signed: i.signed,
              rejected: i.rejected,
              expired: i.expired,
              ...(i.signedAt ? { signedAt: i.signedAt } : {}),
            })),
            ...(r.path === "/v3.0/document/details" && completed
              ? { files: [{ name: `${docId}.pdf`, file: SIGNED_PDF(docId).toString("base64") }] }
              : {}),
          },
        },
      };
    }
    if (r.method === "DELETE" && r.path === "/v3.0/sign/request/invitation") {
      const url = r.query.get("signUrl") ?? "";
      for (const doc of documents.values()) {
        const inv = doc.invitations.find((i) => i.signUrl === url);
        if (inv && !inv.signed) {
          inv.deleted = true;
          if (doc.invitations.every((i) => i.deleted || i.signed)) doc.status = "CANCELLED";
          return { status: 200, body: { status: 1, messages: [] } };
        }
      }
      return { status: 200, body: { status: 0, messages: [{ code: "invitation.not.exists" }] } };
    }
    return { status: 404, body: { status: 0 } };
  });
  const inv = (id: string, n: number) => {
    const i = documents.get(id)?.invitations[n];
    if (!i) throw new Error(`no invitation ${n} on ${id}`);
    return i;
  };
  ref.s = Object.assign(stub, {
    authToken: stubCredential(),
    privateSalt: stubCredential(),
    documents,
    sign: (id: string, n: number) => {
      const i = inv(id, n);
      i.signed = true;
      i.signedAt = new Date().toISOString();
    },
    reject: (id: string, n: number) => void (inv(id, n).rejected = true),
    expire: (id: string) => {
      const d = documents.get(id);
      if (d) d.status = "EXPIRED";
    },
    webhook: (documentId: string, o: { mac?: string; timestamp?: string } = {}) =>
      Buffer.from(
        JSON.stringify({
          documentId,
          mac: o.mac ?? opensslHmacSha1(ref.s!.privateSalt, documentId),
          webhookType: "Success",
          ...(o.timestamp ? { timestamp: o.timestamp } : {}),
        }),
      ),
  });
  return ref.s;
}

interface DgParty {
  identifier: string;
  name: string;
  sign_type: string;
  status: "requested" | "signed" | "rejected";
  updated_at?: string;
}

export interface DigioStub extends VendorStub {
  clientId: string;
  clientSecret: string;
  readonly documents: Map<
    string,
    { pdf: Buffer; parties: DgParty[]; status: string; sequential: boolean; coordinates?: unknown }
  >;
  sign(documentId: string, index: number): void;
  reject(documentId: string, index: number): void;
  expire(documentId: string): void;
}

let dgSeq = 0;

export async function startDigioStub(): Promise<DigioStub> {
  const documents: DigioStub["documents"] = new Map();
  const ref: { s?: DigioStub } = {};
  const body = (id: string) => {
    const d = documents.get(id)!;
    const done = d.parties.every((p) => p.status === "signed");
    return {
      id,
      agreement_status: done ? "completed" : d.status,
      signing_parties: d.parties.map((p) => ({
        identifier: p.identifier,
        name: p.name,
        status: p.status,
        type: "self",
        signature_type: p.sign_type,
        ...(p.updated_at ? { updated_at: p.updated_at } : {}),
      })),
    };
  };
  const stub = await startStub((r) => {
    const s = ref.s!;
    const want = `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`;
    if (r.headers.authorization !== want) return { status: 401, body: { code: "UNAUTHORIZED" } };
    if (r.method === "POST" && r.path === "/v2/client/document/uploadpdf") {
      const b = r.json<{
        file_data?: string;
        signers?: Array<{ identifier: string; name: string; sign_type: string }>;
        sequential?: boolean;
        sign_coordinates?: unknown;
      }>();
      const pdf = Buffer.from(b.file_data ?? "", "base64");
      if (!b.signers?.length || pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
        return { status: 400, body: { code: "INVALID_REQUEST" } };
      if (b.signers.some((x) => !["aadhaar", "electronic", "dsc"].includes(x.sign_type)))
        return { status: 400, body: { code: "INVALID_SIGN_TYPE" } };
      const id = `DID${String(++dgSeq).padStart(10, "0")}`;
      documents.set(id, {
        pdf,
        parties: b.signers.map((x) => ({ ...x, status: "requested" })),
        status: "requested",
        sequential: b.sequential === true,
        ...(b.sign_coordinates ? { coordinates: b.sign_coordinates } : {}),
      });
      return { status: 200, body: body(id) };
    }
    if (r.method === "GET" && r.path === "/v2/client/document/download") {
      const id = r.query.get("document_id") ?? "";
      const d = documents.get(id);
      if (!d) return { status: 404, body: { code: "NOT_FOUND" } };
      if (!d.parties.every((p) => p.status === "signed"))
        return { status: 400, body: { code: "DOCUMENT_NOT_SIGNED" } };
      return {
        status: 200,
        body: SIGNED_PDF(id).toString("latin1"),
        headers: { "content-type": "application/pdf" },
      };
    }
    const m = /^\/v2\/client\/document\/([^/]+)(\/cancel)?$/.exec(r.path);
    if (m) {
      const d = documents.get(decodeURIComponent(m[1] as string));
      if (!d) return { status: 404, body: { code: "NOT_FOUND" } };
      if (r.method === "POST" && m[2]) {
        d.status = "cancelled";
        return { status: 200, body: body(m[1] as string) };
      }
      if (r.method === "GET" && !m[2]) return { status: 200, body: body(m[1] as string) };
    }
    return { status: 404, body: { code: "NOT_FOUND" } };
  });
  const party = (id: string, n: number) => {
    const p = documents.get(id)?.parties[n];
    if (!p) throw new Error(`no party ${n} on ${id}`);
    return p;
  };
  ref.s = Object.assign(stub, {
    clientId: `ACK${stubCredential().slice(0, 16)}`,
    clientSecret: stubCredential(),
    documents,
    sign: (id: string, n: number) => {
      const p = party(id, n);
      p.status = "signed" as const;
      p.updated_at = new Date().toISOString();
    },
    reject: (id: string, n: number) => void (party(id, n).status = "rejected"),
    expire: (id: string) => {
      const d = documents.get(id);
      if (d) d.status = "expired";
    },
  });
  return ref.s;
}
