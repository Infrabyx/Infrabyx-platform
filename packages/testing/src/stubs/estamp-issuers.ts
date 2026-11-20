// E-stamp issuer stubs for the recording adapters (PR-UDF-054, R1-D-245), from the shapes the
// `shcil-estamp` and `digio-estamp` adapters document as stub-shaped [VERIFY]. Each answers a
// read-back of a certificate the regulated entity bought through its own channel; neither has any
// purchase, order or affixing route, so a request to buy reaches nothing. `issue` plays the RE's
// own purchase outside the platform; `cancel` plays the issuer cancelling it. Test data only.
import { startStub, stubCredential, type VendorStub } from "./http.js";

/** A certificate the RE bought, as the stub's hook takes it (duty in paise, issue date in IST). */
export interface StubIssuedStamp {
  certificateNo: string;
  state: string;
  /** `YYYY-MM-DD`, India time. */
  issueDate: string;
  dutyPaise: number;
}

const rupees = (paise: number) =>
  `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
const basicOf = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

export interface ShcilEstampStub extends VendorStub {
  clientId: string;
  clientSecret: string;
  issue(c: StubIssuedStamp): void;
  cancel(certificateNo: string): void;
}

/**
 * SHCIL (stub-shaped [VERIFY]): HTTP Basic; `POST /estamp/v1/certificates/verify` with
 * `{ certificate_no, state_code, issue_date }`, answered `{ certificate_no, state_code, issue_date,
 * stamp_duty_amount (rupees, two decimals), status ACTIVE | LOCKED | CANCELLED, reference_no }` or
 * 404 when SHCIL holds no such certificate.
 */
export async function startShcilEstampStub(): Promise<ShcilEstampStub> {
  const ref: { s?: ShcilEstampStub } = {};
  const certs = new Map<string, StubIssuedStamp & { status: string; reference: string }>();
  let seq = 0;
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.headers.authorization !== basicOf(s.clientId, s.clientSecret))
      return { status: 401, body: { code: "UNAUTHORIZED" } };
    if (r.method === "POST" && r.path === "/estamp/v1/certificates/verify") {
      const b = r.json<{ certificate_no?: string; state_code?: string; issue_date?: string }>();
      if (!b.certificate_no || !/^[A-Z]{2}$/.test(b.state_code ?? "") || !b.issue_date)
        return { status: 400, body: { code: "BAD_REQUEST" } };
      const c = certs.get(b.certificate_no);
      if (!c || c.state !== b.state_code || c.issueDate !== b.issue_date)
        return { status: 404, body: { code: "NOT_FOUND" } };
      return {
        status: 200,
        body: {
          certificate_no: c.certificateNo,
          state_code: c.state,
          issue_date: c.issueDate,
          stamp_duty_amount: rupees(c.dutyPaise),
          status: c.status,
          reference_no: c.reference,
        },
      };
    }
    return { status: 404, body: { code: "NOT_FOUND" } };
  });
  ref.s = Object.assign(stub, {
    clientId: `shcil-${stubCredential().slice(0, 12)}`,
    clientSecret: stubCredential(),
    issue(c: StubIssuedStamp) {
      certs.set(c.certificateNo, {
        ...c,
        status: "ACTIVE",
        reference: `SHCIL-REF-${String(++seq).padStart(8, "0")}`,
      });
    },
    cancel(certificateNo: string) {
      const c = certs.get(certificateNo);
      if (!c) throw new Error("unknown certificate");
      c.status = "CANCELLED";
    },
  });
  return ref.s;
}

export interface DigioEstampStub extends VendorStub {
  clientId: string;
  clientSecret: string;
  /** Plays a stamp Digio issued to the RE from its own inventory; returns Digio's id for it. */
  issue(c: StubIssuedStamp): string;
  cancel(id: string): void;
}

/**
 * Digio e-stamp (stub-shaped [VERIFY]): HTTP Basic; `GET /v2/client/estamp/{id}` answered `{ id,
 * certificate_no, state, amount (rupees), status issued | attached | cancelled, issued_at }`.
 */
export async function startDigioEstampStub(): Promise<DigioEstampStub> {
  const ref: { s?: DigioEstampStub } = {};
  const stamps = new Map<string, StubIssuedStamp & { status: string }>();
  let seq = 0;
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.headers.authorization !== basicOf(s.clientId, s.clientSecret))
      return { status: 401, body: { code: "UNAUTHORIZED" } };
    const one = /^\/v2\/client\/estamp\/([A-Za-z0-9_-]+)$/.exec(r.path);
    if (r.method === "GET" && one) {
      const c = stamps.get(one[1]!);
      if (!c) return { status: 404, body: { code: "NOT_FOUND" } };
      return {
        status: 200,
        body: {
          id: one[1],
          certificate_no: c.certificateNo,
          state: c.state,
          amount: rupees(c.dutyPaise),
          status: c.status,
          // Noon in India on the issue date.
          issued_at: `${c.issueDate}T12:00:00+05:30`,
        },
      };
    }
    return { status: 404, body: { code: "NOT_FOUND" } };
  });
  ref.s = Object.assign(stub, {
    clientId: `digio-${stubCredential().slice(0, 12)}`,
    clientSecret: stubCredential(),
    issue(c: StubIssuedStamp) {
      const id = `EST${String(++seq).padStart(12, "0")}`;
      stamps.set(id, { ...c, status: "issued" });
      return id;
    },
    cancel(id: string) {
      const c = stamps.get(id);
      if (!c) throw new Error("unknown e-stamp");
      c.status = "cancelled";
    },
  });
  return ref.s;
}
