// Sign-in over the IDENTITY port (IPB-02-01): `/auth/login` starts the authorisation code flow with
// PKCE and keeps the verifier and state in a short-lived HttpOnly cookie; `/auth/callback` checks
// the state, exchanges the code through the port, verifies the token and sets the session cookie;
// `/auth/me` shows the verified claims; `/auth/logout` clears the cookie. Only the fixture IDENTITY
// honours `?persona=` on login.
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { PKCE_COOKIE, SESSION_COOKIE, cookie, cookieMap, newPkce } from "../identity.js";
import { AuthGuard, type ApiRequest } from "./auth.js";
import { SERVICES, type ServicesLike } from "./tokens.js";

const PKCE_TTL_SECONDS = 600;

@Controller("auth")
export class AuthController {
  constructor(@Inject(SERVICES) private readonly s: ServicesLike) {}

  private get secure(): boolean {
    return this.s.env.APP_BASE_URL.startsWith("https://");
  }

  private get redirectUri(): string {
    return `${this.s.env.APP_BASE_URL}/auth/callback`;
  }

  @Get("login")
  login(@Query("persona") persona: string | undefined, @Res() res: Response): void {
    const p = newPkce();
    res.setHeader(
      "set-cookie",
      cookie(PKCE_COOKIE, `${p.state}.${p.verifier}`, {
        secure: this.secure,
        maxAgeSeconds: PKCE_TTL_SECONDS,
      }),
    );
    res.setHeader("cache-control", "no-store");
    res.redirect(
      302,
      this.s.flow.authorizeUrl({
        state: p.state,
        codeChallenge: p.challenge,
        redirectUri: this.redirectUri,
        ...(persona ? { persona } : {}),
      }),
    );
  }

  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const pkce = cookieMap(req.headers.cookie)[PKCE_COOKIE];
    const [expectedState, verifier] = (pkce ?? "").split(".");
    if (!code || !state || !verifier || state !== expectedState)
      throw new BadRequestException("the sign-in state does not match");
    const t = await this.s.identity.authenticate({
      kind: "oidc_code",
      value: code,
      redirectUri: this.redirectUri,
      codeVerifier: verifier,
    });
    await this.s.identity.verifyToken(t.accessToken);
    res.setHeader("set-cookie", [
      cookie(PKCE_COOKIE, null, { secure: this.secure }),
      cookie(SESSION_COOKIE, t.accessToken, { secure: this.secure, maxAgeSeconds: t.expiresIn }),
    ]);
    res.setHeader("cache-control", "no-store");
    res.redirect(303, this.s.env.APP_WEB_URL ?? `${this.s.env.APP_BASE_URL}/auth/me`);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() req: ApiRequest): Record<string, unknown> {
    const c = req.verifiedClaims!;
    return { sub: c.sub, tenantId: c.tid, type: c.typ, roles: c.roles, mfa: c.mfa === true };
  }

  @Post("logout")
  logout(@Res() res: Response): void {
    res.setHeader("set-cookie", cookie(SESSION_COOKIE, null, { secure: this.secure }));
    res.setHeader("cache-control", "no-store");
    res.status(204).send();
  }
}
