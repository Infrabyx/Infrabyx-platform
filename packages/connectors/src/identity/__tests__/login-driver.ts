// Test-only driver for an IdP's HTML login pages: follows forms the way a browser would, so the
// contract legs can prove the forced password change, MFA enrolment and an MFA login end to end.
// It understands the Keycloak login theme (form ids and field names), nothing else.
import { randomBytes, sha256, toBase64Url, toHex } from "@infrabyx/crypto";
// RFC 6238 TOTP is HMAC-SHA-1, which @infrabyx/crypto rightly does not offer; this file only plays
// the user's authenticator app against a test IdP.
// eslint-disable-next-line ipb/no-direct-crypto
import { createHmac } from "node:crypto";

export interface LoginStep {
  /** Page shown: login, update_password, configure_totp, otp, or done. */
  page: string;
}

export interface LoginResult {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  pages: string[];
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) over the raw secret bytes. */
export function totp(secret: Uint8Array, at = Date.now(), step = 0): string {
  const counter = Math.floor(at / 30_000) + step;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, "0");
}

const unescape = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x3D;/gi, "=")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

export class LoginDriver {
  private readonly cookies = new Map<string, string>();

  constructor(
    private readonly issuer: string,
    private readonly clientId: string,
    private readonly redirectUri = "http://127.0.0.1/callback",
  ) {}

  private store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair!.indexOf("=");
      this.cookies.set(pair!.slice(0, i), pair!.slice(i + 1));
    }
  }

  private async go(url: string, form?: Record<string, string>): Promise<Response> {
    const res = await fetch(url, {
      method: form ? "POST" : "GET",
      redirect: "manual",
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    });
    this.store(res);
    return res;
  }

  /**
   * Log in with a password and answer each page with `answer` until the IdP redirects back with
   * an authorisation code. `answer` gets the page kind and its HTML and returns the form fields.
   */
  async login(
    answer: (page: string, html: string) => Record<string, string>,
  ): Promise<LoginResult> {
    const codeVerifier = toBase64Url(randomBytes(32));
    const challenge = toBase64Url(sha256(codeVerifier));
    const q = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: "openid",
      state: toHex(randomBytes(8)),
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    let res = await this.go(`${this.issuer}/protocol/openid-connect/auth?${q}`);
    const pages: string[] = [];
    for (let i = 0; i < 8; i++) {
      if (res.status === 302 || res.status === 303) {
        const loc = res.headers.get("location") ?? "";
        if (loc.startsWith(this.redirectUri)) {
          const code = new URL(loc).searchParams.get("code");
          if (!code) throw new Error(`redirect without a code: ${new URL(loc).search}`);
          return { code, codeVerifier, redirectUri: this.redirectUri, pages };
        }
        res = await this.go(new URL(loc, this.issuer).toString());
        continue;
      }
      const html = await res.text();
      const page = pageKind(html);
      pages.push(page);
      const form = /<form[^>]*\baction="([^"]+)"[^>]*>([\s\S]*?)<\/form>/.exec(html);
      if (!form) throw new Error(`no form on page ${page} (status ${res.status})`);
      res = await this.go(unescape(form[1]!), { ...hiddenInputs(form[2]!), ...answer(page, html) });
    }
    throw new Error(`login did not finish: ${pages.join(" → ")}`);
  }
}

/** Hidden form fields (e.g. the selected credential), sent back as a browser would. */
function hiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]+)"/.exec(m[0])?.[1];
    if (name) out[name] = unescape(/value="([^"]*)"/.exec(m[0])?.[1] ?? "");
  }
  return out;
}

export function pageKind(html: string): string {
  if (/id="kc-form-login"/.test(html)) return "login";
  if (/name="password-new"/.test(html)) return "update_password";
  if (/name="totpSecret"/.test(html)) return "configure_totp";
  if (/id="kc-otp-login-form"|name="otp"/.test(html)) return "otp";
  if (/id="kc-error-message"|class="[^"]*kc-feedback-text/.test(html)) {
    const m = /kc-feedback-text">([^<]*)</.exec(html);
    return `error:${m?.[1]?.trim() ?? "unknown"}`;
  }
  return "unknown";
}

/** The raw TOTP secret Keycloak puts in the enrolment form. */
export const totpSecretOf = (html: string): Uint8Array =>
  new TextEncoder().encode(unescape(/name="totpSecret"[^>]*value="([^"]+)"/.exec(html)?.[1] ?? ""));
