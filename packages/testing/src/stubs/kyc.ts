// Digio KYC stub (R1-plan M16), from the request and response shapes the adapter documents as
// [VERIFY]. Proves adapter logic only; the sandbox leg proves the vendor once the owner's Digio
// account exists. Test identities only: the masked number is the stub's own, never a real one.
import { aadhaarOtpStub, type AadhaarOtpStubFixtures } from "./aadhaar-otp.js";
import { stubCredential, startStub, type VendorStub } from "./http.js";

export interface DigioKycStub extends VendorStub {
  clientId: string;
  clientSecret: string;
  /** The share code that opens the stub's offline e-KYC file. */
  shareCode: string;
  /** The offline e-KYC zip the stub accepts (bytes only; not a real UIDAI file). */
  offlineZip: Buffer;
  /** A KYC request whose DigiLocker step the customer completed, with these documents. */
  completedDigilocker(docTypes: string[]): string;
  /** A KYC request still waiting for the customer. */
  pendingDigilocker(): string;
  /** The template name the stub's DigiLocker start accepts (PR-UDF-040). */
  digilockerTemplate: string;
  /** The customer completes a started request's DigiLocker step with these documents. */
  completeDigilocker(requestId: string, docTypes: string[]): void;
  /** Aadhaar OTP e-KYC test numbers and codes (PR-UDF-041); synthetic, never real. */
  aadhaarOtp: AadhaarOtpStubFixtures;
  /** Expire an Aadhaar OTP transaction now. */
  expireAadhaarOtp(txn: string): void;
  /** The next e-KYC the stub answers carries this full number. */
  ekycWithNumberOnce(n: string): void;
}

let seq = 0;

