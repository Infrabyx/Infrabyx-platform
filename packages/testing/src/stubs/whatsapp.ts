// Gupshup WhatsApp BSP and Meta WhatsApp Cloud API (Graph) stubs (PL2 plan §7), from the
// vendors' documentation as summarised in PL2-D-64. Sandbox legs: the Gupshup sandbox app and the
// Meta test business number with allow-listed recipients only (D-07).
import { startStub, stubCredential, type StubReply, type VendorStub } from "./http.js";

export interface StubWhatsappTemplate {
  id: string;
  name: string;
  category: "UTILITY" | "AUTHENTICATION" | "MARKETING";
  status: string;
  language: string;
}

export interface StubWhatsappMessage {
  id: string;
  to: string;
  kind: "template" | "text";
  template?: string;
  params?: string[];
  text?: string;
}

export interface WhatsappStub extends VendorStub {
  readonly sent: StubWhatsappMessage[];
  readonly media: Array<{ id: string; type: string; bytes: number }>;
  readonly submitted: Array<Record<string, string>>;
  templates: StubWhatsappTemplate[];
  /** The credential this stub accepts (API key or bearer token), random per run. */
  credential: string;
  /** Recipients (msisdn) whose 24 h window is open; others get the vendor's window error. */
  openSessions: Set<string>;
  qualityRating: string;
}

const base = (stub: VendorStub, credential: string) =>
  Object.assign(stub, {
    credential,
    sent: [] as StubWhatsappMessage[],
    media: [] as Array<{ id: string; type: string; bytes: number }>,
    submitted: [] as Array<Record<string, string>>,
    templates: [] as StubWhatsappTemplate[],
    openSessions: new Set<string>(),
    qualityRating: "GREEN",
  });

export async function startGupshupWhatsappStub(apiKey = stubCredential()): Promise<WhatsappStub> {
  const ref: { s?: WhatsappStub } = {};
  let seq = 0;
  const stub = await startStub((r): StubReply => {
    const s = ref.s!;
    if (r.headers.apikey !== apiKey)
      return { status: 401, body: { status: "error", message: "Authentication Failed" } };
    const appT = /^\/wa\/app\/([^/]+)\/template$/.exec(r.path);
    if (appT && r.method === "GET")
      return {
        status: 200,
        body: {
          status: "success",
          templates: s.templates.map((t) => ({
            id: t.id,
            elementName: t.name,
            category: t.category,
            status: t.status,
            languageCode: t.language,
          })),
        },
      };
    if (appT && r.method === "POST") {
      s.submitted.push(Object.fromEntries(r.form()));
      return { status: 200, body: { status: "success" } };
    }
    if (
      r.method === "POST" &&
      (r.path === "/wa/api/v1/template/msg" || r.path === "/wa/api/v1/msg")
    ) {
      const f = r.form();
      const to = f.get("destination") ?? "";
      if (!f.get("source") || !f.get("src.name"))
        return { status: 400, body: { status: "error", message: "Invalid source" } };
      const id = `gs-${(++seq).toString().padStart(8, "0")}`;
      if (r.path.endsWith("/template/msg")) {
        const t = JSON.parse(f.get("template") ?? "{}") as { id?: string; params?: string[] };
        const known = s.templates.find((x) => x.id === t.id);
        if (!known) return { status: 400, body: { status: "error", message: "Invalid template" } };
        s.sent.push({ id, to, kind: "template", template: known.name, params: t.params ?? [] });
      } else {
        const m = JSON.parse(f.get("message") ?? "{}") as { text?: string };
        // Gupshup accepts and reports the window failure later as a failed event (code 470).
        s.sent.push({ id, to, kind: "text", text: m.text ?? "" });
      }
      return { status: 202, body: { status: "submitted", messageId: id } };
    }
    return { status: 404, body: { status: "error", message: "not found" } };
  });
  const s: WhatsappStub = base(stub, apiKey);
  ref.s = s;
  return s;
}

export async function startMetaGraphStub(token = stubCredential()): Promise<WhatsappStub> {
  const ref: { s?: WhatsappStub } = {};
  let seq = 0;
  const graphError = (status: number, code: number, message: string): StubReply => ({
    status,
    body: {
      error: { message: `(#${code}) ${message}`, type: "OAuthException", code, fbtrace_id: "stub" },
    },
  });
  const stub = await startStub((r): StubReply => {
    const s = ref.s!;
    if (r.headers.authorization !== `Bearer ${token}`)
      return graphError(401, 190, "Invalid OAuth access token");
    const path = r.path.replace(/^\/v\d+\.\d+/, "");
    const msg = /^\/([^/]+)\/messages$/.exec(path);
    if (msg && r.method === "POST") {
      const b = r.json<{
        to: string;
        type: string;
        template?: {
          name: string;
          components?: Array<{ type: string; parameters?: Array<{ text?: string }> }>;
        };
        text?: { body: string };
      }>();
      if (b.type === "text" && !s.openSessions.has(b.to))
        return graphError(400, 131047, "Re-engagement message");
      if (b.type === "template" && !s.templates.some((t) => t.name === b.template?.name))
        return graphError(404, 132001, "Template name does not exist in the translation");
      const id = `wamid.STUB${(++seq).toString().padStart(8, "0")}`;
      s.sent.push({
        id,
        to: b.to,
        kind: b.type === "template" ? "template" : "text",
        ...(b.template
          ? {
              template: b.template.name,
              params: (b.template.components?.find((c) => c.type === "body")?.parameters ?? []).map(
                (p) => p.text ?? "",
              ),
            }
          : {}),
        ...(b.text ? { text: b.text.body } : {}),
      });
      return {
        status: 200,
        body: {
          messaging_product: "whatsapp",
          contacts: [{ input: b.to, wa_id: b.to }],
          messages: [{ id }],
        },
      };
    }
    const media = /^\/([^/]+)\/media$/.exec(path);
    if (media && r.method === "POST") {
      const ct = r.headers["content-type"] ?? "";
      if (!ct.startsWith("multipart/form-data")) return graphError(400, 100, "multipart required");
      const text = r.body.toString("latin1");
      if (!/name="messaging_product"\r\n\r\nwhatsapp/.test(text))
        return graphError(400, 100, "messaging_product");
      const id = `media-${++seq}`;
      s.media.push({
        id,
        type: /name="type"\r\n\r\n([^\r]+)/.exec(text)?.[1] ?? "",
        bytes: r.body.byteLength,
      });
      return { status: 200, body: { id } };
    }
    const tpl = /^\/([^/]+)\/message_templates$/.exec(path);
    if (tpl && r.method === "GET") {
      const name = r.query.get("name");
      return {
        status: 200,
        body: {
          data: s.templates
            .filter((t) => !name || t.name === name)
            .map((t) => ({
              id: t.id,
              name: t.name,
              status: t.status,
              category: t.category,
              language: t.language,
            })),
        },
      };
    }
    if (tpl && r.method === "POST") {
      const b = r.json<Record<string, string>>();
      s.submitted.push(b);
      return { status: 200, body: { id: `tpl-${++seq}`, status: "PENDING", category: b.category } };
    }
    const phone = /^\/([^/]+)$/.exec(path);
    if (phone && r.method === "GET")
      return { status: 200, body: { quality_rating: s.qualityRating, id: phone[1] } };
    return graphError(404, 100, "Unknown path");
  });
  const s: WhatsappStub = base(stub, token);
  ref.s = s;
  return s;
}
