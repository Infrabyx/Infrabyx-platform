// Digio mandate stub (owner answer #100, R1-D-62), from the request and response shapes the
// `digio-mandate` adapter documents as stub-shaped [VERIFY]: HTTP Basic; `POST
// /v3/client/mandate/create_form`, `GET /v3/client/mandate/{id}`, `GET
// /v3/client/mandate/search?customer_ref_number=…` and `POST /v3/client/mandate/{id}/cancel`. Proves
// adapter logic only; the sandbox leg proves the vendor once the owner's Digio mandate account
// exists. Test accounts only; no money moves.
import { startStub, stubCredential, type VendorStub } from "./http.js";

interface StubMandate {
  id: string;
  state: string;
  umrn: string | null;
  authentication_url: string | null;
  reject_reason: string | null;
  customer_ref_number: string;
  mandate_details: { maximum_amount: string; auth_mode: string; sub_mode?: string };
}

export interface DigioMandateStub extends VendorStub {
  clientId: string;
  clientSecret: string;
  corporateConfigId: string;
  /** The customer authorises and the destination bank registers (a UMRN), or rejects. */
  confirm(mandateId: string, accept?: boolean): void;
  /** Test helper: Digio reports another ceiling than the one registered (P-04). */
  tamperAmount(mandateId: string, rupees: string): void;
  /** Mandates created so far (create calls that reached the stub). */
  readonly created: number;
}

let seq = 0;

export async function startDigioMandateStub(): Promise<DigioMandateStub> {
  const ref: { s?: DigioMandateStub } = {};
  const mandates = new Map<string, StubMandate>();
  let created = 0;
  const stub = await startStub((r) => {
    const s = ref.s!;
    const basic = `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`;
    if (r.headers.authorization !== basic) return { status: 401, body: { code: "UNAUTHORIZED" } };
    if (r.method === "POST" && r.path === "/v3/client/mandate/create_form") {
      const b = r.json<{
        customer_identifier?: string;
        auth_mode?: string;
        sub_mode?: string;
        mandate_type?: string;
        corporate_config_id?: string;
        mandate_data?: Record<string, unknown>;
      }>();
      const d = b.mandate_data ?? {};
      if (
        b.mandate_type !== "create" ||
        b.corporate_config_id !== s.corporateConfigId ||
        !["api", "esign", "upi"].includes(b.auth_mode ?? "") ||
        !b.customer_identifier ||
        typeof d.maximum_amount !== "string" ||
        !/^\d+\.\d{2}$/.test(d.maximum_amount) ||
        typeof d.destination_bank_id !== "string" ||
        !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(d.destination_bank_id) ||
        typeof d.customer_ref_number !== "string"
      )
        return { status: 400, body: { code: "BAD_REQUEST" } };
      created++;
      const id = `ENA${String(++seq).padStart(12, "0")}`;
      const m: StubMandate = {
        id,
        state: "initiated",
        umrn: null,
        authentication_url: `${s.url}/authorise/${id}`,
        reject_reason: null,
        customer_ref_number: d.customer_ref_number,
        mandate_details: {
          maximum_amount: d.maximum_amount,
          auth_mode: b.auth_mode as string,
          ...(b.sub_mode ? { sub_mode: b.sub_mode } : {}),
        },
      };
      mandates.set(id, m);
      return { status: 200, body: m };
    }
    if (r.method === "GET" && r.path === "/v3/client/mandate/search") {
      const want = r.query.get("customer_ref_number");
      return {
        status: 200,
        body: { mandates: [...mandates.values()].filter((m) => m.customer_ref_number === want) },
      };
    }
    const one = /^\/v3\/client\/mandate\/([A-Za-z0-9_-]+)(\/cancel)?$/.exec(r.path);
    if (one) {
      const m = mandates.get(one[1]!);
      if (!m) return { status: 404, body: { code: "NOT_FOUND" } };
      if (r.method === "GET" && !one[2]) return { status: 200, body: m };
      if (r.method === "POST" && one[2]) {
        if (!r.json<{ reason?: string }>().reason)
          return { status: 400, body: { code: "BAD_REQUEST" } };
        m.state = "revoked";
        return { status: 200, body: m };
      }
    }
    return { status: 404, body: { code: "NOT_FOUND" } };
  });
  ref.s = Object.assign(stub, {
    clientId: `ACK${stubCredential().slice(0, 16)}`,
    clientSecret: stubCredential(),
    corporateConfigId: "TSE-stub-config",
    confirm(id: string, accept = true) {
      const m = mandates.get(id);
      if (!m) throw new Error("unknown mandate");
      if (accept) {
        m.state = "register_success";
        m.umrn = `STUB${String(seq).padStart(16, "0")}`;
      } else {
        m.state = "register_failed";
        m.reject_reason = "rejected by the destination bank";
      }
    },
    tamperAmount(id: string, rupees: string) {
      const m = mandates.get(id);
      if (m) m.mandate_details.maximum_amount = rupees;
    },
  }) as DigioMandateStub;
  // A live count (Object.assign would copy a getter's value once).
  Object.defineProperty(ref.s, "created", { get: () => created });
  return ref.s;
}
