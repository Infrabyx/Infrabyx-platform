// CAPTCHA adapters `turnstile` (reference, the owner's choice: Cloudflare Turnstile, free tier;
// Udofin #58, UDF-D-120) and `hcaptcha` (alternative) (Udofin PR-UDF-029; ADR-0004; R1-D-50). Both
// call the vendor's `siteverify` over the egress client with only the token and the secret: never
// `remoteip`, a login or any other identifier. Off behind `int.captcha.<adapter>.enabled` and
// `unproven` until the owner's site keys exist. hCaptcha has no page action, so it refuses a request
// that asks for one (`verifyAction` unsupported).
import { PortError } from "@infrabyx/contracts/errors";
import {
  CaptchaVerifyRequest,
  type AdapterDescriptor,
  type CaptchaFailure,
  type CaptchaPort,
  type CaptchaVerdict,
  type PortHealth,
} from "@infrabyx/contracts/ports";
import { createEgress } from "../core/http.js";
import { vendorError } from "../messaging/common.js";

const PORT = "CAPTCHA";

interface Vendor {
  adapter: "turnstile" | "hcaptcha";
  host: string;
  path: string;
  actions: boolean;
  /** Vendor error code → verdict; anything else on a `success: false` is `invalid`. */
  failures: Readonly<Record<string, CaptchaFailure>>;
  /** Codes that mean our configuration is wrong: an error, never a customer's verdict. */
  ours: readonly string[];
}

const VENDORS: Record<"turnstile" | "hcaptcha", Vendor> = {
  turnstile: {
    adapter: "turnstile",
    host: "challenges.cloudflare.com",
    path: "/turnstile/v0/siteverify",
    actions: true,
    failures: {
      "timeout-or-duplicate": "duplicate",
      "invalid-input-response": "invalid",
      "missing-input-response": "invalid",
    },
    ours: ["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"],
  },
  hcaptcha: {
    adapter: "hcaptcha",
    host: "api.hcaptcha.com",
    path: "/siteverify",
    actions: false,
    failures: {
      "expired-input-response": "expired",
      "already-seen-response": "duplicate",
      "invalid-input-response": "invalid",
      "missing-input-response": "invalid",
    },
    ours: [
      "missing-input-secret",
      "invalid-input-secret",
      "bad-request",
      "sitekey-secret-mismatch",
      "invalid-or-already-seen-response-secret",
    ],
  },
};

export interface SiteverifyCaptchaOptions {
  /** `int.captcha.<adapter>.enabled`, read on every call. */
  enabled: () => Promise<boolean> | boolean;
  /** `secrets/<env>/captcha/<adapter>/secret_key`. */
  secret: () => Promise<string> | string;
  /** Tests only: the stub. */
  baseUrl?: string;
  allowLoopbackHttp?: boolean;
}

interface SiteverifyReply {
  success?: boolean;
  "error-codes"?: string[];
  hostname?: string;
  action?: string;
  challenge_ts?: string;
}

class SiteverifyCaptcha implements CaptchaPort {
  readonly descriptor: AdapterDescriptor;
  private readonly egress;
  private readonly url: string;

  constructor(
    private readonly v: Vendor,
    private readonly o: SiteverifyCaptchaOptions,
  ) {
    this.descriptor = {
      port: PORT,
      adapter: v.adapter,
      // Only an opaque token and our secret leave; nothing personal is processed abroad.
      residency: "GLOBAL",
      maxDataClass: "INTERNAL",
      ...(v.actions ? {} : { capabilities: { verifyAction: "unsupported" } }),
    };
    this.url = `${(o.baseUrl ?? `https://${v.host}`).replace(/\/$/, "")}${v.path}`;
    this.egress = createEgress({
      port: PORT,
      adapter: v.adapter,
      allow: [v.host],
      retries: 0,
      timeoutMs: 5000,
      maxBytes: 64 * 1024,
      ...(o.allowLoopbackHttp ? { allowLoopbackHttp: true } : {}),
    });
  }

  private refused(detail: string, reason: string): PortError {
    return new PortError("IPB-PORT-001", PORT, {
      adapter: this.v.adapter,
      detail,
      meta: { reason, definite: true },
    });
  }

  async verify(raw: CaptchaVerifyRequest): Promise<CaptchaVerdict> {
    const r = CaptchaVerifyRequest.parse(raw);
    if (r.expectedAction && !this.v.actions)
      throw this.refused(`${this.v.adapter} has no page action to check`, "unsupported");
    if (!(await this.o.enabled()))
      throw this.refused(
        `the ${this.v.adapter} adapter is off (int.captcha.${this.v.adapter}.enabled)`,
        "adapter_disabled",
      );
    // Only the token and the secret: no remoteip, no customer identifier (PR-UDF-029).
    const body = new URLSearchParams({ secret: await this.o.secret(), response: r.token });
    const res = await this.egress(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    if (res.status !== 200) throw vendorError(PORT, this.v.adapter, res.status, "siteverify");
    const out = res.json<SiteverifyReply>();
    const codes = out["error-codes"] ?? [];
    if (!out.success) {
      const ours = codes.find((c) => this.v.ours.includes(c));
      if (ours)
        throw new PortError("IPB-PORT-002", PORT, {
          adapter: this.v.adapter,
          detail: `siteverify refused the site's configuration (${ours})`,
        });
      const known = codes.map((c) => this.v.failures[c]).find((x) => x !== undefined);
      return { ok: false, reason: known ?? "invalid" };
    }
    if (r.expectedHostname && out.hostname !== r.expectedHostname)
      return { ok: false, reason: "hostname_mismatch" };
    if (r.expectedAction && out.action !== r.expectedAction)
      return { ok: false, reason: "action_mismatch" };
    return {
      ok: true,
      ...(out.hostname ? { hostname: out.hostname } : {}),
      ...(out.action ? { action: out.action } : {}),
      ...(out.challenge_ts ? { challengedAt: out.challenge_ts } : {}),
    };
  }

  /** Up when enabled and the secret is set; siteverify has no probe that spends no token. */
  async health(): Promise<PortHealth> {
    let status: PortHealth["status"] = "up";
    try {
      if (!(await this.o.enabled()) || !(await this.o.secret())) status = "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: 0, checked_at: new Date().toISOString() };
  }
}

/** Cloudflare Turnstile, the reference CAPTCHA adapter. */
export class TurnstileCaptcha extends SiteverifyCaptcha {
  constructor(o: SiteverifyCaptchaOptions) {
    super(VENDORS.turnstile, o);
  }
}

/** hCaptcha, the alternative CAPTCHA adapter. */
export class HCaptchaCaptcha extends SiteverifyCaptcha {
  constructor(o: SiteverifyCaptchaOptions) {
    super(VENDORS.hcaptcha, o);
  }
}
