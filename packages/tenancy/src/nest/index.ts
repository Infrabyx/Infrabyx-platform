// NestJS adapter (PL1-D-02 / D-07): builds the tenant context from the claims the authentication
// guard verified and stored on the request, never from headers or the body (IPB-02-13).
// Register with app.useGlobalInterceptors(new TenantContextInterceptor()).
import {
  UnauthorizedException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Observable, map } from "rxjs";
import type { VerifiedClaims } from "@infrabyx/contracts/ports";
import { contextFromClaims, runWithContext } from "../context.js";
import {
  idempotencyRequestHash,
  parseIdempotencyKey,
  type IdempotencyRequest,
  type IdempotentResult,
} from "../idempotency.js";

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

export interface RequestWithIdempotency extends RequestWithClaims {
  method?: string;
  body?: unknown;
  /** The matched route template (Express `route.path`), e.g. `/v1/loans`. */
  route?: { path?: string };
  /** Set by `IdempotencyKeyInterceptor` on POST and PATCH; pass it to `idempotent()`. */
  idempotency?: IdempotencyRequest;
}

interface ResponseLike {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

const isIdempotentResult = (v: unknown): v is IdempotentResult<unknown> =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as { replayed?: unknown }).replayed === "boolean" &&
  typeof (v as { status?: unknown }).status === "number" &&
  "body" in v;

/**
 * IPB-10-07 at the edge (R1-D-27): POST and PATCH need a UUIDv7 `Idempotency-Key` (400 IPB-API-010
 * otherwise). The interceptor puts the key, the route and the request's hash on the request for the
 * handler's `idempotent()` call, and turns the handler's `IdempotentResult` into the response: its
 * status and body, with `Idempotent-Replayed: true` and `Idempotent-Original-Request-Id` on a replay.
 */
export class IdempotencyKeyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithIdempotency>();
    const method = (req.method ?? "").toUpperCase();
    if (method === "POST" || method === "PATCH") {
      const key = parseIdempotencyKey(header(req, "idempotency-key"));
      const route = `${method} ${req.route?.path ?? ""}`;
      const requestId = header(req, "x-request-id");
      req.idempotency = {
        key,
        route,
        requestHash: idempotencyRequestHash(method, route, req.body),
        ...(requestId ? { requestId } : {}),
      };
    }
    return next.handle().pipe(
      map((out: unknown) => {
        if (!isIdempotentResult(out)) return out;
        const res = http.getResponse<ResponseLike>();
        res.status(out.status);
        if (out.replayed) {
          res.setHeader("Idempotent-Replayed", "true");
          if (out.originalRequestId)
            res.setHeader("Idempotent-Original-Request-Id", out.originalRequestId);
        }
        return out.body;
      }),
    );
  }
}
