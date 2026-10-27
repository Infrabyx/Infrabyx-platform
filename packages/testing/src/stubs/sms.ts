// MSG91 Flow API and Gupshup Enterprise SMS stubs (PL2 plan §7), from the vendors' documentation
// as summarised in PL2-D-64. They prove adapter logic only; the sandbox legs (read-only calls
// nightly, one real send a week after DLT registration, D-07) prove the vendors.
import { startStub, type VendorStub } from "./http.js";

export interface StubSms {
  id: string;
  to: string;
  sender: string;
  vars: Record<string, string>;
  text?: string;
  dltTemplateId?: string;
  crqid?: string;
}

export interface Msg91Stub extends VendorStub {
  readonly sent: StubSms[];
  authKey: string;
  /** MSG91 template (flow) ids the account has. */
  flows: Set<string>;
  balance: number;
}

export async function startMsg91Stub(authKey = "stub-msg91-key"): Promise<Msg91Stub> {
  const sent: StubSms[] = [];
  const ref: { s?: Msg91Stub } = {};
  let seq = 0;
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.headers.authkey !== s.authKey)
      return {
        status: 200,
        body: { type: "error", message: "Authentication failure", code: "207" },
      };
    if (r.method === "POST" && r.path === "/api/v5/flow") {
      const b = r.json<{
        template_id?: string;
        sender?: string;
        recipients?: Array<Record<string, string>>;
      }>();
      if (!b.template_id || !s.flows.has(b.template_id))
        return { status: 200, body: { type: "error", message: "Invalid template", code: "211" } };
      const id = `3567${(++seq).toString().padStart(20, "0")}`;
      for (const rec of b.recipients ?? []) {
        const { mobiles, CRQID, ...vars } = rec;
        sent.push({
          id,
          to: mobiles ?? "",
          sender: b.sender ?? "",
          vars,
          ...(CRQID ? { crqid: CRQID } : {}),
        });
      }
      return { status: 200, body: { type: "success", message: id } };
    }
    if (r.method === "GET" && r.path === "/api/balance.php")
      return { status: 200, body: String(s.balance) };
    return { status: 404, body: { type: "error", message: "not found" } };
  });
  const s: Msg91Stub = Object.assign(stub, {
    sent,
    authKey,
    flows: new Set<string>(),
    balance: 10_000,
  });
  ref.s = s;
  return s;
}

export interface GupshupSmsStub extends VendorStub {
  readonly sent: StubSms[];
  userId: string;
  password: string;
  /** DLT template id → approved text with {#var#} placeholders. */
  templates: Map<string, string>;
}

const matches = (template: string, text: string) =>
  new RegExp(
    `^${template
      .split(/\{#var#\}/i)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".{1,30}")}$`,
    "s",
  ).test(text);

export async function startGupshupSmsStub(
  userId = "2000000001",
  password = "stub-gupshup-password",
): Promise<GupshupSmsStub> {
  const sent: StubSms[] = [];
  const ref: { s?: GupshupSmsStub } = {};
  let seq = 0;
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.path !== "/GatewayAPI/rest") return { status: 404, body: "not found" };
    if (r.method === "HEAD") return { status: 200 };
    const f = r.method === "POST" ? r.form() : r.query;
    if (f.get("userid") !== s.userId || f.get("password") !== s.password)
      return {
        status: 200,
        body: "error | 102 | Authentication failed due to invalid userId or password.",
      };
    const tpl = s.templates.get(f.get("dltTemplateId") ?? "");
    const msg = f.get("msg") ?? "";
    if (!tpl || !matches(tpl, msg))
      return { status: 200, body: "error | 038 | MSG_DOES_NOT_MATCH_TEMPLATE" };
    const to = f.get("send_to") ?? "";
    const id = `7280147108632988${(++seq).toString().padStart(2, "0")}-${to.slice(-10)}`;
    sent.push({
      id,
      to,
      sender: f.get("mask") ?? "",
      vars: {},
      text: msg,
      dltTemplateId: f.get("dltTemplateId") ?? "",
    });
    return { status: 200, body: `success | ${to} | ${id}` };
  });
  const s: GupshupSmsStub = Object.assign(stub, {
    sent,
    userId,
    password,
    templates: new Map<string, string>(),
  });
  ref.s = s;
  return s;
}
