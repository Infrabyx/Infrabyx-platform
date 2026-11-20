// ESTAMP adapter `digio-estamp` (Udofin PR-UDF-054, R1-D-245; the second stamping adapter, an
// assumption for the owner, OWNER-QUESTIONS #177 (1)): Digio's e-stamp, over the egress client, no
// SDK. India-hosted (IN), REGULATED (duty). Off behind `int.estamp.digio.enabled` (default false) and
// `unproven` until the owner's Digio e-stamp account exists and its sandbox leg runs (#177 (4)).
//
// Digio issues e-stamps from an inventory the RE buys in its own Digio console [VERIFY]. This
// adapter never orders a stamp and never affixes one from that inventory (consuming prepaid stamps
// is spending): it records a stamp Digio already issued to the RE, by Digio's id
// (`vendorCertificateId`, required), checks it against Digio's record, reads it back and links it
// to one document. `purchase` is refused `purchase_not_permitted` before anything is sent;
// `quoteDuty` and `handleWebhook` are `unsupported`. Only Digio's id leaves; no party's name does.
//
// Vendor facts below are STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX ([VERIFY]), each in one place:
// - hosts as the Digio eSign adapter: sandbox `ext.digio.in`, production `api.digio.in`; HTTP Basic
//   with client id and secret;
// - read-back: `GET /v2/client/estamp/{id}` answered `{ id, certificate_no, state (ISO 3166-2:IN
//   suffix), amount (rupees), status issued | attached | cancelled, issued_at (ISO 8601) }`.
import type { EstampState, PortHealth, StampCertificateRecord } from "@infrabyx/contracts/ports";
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

const ADAPTER = "digio-estamp";
const HOSTS = { sandbox: "ext.digio.in", production: "api.digio.in" } as const;
const DIGIO_ID = /^[A-Za-z0-9_-]{6,64}$/;

export interface DigioEstampOptions extends RecordingEstampOptions {
  /** `secrets/<env>/estamp/digio/client_id` and `client_secret`. */
  clientId: () => Promise<string> | string;
  clientSecret: () => Promise<string> | string;
  /** Test mode until the owner's account exists (default `sandbox`). */
  mode?: "sandbox" | "production";
  /** Tests only: the Digio e-stamp stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

/** What Digio answers about an e-stamp (stub-shaped [VERIFY]). */
export interface DigioEstampRecord {
  id?: string;
  certificate_no?: string;
  state?: string;
  amount?: string | number;
  status?: string;
  issued_at?: string;
}

/** STUB-SHAPED, TO CONFIRM AGAINST THE SANDBOX: Digio's e-stamp status to the port's. */
export function mapDigioEstampStatus(status: string | undefined): EstampState {
  switch ((status ?? "").toLowerCase()) {
    case "issued":
    case "attached":
      return "issued";
    case "cancelled":
      return "cancelled";
    default:
      throw vendorError(ESTAMP, ADAPTER, 502, `unknown Digio e-stamp status ${status ?? "(none)"}`);
  }
}

export class DigioEstamp extends RecordingEstamp {
  private readonly egress;
  private readonly base: string;

  constructor(private readonly dop: DigioEstampOptions) {
    super(dop, { adapter: ADAPTER, setting: "int.estamp.digio.enabled", channels: ["E_STAMP"] });
    const mode = dop.mode ?? "sandbox";
    this.base = (dop.baseUrl ?? `https://${HOSTS[mode]}`).replace(/\/$/, "");
    this.egress = createEgress({
      port: ESTAMP,
      adapter: ADAPTER,
      allow: [HOSTS[mode]],
      retries: 1,
      maxBytes: 1024 * 1024,
      ...(dop.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private async basic(): Promise<string> {
    const raw = `${await this.dop.clientId()}:${await this.dop.clientSecret()}`;
    return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
  }

  private async lookup(id: string): Promise<DigioEstampRecord> {
    if (!DIGIO_ID.test(id))
      throw estampRefused(ADAPTER, "not a Digio e-stamp id", "invalid_request");
    const res = await this.egress(`${this.base}/v2/client/estamp/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { authorization: await this.basic(), accept: "application/json" },
    });
    if (res.status === 404)
      throw estampRefused(ADAPTER, "Digio holds no such e-stamp", "certificate_not_found");
    if (res.status !== 200)
      throw vendorError(ESTAMP, ADAPTER, res.status, "Digio e-stamp read-back");
    const got = res.json<DigioEstampRecord>();
    if (got.id !== id) throw vendorError(ESTAMP, ADAPTER, 502, "Digio answered another e-stamp");
    return got;
  }

  private result(id: string, got: DigioEstampRecord): IssuerCheck {
    return {
      state: mapDigioEstampStatus(got.status),
      vendorRef: id,
      vendorCertificateId: id,
      verification: "ISSUER_READBACK",
    };
  }

  protected async check(r: StampCertificateRecord): Promise<IssuerCheck> {
    if (r.vendorCertificateId === undefined)
      throw estampRefused(
        ADAPTER,
        "a Digio e-stamp is recorded with its Digio id (vendorCertificateId)",
        "invalid_request",
      );
    const got = await this.lookup(r.vendorCertificateId);
    const at = typeof got.issued_at === "string" ? Date.parse(got.issued_at) : NaN;
    assertIssuerMatches(ADAPTER, r, {
      certificateNumber: got.certificate_no,
      stateCode: got.state,
      dutyMinor: rupeesToPaise(got.amount),
      issueDate: Number.isFinite(at) ? indiaDate(new Date(at).toISOString()) : undefined,
    });
    return this.result(r.vendorCertificateId, got);
  }

  protected async readBack(s: StoredStamp): Promise<IssuerCheck> {
    const id = s.certificate.vendorCertificateId ?? "";
    return this.result(id, await this.lookup(id));
  }

  async health(): Promise<PortHealth> {
    const started = performance.now();
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled())) status = "down";
      else {
        // An unknown id: 404 proves the credentials and the route; 401/403/5xx are down.
        const res = await this.egress(`${this.base}/v2/client/estamp/ipb-health`, {
          method: "GET",
          headers: { authorization: await this.basic(), accept: "application/json" },
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
