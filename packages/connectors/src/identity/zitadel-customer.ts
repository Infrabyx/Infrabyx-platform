// IDENTITY customer sign-in on Zitadel v4, the tested alternative (OWNER-QUESTIONS #84 (b),
// R1-D-19): one customer organisation per product, separate from the staff organisation. Zitadel's
// session API issues the code with `returnCode`, so the code comes back to the platform, which
// delivers it through NOTIFY; Zitadel checks it. The platform then finalises an OIDC authorisation
// request with the session (as a login client) and exchanges the code with PKCE. Zitadel does not
// bind tokens to a DPoP key, so the binding is the platform's (`customer.dpopBinding: emulated`):
// a request is accepted only with a proof by an active device key of the token's user, and a
// refresh only with the device's own key and current refresh token. A login client is a machine
// user with IAM_LOGIN_CLIENT on the instance and ORG_USER_MANAGER on the customer organisation.
import { IpbError, PortError } from "@infrabyx/contracts/errors";
import type {
  AdapterDescriptor,
  CustomerOtpChannel,
  DpopTarget,
  PortHealth,
} from "@infrabyx/contracts";
import { randomBytes, sha256, sha256Hex, toBase64Url } from "@infrabyx/crypto";
import type { createEgress, EgressResponse } from "../core/http.js";
import { TokenVerifier } from "./common.js";
import {
  CustomerIdentityBase,
  customerIdentitySettings,
  type ChallengeRecord,
  type CustomerIdentityBaseOptions,
  type CustomerIdentitySettings,
  type IdpTokens,
} from "./customer.js";
import { basicAuth, zitadelClaims, zitadelEgress } from "./zitadel.js";

type Egress = ReturnType<typeof createEgress>;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** User id of a customer account: one per organisation, tenant and login. */
export const zitadelCustomerUserId = (orgId: string, tenantId: string, login: string): string =>
  `cus${sha256Hex(`${orgId}:${tenantId}:${login}`).slice(0, 40)}`;

export interface ZitadelCustomerIdentityOptions extends CustomerIdentityBaseOptions {
  /** Issuer and API base, e.g. https://id.example.in. */
  baseUrl: string;
  /** The product's customer organisation and its project. */
  orgId: string;
  projectId: string;
  /** The customer API application (code flow with PKCE, refresh tokens). */
  clientId: string;
  clientSecret: string;
  /** Registered redirect URI of that application; never followed. */
  redirectUri: string;
  /** The login client machine user and its token. */
  loginClient: { userId: string; token: string };
  jwksCacheSeconds?: number;
  allowLoopbackHttp?: boolean;
}

export class ZitadelCustomerIdentity extends CustomerIdentityBase {
  readonly descriptor: AdapterDescriptor = {
    port: "IDENTITY",
    adapter: "zitadel-customer",
    residency: "IN",
    maxDataClass: "CONFIDENTIAL",
    capabilities: { "customer.dpopBinding": "emulated" },
  };
  readonly issuer: string;
  readonly signInProofTarget: DpopTarget;
  protected readonly nativeBinding = false;
  protected readonly verifier: TokenVerifier;
  private readonly egress: Egress;

  constructor(private readonly o: ZitadelCustomerIdentityOptions) {
    super(o);
    this.issuer = o.baseUrl.replace(/\/$/, "");
    this.signInProofTarget = { htm: "POST", htu: `${this.issuer}/oauth/v2/token` };
    this.egress = zitadelEgress(this.issuer, o.allowLoopbackHttp);
    this.verifier = new TokenVerifier({
      issuer: this.issuer,
      audience: o.projectId,
      jwksUrl: `${this.issuer}/oauth/v2/keys`,
      egress: this.egress,
      algorithms: ["ES256"],
      mapClaims: zitadelClaims,
      ...(o.jwksCacheSeconds !== undefined ? { jwksCacheSeconds: o.jwksCacheSeconds } : {}),
      revocations: o.revocations,
      ...(o.now ? { now: o.now } : {}),
    });
  }

  private fail(status: number, what: string): never {
    throw new PortError(
      status === 401 || status === 403 ? "IPB-PORT-001" : "IPB-PORT-002",
      "IDENTITY",
      {
        adapter: "zitadel-customer",
        detail: `${what} answered ${status}`,
        meta: { status },
      },
    );
  }

