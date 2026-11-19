// Per-method KYC routing with fallback (Finbyx PR-FBX-24: Digio first, IDfy second; R1-D-45). The
// platform router fails over a whole port when its breaker opens; KYC vendors cover different
// methods, so this composite sends each method to the first adapter in its order that provides it.
// It moves to the next adapter only when one does not provide the method, is switched off, or is
// unavailable (`IPB-PORT-002`); a vendor's answer about the customer (a refusal, a not-found, a
// failed check) is final and never retried elsewhere. Each result names the adapter that gave it.
// Any method moves on when an adapter cannot honour the mode asked (`mode_unsupported`, refused
// before any vendor call: a bank account check's mode, PR-UDF-043; a liveness check's, PR-UDF-044).
// A keyed bank account check, liveness check or face match, and a penny drop, do not move on when
// an adapter is unavailable, as the first one may have reached its vendor: a key gets one answer,
// from one adapter, and an account is never verified, or credited, twice for one key. A V-CIP
// launch never moves on when its adapter is unavailable (PR-UDF-045): the hand-off is single use
// and the first adapter may have scheduled the session. A webhook refused `IPB-API-018`
// (`verifyWebhook`, `handleWebhook`) is final (PR-UDF-046); a product with two providers sends
// each provider's webhooks to that provider's adapter, not through the router.
import { PortError, isIpbError } from "@infrabyx/contracts/errors";
import {
  KYC_MODE_UNSUPPORTED,
  type AdapterDescriptor,
  type KycMethod,
  type KycPort,
  type PortHealth,
} from "@infrabyx/contracts/ports";

/** The port's method names by `KycMethod` (the `int.kyc.<method>.provider` vocabulary). */
export const KYC_METHOD_FNS = {
  pan: ["verifyPan"],
  aadhaar_offline: ["verifyAadhaarOffline"],
  digilocker: ["startDigilocker", "digilockerPull"],
  ckyc_search: ["ckycSearch"],
  ckyc_download: ["ckycDownload"],
  vcip: ["startVcip", "launchVcip", "vcipStatus", "verifyWebhook", "handleWebhook"],
  liveness: ["livenessCheck"],
  face_match: ["faceMatch"],
  bank_account: ["bankAccountVerify"],
  ovd_ocr: ["ovdOcr"],
  aml_screen: ["amlScreen"],
  // The verify goes to the adapter that sent the OTP as long as the order is the same (PR-UDF-041).
  aadhaar_otp: ["aadhaarOtpRequest", "aadhaarOtpVerify"],
} as const satisfies Record<KycMethod, readonly (keyof KycPort)[]>;

type Fn = (typeof KYC_METHOD_FNS)[KycMethod][number];

/** Fall through on these refusals only: the adapter cannot take the call at all. */
const FALL_THROUGH = new Set(["unsupported", "adapter_disabled"]);

/** Methods whose keyed call stays with its adapter when that one is unavailable (one answer per key). */
const KEYED_STAYS: ReadonlySet<Fn> = new Set(["bankAccountVerify", "livenessCheck", "faceMatch"]);

function passOn(e: unknown, fn: Fn, args: unknown[]): boolean {
  if (!isIpbError(e)) return false;
  const reason = (e as { meta?: { reason?: unknown } }).meta?.reason;
  if (e.code === "IPB-PORT-002") {
    if (fn === "launchVcip") return false;
    if (reason === KYC_MODE_UNSUPPORTED || !KEYED_STAYS.has(fn)) return true;
    const req = args[0] as { mode?: unknown } | undefined;
    const call = args[1] as { idempotencyKey?: unknown } | undefined;
    if (call?.idempotencyKey !== undefined) return false;
    return !(fn === "bankAccountVerify" && req?.mode === "penny_drop");
  }
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
      .filter(
        (a) =>
          a.descriptor.capabilities?.[fn] !== "unsupported" &&
          // An optional method an adapter outside the platform does not have (startDigilocker,
          // aadhaarOtpRequest, aadhaarOtpVerify, launchVcip, verifyWebhook).
          typeof a[fn] === "function",
      );
  };

  const call = async (fn: Fn, args: unknown[]): Promise<unknown> => {
    const list = candidates(fn);
    let last: unknown;
    for (const a of list) {
      try {
        return await (a[fn] as (...x: unknown[]) => Promise<unknown>).apply(a, args);
      } catch (e) {
        if (!passOn(e, fn, args)) throw e;
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
