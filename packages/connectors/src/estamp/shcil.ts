// ESTAMP adapter `shcil-estamp` (Udofin PR-UDF-054, R1-D-245): Stock Holding Corporation of India,
// the Central Record Keeping Agency for e-stamping in the States that adopted it, over the egress
// client, no SDK. India-hosted (IN), REGULATED (duty). Off behind `int.estamp.shcil.enabled`
// (default false) and `unproven` until the owner's SHCIL account exists and its sandbox leg runs
// (OWNER-QUESTIONS #177 (4)).
//
// It never buys: an e-stamp certificate is bought by the RE through its own SHCIL channel (its
// account or a collection centre), outside the platform; this adapter records that certificate
// against the stamped instrument and checks it with SHCIL (`recordCertificate`), reads it back
// (`verify`) and links it to one document (`attach`). `purchase` is refused `purchase_not_permitted`
// before anything is sent; `quoteDuty` and `handleWebhook` are `unsupported`. Only the certificate
// number, the State and the issue date leave; no party's name does.
//
// SHCIL's integration for regulated entities is not publicly documented (its public site verifies a
// certificate by State, number and issue date), so every vendor fact below is STUB-SHAPED, TO
// CONFIRM AGAINST THE SANDBOX ([VERIFY]), each in one small mapping function:
// - host `api.shcilestamp.com` [VERIFY]; auth: HTTP Basic with client id and secret [VERIFY];
// - read-back: `POST /estamp/v1/certificates/verify` with `{ certificate_no, state_code,
//   issue_date (YYYY-MM-DD, India time) }`, answered `{ certificate_no, state_code, issue_date,
//   stamp_duty_amount (rupees, two decimals), status ACTIVE | LOCKED | CANCELLED, reference_no }`,
//   or 404 when SHCIL holds no such certificate [VERIFY];
// - no callback is used: the certificate is always read back.
import {
  type PortHealth,
  type EstampState,
  type StampCertificateRecord,
} from "@infrabyx/contracts/ports";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";
import {
  ESTAMP,
  RecordingEstamp,
  assertIssuerMatches,
  estampRefused,
  indiaDate,
  rupeesToPaise,
  type IssuerCheck,
  type RecordingEstampOptions,
  type StoredStamp,
} from "./record.js";

const ADAPTER = "shcil-estamp";
const HOST = "api.shcilestamp.com";

export interface ShcilEstampOptions extends RecordingEstampOptions {
  /** `secrets/<env>/estamp/shcil/client_id` and `client_secret`. */
  clientId: () => Promise<string> | string;
  clientSecret: () => Promise<string> | string;
  /** Tests only: the SHCIL stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

/** What SHCIL answers about a certificate (stub-shaped [VERIFY]). */
export interface ShcilCertificate {
  certificate_no?: string;
  state_code?: string;
  issue_date?: string;
  stamp_duty_amount?: string | number;
  status?: string;
  reference_no?: string;
}

// ---- stub-shaped mappings (to confirm against the sandbox) -------------------------------------

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: SHCIL's certificate status to the port's. */
export function mapShcilStatus(status: string | undefined): EstampState {
  // A certificate SHCIL shows locked to a document is still a paid, valid stamp [VERIFY].
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
    case "LOCKED":
      return "issued";
    case "CANCELLED":
    case "REFUNDED":
      return "cancelled";
    default:
      throw vendorError(
        ESTAMP,
        ADAPTER,
        502,
        `unknown SHCIL certificate status ${status ?? "(none)"}`,
      );
  }
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: what SHCIL is asked (no party name). */
export function shcilVerifyRequest(c: {
  certificateNumber: string;
  state: string;
  issuedAt: string;
}) {
  return {
    certificate_no: c.certificateNumber,
    state_code: c.state,
    issue_date: indiaDate(c.issuedAt),
  };
}

// ------------------------------------------------------------------------------------------------

export class ShcilEstamp extends RecordingEstamp {
  private readonly egress;
  private readonly base: string;

  constructor(private readonly so: ShcilEstampOptions) {
    super(so, { adapter: ADAPTER, setting: "int.estamp.shcil.enabled", channels: ["E_STAMP"] });
    this.base = (so.baseUrl ?? `https://${HOST}`).replace(/\/$/, "");
    this.egress = createEgress({
      port: ESTAMP,
      adapter: ADAPTER,
      allow: [HOST],
      retries: 1,
      // The read-back is a POST that changes nothing at SHCIL, so it is safe to retry.
      retryUnsafe: true,
      maxBytes: 1024 * 1024,
      ...(so.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async headers(): Promise<Record<string, string>> {
    const basic = Buffer.from(
      `${await this.so.clientId()}:${await this.so.clientSecret()}`,
    ).toString("base64");
    return {
      authorization: `Basic ${basic}`,
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  private async lookup(c: {
    certificateNumber: string;
    state: string;
    issuedAt: string;
  }): Promise<ShcilCertificate> {
    const res = await this.egress(`${this.base}/estamp/v1/certificates/verify`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(shcilVerifyRequest(c)),
    });
    if (res.status === 404)
      throw estampRefused(ADAPTER, "SHCIL holds no such certificate", "certificate_not_found");
    if (res.status === 400 || res.status === 422)
      throw estampRefused(ADAPTER, "SHCIL refused the read-back", "vendor_rejected");
    if (res.status !== 200)
      throw vendorError(ESTAMP, ADAPTER, res.status, "SHCIL certificate read-back");
    return res.json<ShcilCertificate>();
  }

  private result(got: ShcilCertificate): IssuerCheck {
    return {
      state: mapShcilStatus(got.status),
      vendorRef: got.reference_no ?? `shcil:${got.certificate_no ?? ""}`,
      ...(got.reference_no !== undefined ? { vendorCertificateId: got.reference_no } : {}),
      verification: "ISSUER_READBACK",
    };
  }

  protected async check(r: StampCertificateRecord): Promise<IssuerCheck> {
    const got = await this.lookup({
      certificateNumber: r.certificateNumber,
      state: r.state,
      issuedAt: r.issuedAt,
    });
    assertIssuerMatches(ADAPTER, r, {
      certificateNumber: got.certificate_no,
      stateCode: got.state_code,
      dutyMinor: rupeesToPaise(got.stamp_duty_amount),
      issueDate: got.issue_date,
    });
    return this.result(got);
  }

  protected async readBack(s: StoredStamp): Promise<IssuerCheck> {
    const c = s.certificate;
    return this.result(
      await this.lookup({
        certificateNumber: c.certificateNumber ?? "",
        state: c.stateCode,
        issuedAt: c.issuedAt ?? "",
      }),
    );
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else {
        // An unknown route: 404 proves the credentials and the host; 401/403/5xx are down.
        const res = await this.egress(`${this.base}/estamp/v1/certificates/ipb-health`, {
          method: "GET",
          headers: await this.headers(),
        });
        if (res.status >= 500 || res.status === 401 || res.status === 403) status = "down";
      }
    } catch {
      status = "down";
    }
    return {
      status,
      latency_ms: Math.round(performance.now() - started),
      checked_at: new Date().toISOString(),
    };
  }
}
