// IDfy KYC stub (R1-plan M25, owner answer #91), from the request and response shapes the
// `idfy-kyc` adapter documents as stub-shaped [VERIFY]: IDfy's task API (`account-id` and `api-key`
// headers; `POST /v3/tasks/sync/<action>/<type>` with `{ task_id, group_id, data }`, answered with
// `{ request_id, status, result }`). Proves adapter logic only; the sandbox leg proves the vendor
// once the owner's IDfy sandbox exists. Test identities only.
import { aadhaarOtpStub, type AadhaarOtpStubFixtures } from "./aadhaar-otp.js";
import { bankAccountStub, type BankAccountStubFixtures } from "./bank-account.js";
import { stubCredential, startStub, type VendorStub } from "./http.js";

export interface IdfyKycStub extends VendorStub {
  accountId: string;
  apiKey: string;
  /** The PAN the stub knows, and the name on it. */
  pan: { pan: string; name: string; unknownPan: string };
  /** Face images: `a` and `same` are one person, `other` another; frames read as live. */
  faces: { a: Buffer; same: Buffer; other: Buffer };
  frames: Buffer[];
  /** Aadhaar OTP e-KYC test numbers and codes (PR-UDF-041); synthetic, never real. */
  aadhaarOtp: AadhaarOtpStubFixtures;
  /** Expire an Aadhaar OTP transaction now. */
  expireAadhaarOtp(txn: string): void;
  /** The next e-KYC the stub answers carries this full number. */
  ekycWithNumberOnce(n: string): void;
  /** Bank accounts the stub knows (PR-UDF-043); test accounts only. */
  bankAccount: BankAccountStubFixtures;
  /** The pennyless account checks the stub answered. */
  bankAccountChecks(): number;
}

let seq = 0;
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .split(/\s+/)
    .filter(Boolean);

export async function startIdfyKycStub(): Promise<IdfyKycStub> {
  const ref: { s?: IdfyKycStub } = {};
  const otp = aadhaarOtpStub("TXN", () => ++seq);
  const bank = bankAccountStub();
  const stub = await startStub((r) => {
    const s = ref.s!;
    if (r.headers["account-id"] !== s.accountId || r.headers["api-key"] !== s.apiKey)
      return { status: 401, body: { error: "UNAUTHORIZED" } };
    const m = /^\/v3\/tasks\/sync\/([a-z_]+)\/([a-z_]+)$/.exec(r.path);
    if (r.method !== "POST" || !m) return { status: 404, body: { error: "NOT_FOUND" } };
    const b = r.json<{ task_id?: string; group_id?: string; data?: Record<string, string> }>();
    if (!b.task_id || !b.group_id || !b.data)
      return { status: 400, body: { error: "BAD_REQUEST" } };
    const done = (result: Record<string, unknown>) => ({
      status: 200,
      body: {
        request_id: `REQ${String(++seq).padStart(10, "0")}`,
        task_id: b.task_id,
        group_id: b.group_id,
        status: "completed",
        result,
      },
    });
    const img = (k: string) => Buffer.from(b.data?.[k] ?? "", "base64");
    const task = `${m[1]}/${m[2]}`;
    if (task === "verify_with_source/ind_pan") {
      const pan = b.data.id_number ?? "";
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan))
        return { status: 422, body: { error: "INVALID_ID" } };
      if (pan !== s.pan.pan) return done({ source_output: { status: "id_not_found" } });
      const want = tokens(s.pan.name);
      const got = tokens(b.data.full_name ?? "");
      const score = got.filter((t) => want.includes(t)).length / Math.max(want.length, got.length);
      return done({
        source_output: {
          status: "id_found",
          name_match_score: score,
          dob_match: b.data.dob ? b.data.dob === "1990-01-01" : undefined,
          aadhaar_seeding_status: "Y",
        },
      });
    }
    if (task === "compare/face") {
      const one = img("document1");
      const two = img("document2");
      const person = (x: Buffer) => x.equals(s.faces.a) || x.equals(s.faces.same);
      return done({
        match_score: person(one) && person(two) ? 0.94 : 0.18,
        model_version: "face-compare-stub-1",
      });
    }
    if (task === "aadhaar_otp_request/ind_aadhaar") {
      const out = otp.request(b.data.id_type ?? "", b.data.id_number ?? "", b.data.consent ?? "");
      if (!out.ok)
        return {
          status: 422,
          body: { error: out.code.startsWith("INVALID_") ? "INVALID_ID" : out.code },
        };
      return done({ transaction_id: out.txn, otp_valid_till: out.validTill });
    }
    if (task === "aadhaar_otp_verify/ind_aadhaar") {
      const out = otp.verify(b.data.transaction_id ?? "", b.data.otp ?? "");
      if (!out.ok) return { status: 422, body: { error: out.code } };
      return done({
        ekyc_xml: Buffer.from(out.ekycXml).toString("base64"),
        aadhaar_last_4: out.last4,
        signature_status: "valid",
        model_version: "aadhaar-otp-stub-1",
      });
    }
    if (task === "verify_with_source/validate_bank_account") {
      // nf_verification "true" is IDfy's non-financial (pennyless) check [VERIFY].
      if (b.data.nf_verification !== "true")
        return { status: 422, body: { error: "UNSUPPORTED_VERIFICATION" } };
      if (!b.data.bank_account_no || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(b.data.bank_ifsc_code ?? ""))
        return { status: 422, body: { error: "INVALID_ID" } };
      const out = bank.check(b.data.bank_ifsc_code ?? "", b.data.bank_account_no);
      return done(
        out.status === "not_found"
          ? { status: "id_not_found", account_exists: "NO" }
          : {
              status: "id_found",
              account_exists: "YES",
              account_status: out.status === "closed" ? "closed" : "active",
              name_at_bank: out.nameAtBank,
            },
      );
    }
    if (task === "check_photo_liveness/face") {
      const live = s.frames.some((f) => f.equals(img("document1")));
      return done({ liveness_score: live ? 0.91 : 0.3, model_version: "liveness-stub-1" });
    }
    return { status: 404, body: { error: "NOT_FOUND" } };
  });
  ref.s = Object.assign(stub, {
    accountId: `acc-${stubCredential().slice(0, 12)}`,
    apiKey: stubCredential(),
    pan: { pan: "AAAPZ1234C", name: "Asha Rao", unknownPan: "ZZZPZ9999Z" },
    faces: {
      a: Buffer.from("idfy-stub-face-a"),
      same: Buffer.from("idfy-stub-face-a-2"),
      other: Buffer.from("idfy-stub-face-b"),
    },
    frames: [1, 2, 3].map((i) => Buffer.from(`idfy-stub-frame-${i}`)),
    aadhaarOtp: otp.fixtures,
    expireAadhaarOtp: otp.expire,
    ekycWithNumberOnce: otp.embedNumberOnce,
    bankAccount: bank.fixtures,
    bankAccountChecks: bank.checks,
  });
  return ref.s;
}
