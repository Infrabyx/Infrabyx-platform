// NestJS adapter (PL1-D-02 / D-07): builds the tenant context from the claims the authentication
// guard verified and stored on the request, never from headers or the body (IPB-02-13).
// Register with app.useGlobalInterceptors(new TenantContextInterceptor()).
import {
  UnauthorizedException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import type { VerifiedClaims } from "@infrabyx/contracts/ports";
import { contextFromClaims, runWithContext } from "../context.js";

export interface RequestWithClaims {
  /** Set by the IDENTITY guard after token verification. */
  verifiedClaims?: VerifiedClaims;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

const header = (r: RequestWithClaims, n: string): string | undefined => {
  const v = r.headers?.[n];
  return Array.isArray(v) ? v[0] : v;
};

export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RequestWithClaims>();
    if (!req.verifiedClaims) throw new UnauthorizedException();
    const traceparent = header(req, "traceparent");
    const ua = header(req, "user-agent");
    const ctx = contextFromClaims(req.verifiedClaims, {
      ...(traceparent ? { traceId: traceparent.split("-")[1] ?? traceparent } : {}),
      ...(req.ip ? { ip: req.ip } : {}),
      ...(ua ? { userAgent: ua } : {}),
    });
    return new Observable((subscriber) =>
      runWithContext(ctx, () => next.handle().subscribe(subscriber)),
    );
  }
}
