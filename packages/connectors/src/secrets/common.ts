// Shared SECRETS helpers (PL2 plan §6.1). Paths follow secrets/<env>/<port>/<adapter>/<key>
// (IPB-02 §02.4.4); an adapter configured with a prefix refuses any path outside it.
import { PortError } from "@infrabyx/contracts/errors";
import type { SecretMeta } from "@infrabyx/contracts/ports";

const PATH = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,511}$/;

export function checkPath(adapter: string, path: string, prefix?: string): void {
  if (!PATH.test(path) || path.includes("..") || path.includes("//") || path.endsWith("/"))
    throw new PortError("IPB-PORT-003", "SECRETS", { adapter, detail: "invalid secret path" });
  if (prefix && !path.startsWith(prefix))
    throw new PortError("IPB-PORT-003", "SECRETS", {
      adapter,
      detail: `secret path outside the configured prefix ${prefix}`,
    });
}

/** A secret the environment does not hold: a configuration gap, not an outage (no breaker trip). */
export const notFound = (adapter: string, path: string) =>
  new PortError("IPB-PORT-001", "SECRETS", {
    adapter,
    detail: "secret not found",
    meta: { reason: "not_found", path },
  });

/** SecretMeta as string tags or custom metadata (`ipb:*`), and back. */
export function metaToTags(meta: SecretMeta = {}): Record<string, string> {
  const t: Record<string, string> = { "ipb:data_class": "SECRET" };
  if (meta.owner) t["ipb:owner"] = meta.owner;
  if (meta.rotationDays !== undefined) t["ipb:rotation_days"] = String(meta.rotationDays);
  return t;
}

export function tagsToMeta(
  tags: Record<string, string | undefined>,
  lastRotated?: string,
): SecretMeta {
  const m: SecretMeta = { dataClass: "SECRET" };
  if (tags["ipb:owner"]) m.owner = tags["ipb:owner"];
  const days = Number(tags["ipb:rotation_days"]);
  if (Number.isFinite(days) && tags["ipb:rotation_days"] !== undefined) m.rotationDays = days;
  if (lastRotated) m.lastRotated = lastRotated;
  return m;
}
