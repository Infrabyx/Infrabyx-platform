// The authentication guard (IPB-02-13): the token of the request is verified by the IDENTITY port
// and the verified claims are stored on the request for `TenantContextInterceptor`, which builds
// the kernel context from them and nothing else. MFA is checked for the roles that require it
// (IPB-02-02). A route without a token answers 401 as a problem.
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import { assertMfaForRoles } from "@infrabyx/connectors/identity";
import type { RequestWithClaims } from "@infrabyx/tenancy/nest";
import { tokenFrom } from "../identity.js";
import { SERVICES, type ServicesLike } from "./tokens.js";

export type ApiRequest = Request & RequestWithClaims;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(SERVICES) private readonly s: ServicesLike) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const token = tokenFrom(req.headers);
    if (!token) throw new UnauthorizedException("no token");
    const claims = await this.s.identity.verifyToken(token).catch(() => {
      throw new UnauthorizedException("token invalid or expired");
    });
    assertMfaForRoles(claims);
    req.verifiedClaims = claims;
    return true;
  }
}
