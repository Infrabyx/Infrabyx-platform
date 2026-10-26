// Redaction derived from the schema, not a hand-maintained list (IPB-11-07).
import { describeSchema, type EnvSchema } from "./schema.js";

export const REDACTED = "***";

export function redactionMap(schema: EnvSchema): ReadonlySet<string> {
  return new Set(
    describeSchema(schema)
      .filter((v) => v.meta.sens === "S")
      .map((v) => v.name),
  );
}

/** Copy of a config dump with every `S` variable replaced by `***`. */
export function redact<T extends Record<string, unknown>>(schema: EnvSchema, values: T): T {
  const s = redactionMap(schema);
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      s.has(k) && v !== undefined && v !== "" ? REDACTED : v,
    ]),
  ) as T;
}

/** Remove resolved secret values from free text (log lines, error messages). */
export function redactText(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join(REDACTED);
  return out;
}
