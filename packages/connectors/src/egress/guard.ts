// The shared SSRF guard of the EGRESS adapters (IPB-02-43; @IPB-04-AT-94; R1-D-176, R1-D-250):
// the public-address check, the host-name rule and the DNS pin, used by `governed` (a user-supplied
// URL, hop by hop) and by `PartnerMtlsClient` (a configured partner over mTLS). Moved here
// unchanged from `governed.ts` so both keep one copy of the address ranges.
//
// Refused addresses: IPv4 outside the public unicast space (the IANA IPv4 Special-Purpose Address
// Registry, RFC 6890 / BCP 153, every block whether or not marked globally reachable, plus
// multicast 224.0.0.0/4 and the reserved 240.0.0.0/4); IPv6 outside global unicast 2000::/3 (so
// loopback, unspecified, IPv4-mapped and -compatible, NAT64 64:ff9b::/96 and 64:ff9b:1::/48,
// discard 100::/64, ULA fc00::/7, link-local fe80::/10, site-local fec0::/10, SRv6 5f00::/16 and
// multicast ff00::/8 are all out), and inside it the IETF protocol assignments 2001::/23 (Teredo
// 2001::/32 included), documentation 2001:db8::/32 and 3fff::/20 (RFC 9637), and 6to4 2002::/16.
// Source: RFC 6890 and the IANA IPv4 and IPv6 Special-Purpose Address Registries as known on
// 18 Nov 2026 [VERIFY: www.iana.org was not reachable from the build session; re-check the two
// registries at the next review and add any new block].
import { BlockList, isIP, type LookupFunction } from "node:net";

const V4_REFUSED: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private-use
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata 169.254.169.254)
  ["172.16.0.0", 12], // private-use
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation (TEST-NET-1)
  ["192.31.196.0", 24], // AS112-v4
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // private-use
  ["192.175.48.0", 24], // direct delegation AS112 service
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation (TEST-NET-2)
  ["203.0.113.0", 24], // documentation (TEST-NET-3)
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and the limited broadcast 255.255.255.255
];
const V6_REFUSED_IN_GLOBAL: ReadonlyArray<readonly [string, number]> = [
  ["2001::", 23], // IETF protocol assignments (Teredo 2001::/32, benchmarking, ORCHID…)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["3fff::", 20], // documentation (RFC 9637)
];

const refused = new BlockList();
for (const [a, p] of V4_REFUSED) refused.addSubnet(a, p, "ipv4");
for (const [a, p] of V6_REFUSED_IN_GLOBAL) refused.addSubnet(a, p, "ipv6");
const globalUnicast = new BlockList();
globalUnicast.addSubnet("2000::", 3, "ipv6");

/** Whether an address may be connected to: public unicast only (see the header). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !refused.check(address, "ipv4");
  if (family === 6) {
    const a = address.toLowerCase().split("%")[0]!;
    return globalUnicast.check(a, "ipv6") && !refused.check(a, "ipv6");
  }
  return false;
}

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * The host-name rule: never an IP literal (an allow-list names hosts), at least two labels of
 * letters, digits and inner hyphens. Answers the name lower-cased without a trailing dot, or the
 * refusal label.
 */
export function checkPublicHostName(
  hostname: string,
): { ok: true; host: string } | { ok: false; reason: "ip_literal" | "host" } {
  const host = hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) return { ok: false, reason: "ip_literal" };
  const labels = host.endsWith(".") ? host.slice(0, -1).split(".") : host.split(".");
  if (labels.length < 2 || !labels.every((l) => HOST_LABEL.test(l)))
    return { ok: false, reason: "host" };
  return { ok: true, host: labels.join(".") };
}

/** One DNS answer. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * Whether every answer may be connected to. One refused address refuses them all, because a mixed
 * answer is how DNS rebinding is staged. `loopbackOk` admits 127.0.0.1 and ::1 for a local test
 * stub only; a deployment never sets it.
 */
export function allAddressesPublic(
  answers: readonly ResolvedAddress[],
  loopbackOk = false,
): boolean {
  if (answers.length === 0) return false;
  return answers.every(
    (a) =>
      isPublicAddress(a.address) ||
      (loopbackOk && (a.address === "127.0.0.1" || a.address === "::1")),
  );
}

/** The address a connection is pinned to: the first checked answer. */
export function pinOf(answers: readonly ResolvedAddress[]): { address: string; family: 4 | 6 } {
  const first = answers[0]!;
  return { address: first.address, family: isIP(first.address) === 6 ? 6 : 4 };
}

/**
 * A `lookup` for `node:https` that answers only the checked address, so the socket goes to it and
 * a second resolution (DNS rebinding) cannot move it; TLS still verifies the host name.
 */
export function pinnedLookup(pinned: { address: string; family: 4 | 6 }): LookupFunction {
  return (_host, opts, cb) => {
    if ((opts as { all?: boolean }).all)
      (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [
        pinned,
      ]);
    else cb(null, pinned.address, pinned.family);
  };
}
