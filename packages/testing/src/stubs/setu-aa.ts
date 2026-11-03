// Setu FIU stub (OWNER-QUESTIONS #97, R1-D-61), from the request and response shapes the `setu-aa`
// adapter documents as stub-shaped [VERIFY]: `x-client-id`, `x-client-secret` and
// `x-product-instance-id` headers; `/v2/consents` (create, read, revoke) and `/v2/sessions`
// (create, read with each FIP's accounts and their ReBIT data). Proves adapter logic only; the
// sandbox leg proves the vendor once the owner's Setu sandbox exists. Test data only.
import { randomBytes, toHex } from "@infrabyx/crypto";
import { stubCredential, startStub, type VendorStub } from "./http.js";

export interface SetuAaStub extends VendorStub {
  clientId: string;
  clientSecret: string;
  productInstanceId: string;
  /** A customer handle the stub's AA knows. */
  customerHandle: string;
  /** Test hook: the customer approves the consent at the AA. */
  approve(consentId: string): void;
  /** Test hook: the next data sessions answer PENDING this many times before completing. */
  pendingReads(n: number): void;
}

interface Consent {
  id: string;
  status: string;
  fiTypes: string[];
  dataRange: { from: string; to: string };
  consentDateRange: { startDate: string; endDate: string };
}

/** A random UUID-shaped id, as Setu's ids are. */
const randomUUID = (): string => {
  const h = toHex(randomBytes(16));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const REBIT_TYPE: Record<string, string> = {
  DEPOSIT: "deposit",
  TERM_DEPOSIT: "term-deposit",
  RECURRING_DEPOSIT: "recurring_deposit",
  MUTUAL_FUNDS: "mutualfunds",
  EQUITIES: "equities",
  INSURANCE_POLICIES: "insurance_policies",
  GST_GSTR1_3B: "gstr1_3b",
};

export async function startSetuAaStub(): Promise<SetuAaStub> {
  const ref: { s?: SetuAaStub } = {};
  const consents = new Map<string, Consent>();
  const sessions = new Map<string, { consentId: string; reads: number }>();
  let pending = 0;
  const consentBody = (c: Consent) => ({
    id: c.id,
    status: c.status,
    url: `https://fiu-sandbox.setu.co/consents/webview/${c.id}`,
    detail: {
      fiTypes: c.fiTypes,
      dataRange: c.dataRange,
      consentDateRange: c.consentDateRange,
    },
  });
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (
      r.headers["x-client-id"] !== s.clientId ||
      r.headers["x-client-secret"] !== s.clientSecret ||
      r.headers["x-product-instance-id"] !== s.productInstanceId
    )
      return { status: 401, body: { errorCode: "Unauthorized" } };
    if (r.method === "POST" && r.path === "/v2/consents") {
      const b = r.json<{
        vua?: string;
        fiTypes?: string[];
        fetchType?: string;
        dataRange?: { from: string; to: string };
        consentDateRange?: { startDate: string; endDate: string };
        purpose?: { code?: string };
      }>();
      if (
        !b.vua?.includes("@") ||
        !b.fiTypes?.length ||
        !b.dataRange ||
        !b.consentDateRange ||
        !b.purpose?.code
      )
        return { status: 400, body: { errorCode: "BadRequest" } };
      const c: Consent = {
        id: randomUUID(),
        status: "PENDING",
        fiTypes: b.fiTypes,
        dataRange: b.dataRange,
        consentDateRange: b.consentDateRange,
      };
      consents.set(c.id, c);
      return { status: 201, body: { id: c.id, url: consentBody(c).url, status: c.status } };
    }
    const cm = /^\/v2\/consents\/([^/]+)(\/revoke)?$/.exec(r.path);
    if (cm) {
      const c = consents.get(cm[1]!);
      if (!c) return { status: 404, body: { errorCode: "NotFound" } };
      if (r.method === "GET" && !cm[2]) return { status: 200, body: consentBody(c) };
      if (r.method === "POST" && cm[2]) {
        c.status = "REVOKED";
        return { status: 200, body: { id: c.id, status: c.status } };
      }
    }
    if (r.method === "POST" && r.path === "/v2/sessions") {
      const b = r.json<{ consentId?: string; dataRange?: unknown; format?: string }>();
      const c = consents.get(b.consentId ?? "");
      if (!c || c.status !== "ACTIVE" || !b.dataRange)
        return { status: 400, body: { errorCode: "InvalidConsent" } };
      const id = randomUUID();
      sessions.set(id, { consentId: c.id, reads: pending });
      return { status: 201, body: { id, status: "PENDING" } };
    }
    const sm = /^\/v2\/sessions\/([^/]+)$/.exec(r.path);
    if (r.method === "GET" && sm) {
      const x = sessions.get(sm[1]!);
      if (!x) return { status: 404, body: { errorCode: "NotFound" } };
      if (x.reads > 0) {
        x.reads--;
        return { status: 200, body: { id: sm[1], status: "PENDING", fips: [] } };
      }
      const c = consents.get(x.consentId)!;
      return {
        status: 200,
        body: {
          id: sm[1],
          consentId: c.id,
          status: "COMPLETED",
          fips: [
            {
              fipID: "stub-fip",
              accounts: c.fiTypes.map((f, i) => ({
                linkRefNumber: randomUUID(),
                maskedAccNumber: `XXXXXXXX${String(4321 + i)}`,
                FIstatus: "READY",
                data: {
                  account: {
                    type: REBIT_TYPE[f] ?? f.toLowerCase(),
                    version: "1.1.3",
                    maskedAccNumber: `XXXXXXXX${String(4321 + i)}`,
                    summary: { currentBalance: "1000.00", currency: "INR" },
                  },
                },
              })),
            },
          ],
        },
      };
    }
    return { status: 404, body: { errorCode: "NotFound" } };
  });
  ref.s = Object.assign(stub, {
    clientId: randomUUID(),
    clientSecret: stubCredential(),
    productInstanceId: randomUUID(),
    customerHandle: "asha.rao@setu-stub",
    approve(consentId: string) {
      const c = consents.get(consentId);
      if (!c || c.status !== "PENDING") throw new Error(`no pending consent ${consentId}`);
      c.status = "ACTIVE";
    },
    pendingReads(n: number) {
      pending = n;
    },
  });
  return ref.s;
}
