// RFC 8785 JSON Canonicalization Scheme (JCS) for JSON values (PL1-C-01).
// Keys are sorted by UTF-16 code units; strings and numbers use ECMAScript JSON serialisation,
// which is exactly what RFC 8785 §3.2.2 specifies.

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue | undefined };

export function canonicalize(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(v: unknown, seen: Set<object>): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new TypeError("JCS: non-finite numbers are not JSON");
      return JSON.stringify(v);
    case "string":
      return JSON.stringify(v);
    case "bigint":
      throw new TypeError("JCS: bigint is not a JSON value; convert to string first");
    case "object":
      break;
    default:
      throw new TypeError(`JCS: unsupported type ${typeof v}`);
  }
  const o = v as object;
  if (seen.has(o)) throw new TypeError("JCS: cyclic structure");
  seen.add(o);
  try {
    if (Array.isArray(o))
      return `[${o.map((x) => (x === undefined ? "null" : serialize(x, seen))).join(",")}]`;
    if (o instanceof Date) return JSON.stringify(o.toISOString());
    const keys = Object.keys(o)
      .filter((k) => (o as Record<string, unknown>)[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize((o as Record<string, unknown>)[k], seen)}`).join(",")}}`;
  } finally {
    seen.delete(o);
  }
}
