// IpbError, PortError and the RFC 9457 problem shape (IPB-10-04, IPB-02-48).
import { z } from "zod";
import { ERROR_CATALOGUE, type ErrorDef, type IpbErrorCode } from "./error-catalogue.js";

export {
  ERROR_CATALOGUE,
  type ErrorDef,
  type IpbErrorCode,
  type NonHttpStatus,
} from "./error-catalogue.js";

/** Exit code for configuration failures (IPB-11-02, EX_CONFIG). */
export const EXIT_CONFIG = 78;

export interface IpbErrorOptions {
  /** Human-readable detail. Never contains secrets, SQL or stack traces (IPB-02-48). */
  detail?: string;
  /** Structured, non-sensitive context (e.g. failing variable names, never values). */
  meta?: Record<string, unknown>;
  /** Field-level errors (IPB-10-04 `errors[]`). */
  errors?: ProblemFieldError[];
  cause?: unknown;
}

export class IpbError extends Error {
  readonly code: IpbErrorCode;
  readonly def: ErrorDef;
  readonly detail?: string;
  readonly meta?: Record<string, unknown>;
  readonly errors?: ProblemFieldError[];

  constructor(code: IpbErrorCode, opts: IpbErrorOptions = {}) {
    const def = ERROR_CATALOGUE[code];
    super(opts.detail ? `${code}: ${def.title} — ${opts.detail}` : `${code}: ${def.title}`, {
      cause: opts.cause,
    });
    this.name = "IpbError";
    this.code = code;
    this.def = def;
    if (opts.detail !== undefined) this.detail = opts.detail;
    if (opts.meta !== undefined) this.meta = opts.meta;
    if (opts.errors !== undefined) this.errors = opts.errors;
  }

  /** HTTP status when the error is served over HTTP; 500 for non-HTTP codes. */
  get httpStatus(): number {
    return typeof this.def.status === "number" ? this.def.status : 500;
  }
}

/** Error thrown by port adapters; never wraps vendor error objects in `detail` (IPB-01 §01.4.4.1). */
export class PortError extends IpbError {
  readonly port: string;
  readonly adapter?: string;

  constructor(code: IpbErrorCode, port: string, opts: IpbErrorOptions & { adapter?: string } = {}) {
    super(code, opts);
    this.name = "PortError";
    this.port = port;
    if (opts.adapter !== undefined) this.adapter = opts.adapter;
  }
}

export const isIpbError = (e: unknown): e is IpbError => e instanceof IpbError;

export const ProblemFieldError = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
export type ProblemFieldError = z.infer<typeof ProblemFieldError>;

/** RFC 9457 problem+json with IPB-10-04 extensions. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: z.string().regex(/^[A-Z]{2,4}-[A-Z0-9]{2,6}-\d{3}$/),
  help_key: z
    .string()
    .regex(/^hlp\.[a-z0-9_]+\.[a-z0-9_.]+$/)
    .optional(),
  trace_id: z.string().optional(),
  errors: z.array(ProblemFieldError).optional(),
});
export type Problem = z.infer<typeof Problem>;

export interface ToProblemOptions {
  /** Base URL of help pages; `type` = `${typeBase}/${code}`. */
  typeBase?: string;
  instance?: string;
  traceId?: string;
  /** Product re-export prefix, e.g. "LDC" turns IPB-PORT-001 into LDC-PORT-001 (IPB-01 §01.6.3). */
  productPrefix?: string;
}

/** Render an IpbError as an RFC 9457 problem. Unknown errors become a generic 500 with no internals. */
export function toProblem(err: unknown, opts: ToProblemOptions = {}): Problem {
  const typeBase = opts.typeBase ?? "https://help.infrabyx.in/errors";
  if (!isIpbError(err)) {
    return {
      type: `${typeBase}/internal`,
      title: "Internal error",
      status: 500,
      code: opts.productPrefix ? `${opts.productPrefix}-INT-500` : "IPB-API-500",
      ...(opts.instance !== undefined ? { instance: opts.instance } : {}),
      ...(opts.traceId !== undefined ? { trace_id: opts.traceId } : {}),
    };
  }
  const code = opts.productPrefix ? err.code.replace(/^IPB-/, `${opts.productPrefix}-`) : err.code;
  const p: Problem = {
    type: `${typeBase}/${err.code}`,
    title: err.def.title,
    status: err.httpStatus,
    code,
  };
  if (err.detail !== undefined) p.detail = err.detail;
  if (err.def.helpKey !== undefined) p.help_key = err.def.helpKey;
  if (opts.instance !== undefined) p.instance = opts.instance;
  if (opts.traceId !== undefined) p.trace_id = opts.traceId;
  if (err.errors !== undefined) p.errors = err.errors;
  return p;
}
