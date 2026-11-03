// Per-method KYC routing with fallback (Finbyx PR-FBX-24: Digio first, IDfy second; R1-D-45). The
// platform router fails over a whole port when its breaker opens; KYC vendors cover different
// methods, so this composite sends each method to the first adapter in its order that provides it.
// It moves to the next adapter only when one does not provide the method, is switched off, or is
// unavailable (`IPB-PORT-002`); a vendor's answer about the customer (a refusal, a not-found, a
// failed check) is final and never retried elsewhere. Each result names the adapter that gave it.
import { PortError, isIpbError } from "@infrabyx/contracts/errors";
import type { AdapterDescriptor, KycMethod, KycPort, PortHealth } from "@infrabyx/contracts/ports";

/** The port's method names by `KycMethod` (the `int.kyc.<method>.provider` vocabulary). */
export const KYC_METHOD_FNS = {
  pan: ["verifyPan"],
  aadhaar_offline: ["verifyAadhaarOffline"],
  digilocker: ["digilockerPull"],
  ckyc_search: ["ckycSearch"],
  ckyc_download: ["ckycDownload"],
  vcip: ["startVcip", "vcipStatus", "handleWebhook"],
  liveness: ["livenessCheck"],
  face_match: ["faceMatch"],
  bank_account: ["bankAccountVerify"],
  ovd_ocr: ["ovdOcr"],
  aml_screen: ["amlScreen"],
} as const satisfies Record<KycMethod, readonly (keyof KycPort)[]>;

type Fn = (typeof KYC_METHOD_FNS)[KycMethod][number];

/** Fall through on these refusals only: the adapter cannot take the call at all. */
const FALL_THROUGH = new Set(["unsupported", "adapter_disabled"]);

function passOn(e: unknown): boolean {
  if (!isIpbError(e)) return false;
  if (e.code === "IPB-PORT-002") return true;
  const reason = (e as { meta?: { reason?: unknown } }).meta?.reason;
  return e.code === "IPB-PORT-001" && typeof reason === "string" && FALL_THROUGH.has(reason);
}

export interface KycMethodRouterOptions {
  /** Adapters by name (their descriptor's `adapter`). */
  adapters: readonly KycPort[];
  /** The order per method, e.g. `{ pan: ["idfy-kyc"], digilocker: ["digio-kyc", "idfy-kyc"] }`. */
  order?: Partial<Record<KycMethod, readonly string[]>>;
  /** The order for every method not listed (default: `adapters` in the order given). */
  defaultOrder?: readonly string[];
}

/** A `KycPort` that routes each method to the first adapter in its order that can take it. */
export function kycMethodRouter(o: KycMethodRouterOptions): KycPort {
  const byName = new Map(o.adapters.map((a) => [a.descriptor.adapter, a]));
  const fallback = o.defaultOrder ?? o.adapters.map((a) => a.descriptor.adapter);
  for (const n of [...fallback, ...Object.values(o.order ?? {}).flat()])
    if (!byName.has(n)) throw new RangeError(`KYC routing names unknown adapter ${n}`);
  const methodOf = new Map<string, KycMethod>();
  for (const [m, fns] of Object.entries(KYC_METHOD_FNS))
    for (const f of fns) methodOf.set(f, m as KycMethod);

  const candidates = (fn: Fn): KycPort[] => {
    const names = o.order?.[methodOf.get(fn) as KycMethod] ?? fallback;
    return names
      .map((n) => byName.get(n) as KycPort)
      .filter((a) => a.descriptor.capabilities?.[fn] !== "unsupported");
  };

  const call = async (fn: Fn, args: unknown[]): Promise<unknown> => {
    const list = candidates(fn);
    let last: unknown;
    for (const a of list) {
      try {
        return await (a[fn] as (...x: unknown[]) => Promise<unknown>).apply(a, args);
      } catch (e) {
        if (!passOn(e)) throw e;
        last = e;
      }
    }
    throw (
      last ??
      new PortError("IPB-PORT-001", "KYC", {
        detail: `no routed KYC adapter provides ${fn}`,
        meta: { reason: "unsupported" },
      })
    );
  };

  const descriptor: AdapterDescriptor = {
    port: "KYC",
    adapter: "kyc-method-router",
    residency: "IN",
    maxDataClass: "REGULATED",
    capabilities: Object.fromEntries(
      Object.values(KYC_METHOD_FNS)
        .flat()
        .filter((fn) => candidates(fn).length === 0)
        .map((fn) => [fn, "unsupported"]),
    ),
  };

  const port = {
    descriptor,
    async health(): Promise<PortHealth> {
      const hs = await Promise.all(o.adapters.map((a) => a.health()));
      const up = hs.filter((h) => h.status === "up").length;
      return {
        status: up === hs.length ? "up" : up > 0 ? "degraded" : "down",
        latency_ms: Math.max(0, ...hs.map((h) => h.latency_ms)),
        checked_at: new Date().toISOString(),
      };
    },
  } as Record<string, unknown>;
  for (const fn of Object.values(KYC_METHOD_FNS).flat())
    port[fn] = (...args: unknown[]) => call(fn, args);
  return port as unknown as KycPort;
}
