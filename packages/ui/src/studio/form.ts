// Reading posted forms and turning service errors into notices. Only `IpbError`s become notices
// (their title and detail are written for the person); anything else is rethrown, so the app's
// error page handles it and nothing internal is shown.
import { isIpbError } from "@infrabyx/contracts/errors";
import type { FieldError, StudioResult } from "./types.js";

/** A trimmed text field, or undefined when empty. */
export const text = (fd: FormData, name: string): string | undefined => {
  const v = fd.get(name);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

/** A required text field; throws a field error the handler turns into a notice. */
export function required(fd: FormData, name: string, label: string): string {
  const v = text(fd, name);
  if (!v) throw new FieldProblem([{ fieldId: `f-${name}`, message: `Enter ${label}.` }]);
  return v;
}

/** A JSON field (block bodies, SEO, hosts); a syntax error is a field error. */
export function json(fd: FormData, name: string, label: string, fallback?: unknown): unknown {
  const v = text(fd, name);
  if (v === undefined) {
    if (fallback !== undefined) return fallback;
    throw new FieldProblem([{ fieldId: `f-${name}`, message: `Enter ${label}.` }]);
  }
  try {
    return JSON.parse(v) as unknown;
  } catch (e) {
    throw new FieldProblem([
      { fieldId: `f-${name}`, message: `${label} is not valid JSON: ${(e as Error).message}` },
    ]);
  }
}

/** One of a fixed set of values (a select or a submit button's `name=op`). */
export function oneOf<T extends string>(fd: FormData, name: string, values: readonly T[]): T {
  const v = text(fd, name);
  if (!v || !(values as readonly string[]).includes(v))
    throw new FieldProblem([{ fieldId: `f-${name}`, message: "Choose one of the options." }]);
  return v as T;
}

/** Errors found while reading the form, before any service call. */
export class FieldProblem extends Error {
  constructor(readonly errors: FieldError[]) {
    super("form problem");
    this.name = "FieldProblem";
  }
}

/**
 * Run a handler body: its result, or a notice for a form problem or an `IpbError`. The service's
 * field errors (`errors[].path`) are mapped to the field they came from when `fieldOf` names it.
 */
export async function run(
  body: () => Promise<StudioResult>,
  fieldOf: (path: string) => string | undefined = () => undefined,
): Promise<StudioResult> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof FieldProblem)
      return {
        flash: { tone: "danger", title: "Check the form", detail: "Some fields need attention." },
        errors: e.errors,
      };
    if (isIpbError(e)) {
      const errors = (e.errors ?? []).flatMap((x) => {
        const f = fieldOf(x.path ?? "");
        return f ? [{ fieldId: f, message: x.message }] : [];
      });
      return {
        flash: {
          tone: "danger",
          title: `${e.def.title} (${e.code})`,
          ...(e.detail ? { detail: e.detail } : {}),
        },
        errors,
      };
    }
    throw e;
  }
}

/** A dated value for display (ISO date, or date and time in UTC). */
export function when(d: Date | string | null | undefined, withTime = false): string {
  if (!d) return "—";
  const iso = (typeof d === "string" ? new Date(d) : d).toISOString();
  return withTime ? `${iso.slice(0, 16).replace("T", " ")} UTC` : iso.slice(0, 10);
}
