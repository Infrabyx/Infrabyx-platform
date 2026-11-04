// TransUnion CIBIL stub (OWNER-QUESTIONS #97, R1-D-61), from the request and response shapes the
// `cibil` adapter documents as stub-shaped [VERIFY]: `member-id` and `api-key` headers;
// `POST /consumer/v4/reports` with `{ memberReference, enquiryType, enquiryPurpose, consumer }`,
// answered `{ requestId, memberReference, status, report? }`; `GET /consumer/v4/reports/<id>`.
// Proves adapter logic only; the sandbox leg proves the vendor once the owner's CIBIL sandbox
// exists. Test identities only.
import { stubCredential, startStub, type VendorStub } from "./http.js";

export interface CibilStub extends VendorStub {
  memberId: string;
  apiKey: string;
  /** Subjects: known, no record, and one whose report the CIC completes later. */
  subjects: {
    known: { pan: string; name: string };
    noHit: { pan: string; name: string };
    pending: { pan: string; name: string };
  };
  /** Test hook: CIBIL finishes a pending report. */
  complete(requestId: string): void;
}

interface Pull {
  requestId: string;
  memberReference: string;
  pan: string;
  status: "COMPLETED" | "PENDING" | "NO_HIT";
}

let seq = 0;
const ddmmyyyy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${d.getUTCFullYear()}`;

export async function startCibilStub(): Promise<CibilStub> {
  const ref: { s?: CibilStub } = {};
  const pulls = new Map<string, Pull>();
  const enquiries = new Map<string, Date[]>();
  const report = (pan: string) => ({
    formatVersion: "CIR-4.0",
    consumer: { ids: [{ type: "PAN", value: pan }] },
    scores: [{ scoreName: "CIBILTUSC3", score: "761" }],
    accounts: [
      {
        memberType: "BANK",
        accountType: "credit_card",
        ownershipIndicator: "1",
        highCreditAmount: "100000",
        currentBalance: "25000",
        amountOverdue: "0",
        // A card reports no instalment (stub-shaped [VERIFY], PR-FBX-35).
        emiAmount: "",
        paymentHistory: "000000000000000000000000000000000000",
        accountStatus: "ACTIVE",
        dateOpened: "01042021",
      },
      {
        memberType: "NBFC",
        accountType: "personal_loan",
        ownershipIndicator: "1",
        highCreditAmount: "500000",
        currentBalance: "0",
        amountOverdue: "0",
        emiAmount: "15000",
        paymentHistory: "000000015000000000000000000000000000",
        accountStatus: "CLOSED",
        dateOpened: "15012022",
        dateClosed: "15012024",
      },
    ],
    enquiries: (enquiries.get(pan) ?? []).map((d) => ({ enquiryDate: ddmmyyyy(d) })),
  });
  const answer = (p: Pull) => ({
    status: 200,
    body: {
      requestId: p.requestId,
      memberReference: p.memberReference,
      status: p.status,
      ...(p.status === "COMPLETED" ? { report: report(p.pan) } : {}),
    },
  });
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.headers["member-id"] !== s.memberId || r.headers["api-key"] !== s.apiKey)
      return { status: 401, body: { error: "UNAUTHORIZED" } };
    if (r.method === "POST" && r.path === "/consumer/v4/reports") {
      const b = r.json<{
        memberReference?: string;
        enquiryType?: string;
        enquiryPurpose?: string;
        consumer?: { name?: string; pan?: string; mobile?: string };
      }>();
      if (
        !b.memberReference ||
        !b.enquiryPurpose ||
        (b.enquiryType !== "SOFT" && b.enquiryType !== "HARD") ||
        !b.consumer?.name ||
        (!b.consumer.pan && !b.consumer.mobile)
      )
        return { status: 400, body: { error: "BAD_REQUEST" } };
      const pan = b.consumer.pan ?? "";
      const known = pan === s.subjects.known.pan || pan === s.subjects.pending.pan;
      if (known && b.enquiryType === "HARD")
        enquiries.set(pan, [...(enquiries.get(pan) ?? []), new Date()]);
      const p: Pull = {
        requestId: `CIR${String(++seq).padStart(12, "0")}`,
        memberReference: b.memberReference,
        pan,
        status: !known ? "NO_HIT" : pan === s.subjects.pending.pan ? "PENDING" : "COMPLETED",
      };
      pulls.set(p.requestId, p);
      return answer(p);
    }
    const m = /^\/consumer\/v4\/reports\/([A-Z0-9]+)$/.exec(r.path);
    if (r.method === "GET" && m) {
      const p = pulls.get(m[1]!);
      return p ? answer(p) : { status: 404, body: { error: "NOT_FOUND" } };
    }
    return { status: 404, body: { error: "NOT_FOUND" } };
  });
  ref.s = Object.assign(stub, {
    memberId: `MBR${stubCredential().slice(0, 8)}`,
    apiKey: stubCredential(),
    subjects: {
      known: { pan: "AAAPZ1234C", name: "Asha Rao" },
      noHit: { pan: "ZZZPZ9999Z", name: "No Record" },
      pending: { pan: "BBBPZ5678D", name: "Ravi Kumar" },
    },
    complete(requestId: string) {
      const p = pulls.get(requestId);
      if (!p || p.status !== "PENDING") throw new Error(`no pending request ${requestId}`);
      p.status = "COMPLETED";
    },
  });
  return ref.s;
}
