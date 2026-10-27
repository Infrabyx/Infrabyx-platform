// Per-host brand map (IPB-04-29, `@IPB-04-AT-27`). The pack is chosen from the `Host` header
// against published hosts only. `X-Forwarded-Host` never selects a pack: when it differs from
// `Host` the request is treated as a spoof attempt and logged. An unknown host gets the product's
// default pack with `noindex` and `IPB-BRD-007` is logged.

export interface HostMapEntry {
  host: string;
  packId: string;
}

export interface HostResolution {
  packId: string;
  /** True when the default pack was served for a host no pack claims. */
  noindex: boolean;
  /** Security and audit signals for the caller to log (never shown to the visitor). */
  events: { code: "IPB-BRD-007" | "forwarded_host_mismatch" | "invalid_host"; detail: string }[];
}

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Lower case, no port, no trailing dot; null when it is not a host name. */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return HOST.test(h) ? h : null;
}

export function resolveHost(
  map: readonly HostMapEntry[],
  defaultPackId: string,
  headers: { host: string | null | undefined; forwardedHost?: string | null | undefined },
): HostResolution {
  const events: HostResolution["events"] = [];
  const host = normaliseHost(headers.host);
  if (headers.forwardedHost != null) {
    const fwd = normaliseHost(headers.forwardedHost.split(",")[0]);
    if (fwd !== host)
      events.push({
        code: "forwarded_host_mismatch",
        detail: `X-Forwarded-Host ${headers.forwardedHost} differs from Host ${headers.host ?? ""}`,
      });
  }
  if (!host) {
    events.push({
      code: "invalid_host",
      detail: `Host header ${headers.host ?? "(none)"} is not a host name`,
    });
    return { packId: defaultPackId, noindex: true, events };
  }
  const hit = map.find((m) => m.host === host);
  if (!hit) {
    events.push({
      code: "IPB-BRD-007",
      detail: `unknown host ${host}; default pack served with noindex`,
    });
    return { packId: defaultPackId, noindex: true, events };
  }
  return { packId: hit.packId, noindex: false, events };
}