  private async call(
    method: string,
    path: string,
    body?: unknown,
    extra: RequestInit = {},
  ): Promise<EgressResponse> {
    return this.egress(`${this.issuer}${path}`, {
      method,
      ...extra,
      headers: {
        authorization: `Bearer ${this.o.loginClient.token}`,
        "content-type": "application/json",
        "x-zitadel-orgid": this.o.orgId,
        ...(extra.headers as Record<string, string> | undefined),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch((e: unknown) => {
      if ((e as PortError).code === "IPB-PORT-002")
        throw new PortError("IPB-IDN-002", "IDENTITY", {
          adapter: "zitadel-customer",
          detail: "identity provider unavailable for new sessions",
          cause: e,
        });
      throw e;
    });
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.call(method, path, body);
    if (r.status >= 300) this.fail(r.status, `${method} ${path.split("/").slice(0, 4).join("/")}`);
    return (r.body.byteLength ? r.json<T>() : {}) as T;
  }

  protected async resolveUser(
    tenantId: string,
    channel: CustomerOtpChannel,
    login: string,
  ): Promise<string> {
    const userId = zitadelCustomerUserId(this.o.orgId, tenantId, login);
    const found = await this.call("GET", `/v2/users/${userId}`);
    if (found.status === 200) return userId;
    if (found.status !== 404) this.fail(found.status, "GET /v2/users");
    const email = channel === "email" ? login : `${userId}@customer.invalid`;
    const created = await this.call("POST", "/v2/users/human", {
      userId,
      username: userId,
      organization: { orgId: this.o.orgId },
      profile: { givenName: "Customer", familyName: "Customer" },
      email: { email, isVerified: true },
      ...(channel === "email" ? {} : { phone: { phone: login, isVerified: true } }),
      metadata: [
        { key: "tenant_id", value: b64(tenantId) },
        { key: "principal_type", value: b64("user") },
      ],
    });
    // 409: a concurrent request created the account first.
    if (created.status === 409) return userId;
    if (created.status >= 300) this.fail(created.status, "POST /v2/users/human");
    await this.api(
      "POST",
      `/v2/users/${userId}/${channel === "email" ? "otp_email" : "otp_sms"}`,
      {},
    );
    if (this.base.customerRoles?.length)
      await this.api("POST", `/management/v1/users/${userId}/grants`, {
        projectId: this.o.projectId,
        roleKeys: [...this.base.customerRoles],
      });
    return userId;
  }

  protected async idpSend(a: {
    tenantId: string;
    userId: string;
    login: string;
    channel: CustomerOtpChannel;
  }): Promise<{ ref: Record<string, string>; code: string }> {
    const challenge =
      a.channel === "email" ? { otpEmail: { returnCode: {} } } : { otpSms: { returnCode: true } };
    const r = await this.call("POST", "/v2/sessions", {
      checks: { user: { userId: a.userId } },
      challenges: challenge,
    });
    if (r.status === 400 || r.status === 412)
      throw new IpbError("IPB-SEC-019", {
        detail: "the identity provider refused a code for this account now",
        meta: { reason: "idp_refused", retryAfterSeconds: 60 },
      });
    if (r.status >= 300) this.fail(r.status, "POST /v2/sessions");
    const s = r.json<{
      sessionId: string;
      sessionToken: string;
      challenges?: { otpSms?: string; otpEmail?: string };
    }>();
    const code = a.channel === "email" ? s.challenges?.otpEmail : s.challenges?.otpSms;
    if (!code) this.fail(r.status, "a session without the code it was asked to return");
    return { ref: { sessionId: s.sessionId, sessionToken: s.sessionToken }, code: code! };
  }

  private async tokenRequest(form: Record<string, string>): Promise<EgressResponse> {
    return this.egress(`${this.issuer}/oauth/v2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: basicAuth(this.o.clientId, this.o.clientSecret),
      },
      body: new URLSearchParams(form).toString(),
    });
  }

  private tokens(r: EgressResponse, session?: string): IdpTokens {
    const t = r.json<{ access_token: string; refresh_token?: string; expires_in: number }>();
    if (!t.refresh_token) this.fail(r.status, "token without a refresh token");
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token!,
      expiresIn: t.expires_in,
      ...(session ? { session } : {}),
    };
  }

  protected async idpVerify(c: ChallengeRecord, code: string): Promise<IdpTokens | null> {
    const check = c.channel === "email" ? { otpEmail: { code } } : { otpSms: { code } };
    const checked = await this.call("PATCH", `/v2/sessions/${c.idpRef.sessionId}`, {
      sessionToken: c.idpRef.sessionToken,
      checks: check,
    });
    if (checked.status === 400 || checked.status === 404 || checked.status === 412) return null;
    if (checked.status >= 300) this.fail(checked.status, "PATCH /v2/sessions");
    const sessionToken = checked.json<{ sessionToken: string }>().sessionToken;

    // An authorisation request finalised with the session, as the login UI would.
    const verifier = toBase64Url(randomBytes(32));
    const q = new URLSearchParams({
      client_id: this.o.clientId,
      redirect_uri: this.o.redirectUri,
      response_type: "code",
      scope: `openid offline_access urn:zitadel:iam:user:metadata urn:zitadel:iam:org:projects:roles urn:zitadel:iam:org:project:id:${this.o.projectId}:aud`,
      code_challenge: toBase64Url(sha256(new TextEncoder().encode(verifier))),
      code_challenge_method: "S256",
    });
    const az = await this.call("GET", `/oauth/v2/authorize?${q}`, undefined, {
      redirect: "manual",
      headers: { "x-zitadel-login-client": this.o.loginClient.userId },
    });
    const location = az.headers.get("location");
    const authRequest = location
      ? new URL(location, this.issuer).searchParams.get("authRequest")
      : null;
    if (az.status !== 302 || !authRequest)
      this.fail(az.status, "authorize without an auth request");
    const fin = await this.api<{ callbackUrl: string }>(
      "POST",
      `/v2/oidc/auth_requests/${encodeURIComponent(authRequest!)}`,
      {
        session: { sessionId: c.idpRef.sessionId, sessionToken },
      },
    );
    const callback = new URL(fin.callbackUrl);
    const target = new URL(this.o.redirectUri);
    if (callback.origin !== target.origin || callback.pathname !== target.pathname)
      this.fail(502, "a callback to another redirect URI");
    const authCode = callback.searchParams.get("code");
    if (!authCode) this.fail(502, "a callback without a code");
    const r = await this.tokenRequest({
      grant_type: "authorization_code",
      code: authCode!,
      redirect_uri: this.o.redirectUri,
      code_verifier: verifier,
    });
    if (r.status !== 200) this.fail(r.status, "code exchange");
    return this.tokens(r, c.idpRef.sessionId);
  }

  protected async idpRefresh(refreshToken: string): Promise<IdpTokens | null> {
    const r = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    if (r.status >= 500) this.fail(r.status, "refresh");
    if (r.status !== 200) return null;
    return this.tokens(r);
  }

  protected async idpEndSession(_userId: string, session: string): Promise<void> {
    await this.call("DELETE", `/v2/sessions/${encodeURIComponent(session)}`, {});
  }

  async health(): Promise<PortHealth> {
    const t0 = Date.now();
    let status: PortHealth["status"];
    try {
      const r = await this.egress(`${this.issuer}/.well-known/openid-configuration`);
      status = r.status === 200 ? "up" : "down";
    } catch {
      status = "down";
    }
    return { status, latency_ms: Date.now() - t0, checked_at: new Date().toISOString() };
  }

  /**
   * Create the product's customer organisation with its project, roles, API application and login
   * client, with an admin PAT (deploy jobs and tests only). `instanceSettings` also applies the
   * customer token lifetimes and six-digit codes of `codeTtlSeconds` to the whole instance: give
   * customers an instance of their own, or accept the staff instance's values. Secrets are
   * returned for the SECRETS port, never logged.
   */
  static async applyCustomerOrg(o: {
    baseUrl: string;
    pat: string;
    orgName: string;
    redirectUri: string;
    customerRoles?: readonly string[];
    settings?: Partial<CustomerIdentitySettings>;
    instanceSettings?: boolean;
    allowLoopbackHttp?: boolean;
  }): Promise<{
    orgId: string;
    projectId: string;
    clientId: string;
    clientSecret: string;
    loginClient: { userId: string; token: string };
  }> {
    const base = o.baseUrl.replace(/\/$/, "");
    const egress = zitadelEgress(base, o.allowLoopbackHttp);
    const s = customerIdentitySettings(o.settings);
    const call = async <T>(
      method: string,
      path: string,
      body?: unknown,
      org?: string,
    ): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        let r: EgressResponse;
        try {
          r = await egress(`${base}${path}`, {
            method,
            headers: {
              authorization: `Bearer ${o.pat}`,
              "content-type": "application/json",
              ...(org ? { "x-zitadel-orgid": org } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        } catch (e) {
          // A fresh instance answers 503 for a short while after it reports ready.
          if ((e as PortError).meta?.vendorStatus === 503 && attempt < 20) {
            await new Promise((res) => setTimeout(res, 1500));
            continue;
          }
          throw e;
        }
        // Re-applying a setting that already holds the value is "No changes" (400); that is done.
        if (method === "PUT" && r.status === 400 && /COMMAND-0pk2nu|No changes/.test(r.text()))
          return {} as T;
        if (r.status >= 300)
          throw new PortError("IPB-PORT-002", "IDENTITY", {
            adapter: "zitadel-customer",
            detail: `${method} ${path} answered ${r.status}: ${r.text().slice(0, 300)}`,
          });
        return (r.body.byteLength ? r.json<T>() : {}) as T;
      }
    };
    if (o.instanceSettings) {
      await call("PUT", "/admin/v1/settings/oidc", {
        accessTokenLifetime: "300s",
        idTokenLifetime: "300s",
        refreshTokenIdleExpiration: `${s.sessionIdleSeconds}s`,
        refreshTokenExpiration: `${s.sessionMaxSeconds}s`,
      });
      for (const type of ["SECRET_GENERATOR_TYPE_OTP_SMS", "SECRET_GENERATOR_TYPE_OTP_EMAIL"])
        await call("PUT", `/admin/v1/secretgenerators/${type}`, {
          length: 6,
          expiry: `${s.codeTtlSeconds}s`,
          includeDigits: true,
          includeLowerLetters: false,
          includeUpperLetters: false,
          includeSymbols: false,
        });
    }
    const org = (
      await call<{ organizationId: string }>("POST", "/v2/organizations", { name: o.orgName })
    ).organizationId;
    const project = (
      await call<{ id: string }>(
        "POST",
        "/management/v1/projects",
        { name: "ipb-customers", projectRoleAssertion: true, projectRoleCheck: false },
        org,
      )
    ).id;
    if (o.customerRoles?.length)
      await call(
        "POST",
        `/management/v1/projects/${project}/roles/_bulk`,
        { roles: o.customerRoles.map((key) => ({ key, displayName: key })) },
        org,
      );
    const app = await call<{ clientId: string; clientSecret: string }>(
      "POST",
      `/management/v1/projects/${project}/apps/oidc`,
      {
        name: "ipb-customer-api",
        redirectUris: [o.redirectUri],
        responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
        grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
        appType: "OIDC_APP_TYPE_WEB",
        authMethodType: "OIDC_AUTH_METHOD_TYPE_BASIC",
        accessTokenType: "OIDC_TOKEN_TYPE_JWT",
        accessTokenRoleAssertion: true,
        devMode: o.allowLoopbackHttp === true,
      },
      org,
    );
    const login = (
      await call<{ userId: string }>(
        "POST",
        "/management/v1/users/machine",
        {
          userName: "ipb-customer-login",
          name: "IPB customer login client",
          description: "Customer sign-in: sessions and auth requests (R1-D-19)",
          accessTokenType: "ACCESS_TOKEN_TYPE_BEARER",
        },
        org,
      )
    ).userId;
    await call("POST", "/admin/v1/members", { userId: login, roles: ["IAM_LOGIN_CLIENT"] });
    await call(
      "POST",
      "/management/v1/orgs/me/members",
      { userId: login, roles: ["ORG_USER_MANAGER"] },
      org,
    );
    const expiry = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const pat = await call<{ token: string }>(
      "POST",
      `/management/v1/users/${login}/pats`,
      { expirationDate: expiry },
      org,
    );
    return {
      orgId: org,
      projectId: project,
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      loginClient: { userId: login, token: pat.token },
    };
  }
}
