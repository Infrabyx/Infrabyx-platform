// Brevo transactional API v3 stub (PL2 plan §7), from Brevo's API definition (official Node SDK,
// generated from it). Field names not yet proven against the live API are [VERIFY] until the
// sandbox leg (`X-Sib-Sandbox: drop`) runs.
import { startStub, stubCredential, type StubReply, type VendorStub } from "./http.js";

export interface BrevoStubMessage {
  messageId: string;
  templateId: number;
  sender: string;
  to: string[];
  params: Record<string, unknown>;
  tags: string[];
  headers: Record<string, string>;
  attachments: Array<{ name: string; bytes: number }>;
  dropped: boolean;
}

export interface BrevoStub extends VendorStub {
  readonly messages: BrevoStubMessage[];
  apiKey: string;
  templates: Set<number>;
  /** Sending domains and whether they are authenticated (DKIM). */
  domains: Map<string, boolean>;
}

const fail = (status: number, code: string, message: string): StubReply => ({
  status,
  body: { code, message },
});

let seq = 0;

export async function startBrevoStub(apiKey = stubCredential()): Promise<BrevoStub> {
  const messages: BrevoStubMessage[] = [];
  const byIdem = new Map<string, string>();
  const ref: { s?: BrevoStub } = {};
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.headers["api-key"] !== s.apiKey) return fail(401, "unauthorized", "Key not found");
    const p = r.path.replace(/^\/v3/, "");
    if (r.method === "POST" && p === "/smtp/email") {
      const b = r.json<{
        sender?: { email?: string };
        to?: Array<{ email: string }>;
        templateId?: number;
        params?: Record<string, unknown>;
        tags?: string[];
        headers?: Record<string, string>;
        attachment?: Array<{ name?: string; content?: string }>;
      }>();
      if (!b.sender?.email || !b.to?.length) return fail(400, "missing_parameter", "sender/to");
      if (b.templateId === undefined || !s.templates.has(b.templateId))
        return fail(400, "invalid_parameter", "Template ID is not valid");
      const idem = b.headers?.idempotencyKey;
      const seen = idem ? byIdem.get(idem) : undefined;
      if (seen) return { status: 201, body: { messageId: seen } };
      const messageId = `<20261027${(++seq).toString().padStart(6, "0")}.stub@smtp-relay.mailin.fr>`;
      if (idem) byIdem.set(idem, messageId);
      messages.push({
        messageId,
        templateId: b.templateId,
        sender: b.sender.email,
        to: b.to.map((x) => x.email),
        params: b.params ?? {},
        tags: b.tags ?? [],
        headers: b.headers ?? {},
        attachments: (b.attachment ?? []).map((a) => ({
          name: a.name ?? "",
          bytes: Buffer.from(a.content ?? "", "base64").byteLength,
        })),
        dropped: b.headers?.["X-Sib-Sandbox"] === "drop",
      });
      return { status: 201, body: { messageId } };
    }
    if (r.method === "GET" && p === "/smtp/statistics/events") {
      const tags = r.query.get("tags");
      const wanted = tags ? (JSON.parse(tags) as string[]) : [];
      const messageId = r.query.get("messageId");
      const events = messages
        .filter((m) => !m.dropped)
        .filter((m) => (messageId ? m.messageId === messageId : true))
        .filter((m) => wanted.every((t) => m.tags.includes(t)))
        .map((m) => ({
          date: "2026-10-27T00:00:00.000+05:30",
          email: m.to[0],
          event: "requests",
          messageId: m.messageId,
          tag: m.tags[0],
        }));
      return { status: 200, body: { events } };
    }
    const dom = /^\/senders\/domains\/([^/]+)$/.exec(p);
    if (r.method === "GET" && dom) {
      const name = decodeURIComponent(dom[1]!);
      const auth = s.domains.get(name);
      if (auth === undefined) return fail(404, "document_not_found", "Domain not found");
      const rec = (host: string, type: string, value: string) => ({
        host_name: host,
        type,
        value,
        status: auth,
      });
      return {
        status: 200,
        body: {
          domain: name,
          verified: auth,
          authenticated: auth,
          dns_records: {
            brevo_code: rec(name, "TXT", "brevo-code:stub"),
            dkim_record: rec(`mail._domainkey.${name}`, "TXT", "k=rsa;p=STUB"),
            dmarc_record: rec(`_dmarc.${name}`, "TXT", "v=DMARC1; p=none"),
          },
        },
      };
    }
    if (r.method === "GET" && p === "/account")
      return { status: 200, body: { email: "ops@example.test", plan: [] } };
    return fail(404, "not_found", `no stub route ${r.method} ${r.path}`);
  });
  const s: BrevoStub = Object.assign(stub, {
    messages,
    apiKey,
    templates: new Set<number>(),
    domains: new Map<string, boolean>(),
  });
  ref.s = s;
  return s;
}
