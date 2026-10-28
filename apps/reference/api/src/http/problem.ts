// Every error leaves the API as an RFC 9457 problem (IPB-10-04): an `IpbError` through the
// catalogue's `toProblem`, a Nest HTTP exception as an `IPB-API-<status>` problem, anything else
// as a generic 500 with no internals. The trace id is the request's `traceparent` trace.
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { toProblem, type Problem } from "@infrabyx/contracts/errors";
import { NotFoundError } from "@infrabyx/tenancy";

export const PROBLEM_TYPE_BASE = "https://help.infrabyx.in/errors";

export function traceIdOf(req: { headers: Record<string, string | string[] | undefined> }) {
  const tp = req.headers["traceparent"];
  const v = Array.isArray(tp) ? tp[0] : tp;
  const id = v?.split("-")[1];
  return id && /^[0-9a-f]{32}$/.test(id) ? id : undefined;
}

export function problemFor(err: unknown, o: { instance?: string; traceId?: string }): Problem {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const body = err.getResponse();
    const detail =
      typeof body === "string"
        ? body
        : typeof (body as { message?: unknown }).message === "string"
          ? ((body as { message: string }).message as string)
          : undefined;
    return {
      type: `${PROBLEM_TYPE_BASE}/IPB-API-${status}`,
      title: err.message,
      status,
      code: `IPB-API-${status}`,
      ...(detail && detail !== err.message ? { detail } : {}),
      ...(o.instance !== undefined ? { instance: o.instance } : {}),
      ...(o.traceId !== undefined ? { trace_id: o.traceId } : {}),
    };
  }
  if (err instanceof NotFoundError)
    return {
      type: `${PROBLEM_TYPE_BASE}/IPB-API-404`,
      title: "Not found",
      status: 404,
      code: "IPB-API-404",
      ...(o.instance !== undefined ? { instance: o.instance } : {}),
      ...(o.traceId !== undefined ? { trace_id: o.traceId } : {}),
    };
  return toProblem(err, { typeBase: PROBLEM_TYPE_BASE, ...o });
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const traceId = traceIdOf(req);
    const p = problemFor(err, {
      instance: req.originalUrl ?? req.url,
      ...(traceId ? { traceId } : {}),
    });
    res
      .status(p.status)
      .setHeader("content-type", "application/problem+json")
      .setHeader("cache-control", "no-store")
      .send(JSON.stringify(p));
  }
}