export async function startDigioKycStub(): Promise<DigioKycStub> {
  const requests = new Map<
    string,
    { status: string; files: Array<{ doc_type: string; file_id: string }> }
  >();
  const template = "ipb-digilocker-stub";
  const media = new Map<string, Buffer>();
  const otp = aadhaarOtpStub("AOT", () => ++seq);
  const ref: { s?: DigioKycStub } = {};
  const stub = await startStub((r) => {
    const s = ref.s!;
    const want = `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`;
    if (r.headers.authorization !== want) return { status: 401, body: { code: "UNAUTHORIZED" } };
    const resp = /^\/client\/kyc\/v2\/([^/]+)\/response$/.exec(r.path);
    if (r.method === "GET" && resp) {
      const id = decodeURIComponent(resp[1] as string);
      const k = requests.get(id);
      if (!k) return { status: 404, body: { code: "NOT_FOUND" } };
      return {
        status: 200,
        body: {
          id,
          status: k.status,
          actions: [
            {
              type: "digilocker",
              status: k.status === "approved" ? "success" : "requested",
              // The issuer's signature result for every type but DRVLC, so "not reported" is seen.
              sub_files: k.files.map((f) => ({
                ...f,
                issuer: "digilocker-stub",
                ...(f.doc_type === "DRVLC" ? {} : { signature_valid: true }),
              })),
            },
          ],
        },
      };
    }
    const m = /^\/client\/kyc\/v2\/media\/([^/]+)$/.exec(r.path);
    if (r.method === "GET" && m) {
      const b = media.get(decodeURIComponent(m[1] as string));
      if (!b) return { status: 404, body: { code: "NOT_FOUND" } };
      return {
        status: 200,
        body: b.toString("latin1"),
        headers: { "content-type": "application/pdf" },
      };
    }
    if (r.method === "POST" && r.path === "/client/kyc/v2/request/with_template") {
      const b = r.json<{ template_name?: string; generate_access_token?: boolean }>();
      if (b.template_name !== template || b.generate_access_token !== true)
        return { status: 400, body: { code: "INVALID_TEMPLATE" } };
      const id = create("requested", []);
      return {
        status: 200,
        body: {
          id,
          status: "requested",
          access_token: {
            id: `GWT${String(++seq).padStart(10, "0")}`,
            valid_till: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        },
      };
    }
    if (r.method === "POST" && r.path === "/client/kyc/v2/aadhaar_otp/request") {
      const b = r.json<{ id_type?: string; id_number?: string; consent?: string }>();
      const out = otp.request(b.id_type ?? "", b.id_number ?? "", b.consent ?? "");
      if (!out.ok) return { status: 400, body: { code: out.code } };
      return { status: 200, body: { id: out.txn, otp_valid_till: out.validTill } };
    }
    if (r.method === "POST" && r.path === "/client/kyc/v2/aadhaar_otp/verify") {
      const b = r.json<{ id?: string; otp?: string }>();
      const out = otp.verify(b.id ?? "", b.otp ?? "");
      if (!out.ok)
        return out.code === "TRANSACTION_NOT_FOUND"
          ? { status: 404, body: { code: "NOT_FOUND" } }
          : { status: 400, body: { code: out.code } };
      return {
        status: 200,
        body: {
          id: b.id,
          signature_valid: true,
          model_version: "aadhaar-otp-stub-1",
          details: {
            aadhaar_last_digits: `xxxx-xxxx-${out.last4}`,
            ekyc_xml: Buffer.from(out.ekycXml).toString("base64"),
          },
        },
      };
    }
    if (r.method === "POST" && r.path === "/client/kyc/v2/offline_aadhaar/verify") {
      const b = r.json<{ file_data?: string; share_code?: string }>();
      if (!b.file_data || Buffer.from(b.file_data, "base64").compare(s.offlineZip) !== 0)
        return { status: 400, body: { code: "INVALID_FILE" } };
      if (b.share_code !== s.shareCode)
        return { status: 400, body: { code: "INVALID_SHARE_CODE" } };
      return {
        status: 200,
        body: {
          id: `OAV${String(++seq).padStart(10, "0")}`,
          signature_valid: true,
          model_version: "offline-ekyc-stub-1",
          details: {
            aadhaar_last_digits: "xxxx-xxxx-0420",
            name: "Asha Rao",
            dob: "1990-01-01",
            gender: "F",
            photo: Buffer.from("stub-photo").toString("base64"),
            generated_at: "2026-10-28T10:00:00Z",
          },
        },
      };
    }
    return { status: 404, body: { code: "NOT_FOUND" } };
  });
  const filesOf = (id: string, docTypes: string[]) =>
    docTypes.map((t) => {
      const file_id = `FIL${String(++seq).padStart(10, "0")}`;
      media.set(file_id, Buffer.from(`%PDF-1.7\n% ${t} from DigiLocker stub ${id}\n%%EOF\n`));
      return { doc_type: t, file_id };
    });
  const create = (status: string, docTypes: string[]) => {
    const id = `KID${String(++seq).padStart(10, "0")}`;
    requests.set(id, { status, files: filesOf(id, docTypes) });
    return id;
  };
  ref.s = Object.assign(stub, {
    clientId: `ACK${stubCredential().slice(0, 16)}`,
    clientSecret: stubCredential(),
    shareCode: "4821",
    offlineZip: Buffer.from(`PK\u0003\u0004 offline e-KYC stub ${stubCredential().slice(0, 8)}`),
    completedDigilocker: (docTypes: string[]) => create("approved", docTypes),
    pendingDigilocker: () => create("requested", []),
    digilockerTemplate: template,
    completeDigilocker: (requestId: string, docTypes: string[]) => {
      const k = requests.get(requestId);
      if (!k) throw new Error(`no Digio KYC request ${requestId}`);
      requests.set(requestId, { status: "approved", files: filesOf(requestId, docTypes) });
    },
    aadhaarOtp: otp.fixtures,
    expireAadhaarOtp: otp.expire,
    ekycWithNumberOnce: otp.embedNumberOnce,
  });
  return ref.s;
}
