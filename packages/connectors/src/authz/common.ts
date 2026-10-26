// Shared AUTHZ behaviour (PL2 plan §6.6): deny by default, agents never decide, allow-only cache.
// - An AGT_* principal asking for approve/sign/disburse/delete/grant is denied here, before the PDP
//   (IPB-02-10; the kernel and the policy pack deny it too).
// - A PDP failure is a deny with IPB-AUTHZ-001 in `ref`, never an allow.
// - Allow decisions are cached for at most `int.authz.decision_cache_seconds` (≤ 5 s); denials never.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_FORBIDDEN_ACTIONS,
  type AuthzDecision,
  type AuthzPrincipal,
  type AuthzResource,
} from "@infrabyx/contracts/ports";
import { canonicalize, sha256Hex } from "@infrabyx/crypto";

export const MAX_ALLOW_CACHE_MS = 5_000;

export const isAgent = (p: AuthzPrincipal): boolean => p.roles.some((r) => r.startsWith("AGT_"));

/** The adapter-level agent rule; returns a deny or null to continue to the PDP. */
export function agentGuard(p: AuthzPrincipal, action: string): AuthzDecision | null {
  return isAgent(p) && (AGENT_FORBIDDEN_ACTIONS as readonly string[]).includes(action)
    ? { allowed: false, policy: "ipb.agents_never_decide" }
    : null;
}

export const pdpDown = (adapter: string): AuthzDecision => ({
  allowed: false,
  policy: "ipb.pdp_unavailable",
  ref: `IPB-AUTHZ-001:${adapter}`,
});

export class AllowCache {
  private readonly m = new Map<string, number>();
  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (ttlMs > MAX_ALLOW_CACHE_MS)
      throw new RangeError("allow decisions are cached for at most 5 s");
  }
  key(p: AuthzPrincipal, r: AuthzResource, action: string, ctx?: unknown): string {
    return sha256Hex(
      canonicalize({
        p,
        r: { kind: r.kind, id: r.id, attr: r.attr ?? {} },
        action,
        ctx: ctx ?? null,
      }),
    );
  }
  hit(k: string): boolean {
    const t = this.m.get(k);
    if (t === undefined) return false;
    if (this.now() - t > this.ttlMs) {
      this.m.delete(k);
      return false;
    }
    return true;
  }
  put(k: string, d: AuthzDecision): void {
    if (d.allowed && this.ttlMs > 0) this.m.set(k, this.now());
  }
}

/** The platform policy pack shipped in this package (`policy/`), as a `loadPolicies` bundle. */
export async function platformPolicyBundle(
  engine: "cerbos" | "openfga",
): Promise<{ version: string; files: Record<string, string> }> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../policy", engine);
  const files: Record<string, string> = {};
  for (const f of (await readdir(dir)).sort()) files[f] = await readFile(join(dir, f), "utf8");
  return { version: sha256Hex(canonicalize(files)).slice(0, 16), files };
}
