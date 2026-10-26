// Sandbox-leg gate (PL2 plan §3.11, IPB-DEV-04). A sandbox leg reads IPB_TEST_SANDBOX_<NAME>
// variables, which CI maps from the GitHub `sandbox` environment. Locally and on PRs without the
// secrets the leg is skipped; when IPB_TEST_SANDBOX_REQUIRED=true (nightly and pre-release) a
// missing variable fails the run. Values are never printed; only missing names are.
import { z } from "zod";
import { envBool, envVar, validateEnv } from "@infrabyx/config/env";

export interface SandboxLeg<K extends string> {
  adapter: string;
  available: boolean;
  values: Record<K, string>;
  missing: K[];
}

export async function sandboxLeg<K extends string>(
  adapter: string,
  names: readonly K[],
): Promise<SandboxLeg<K>> {
  const shape: Record<string, z.ZodType> = {
    IPB_TEST_SANDBOX_REQUIRED: envVar(envBool().optional(), {
      desc: "Fail when a sandbox variable is missing (nightly, pre-release)",
      example: "false",
      required: "opt",
      sens: "C",
      port: "IPB",
    }),
  };
  for (const n of names)
    shape[`IPB_TEST_SANDBOX_${n}`] = envVar(z.string().min(1).optional(), {
      desc: `Sandbox credential or setting for ${adapter}`,
      example: "***",
      required: "opt",
      sens: "S",
      port: "IPB",
    });
  const r = await validateEnv(z.object(shape), { guards: [], defaultAppEnv: "test" });
  const env = (r.ok ? r.values : {}) as Record<string, unknown>;
  const values = {} as Record<K, string>;
  const missing: K[] = [];
  for (const n of names) {
    const v = env[`IPB_TEST_SANDBOX_${n}`];
    if (typeof v === "string" && v.length > 0) values[n] = v;
    else missing.push(n);
  }
  if (missing.length && env.IPB_TEST_SANDBOX_REQUIRED === true)
    throw new Error(
      `sandbox leg ${adapter}: missing ${missing.map((m) => `IPB_TEST_SANDBOX_${m}`).join(", ")} (open a port-contract issue; IPB-DEV-04)`,
    );
  return { adapter, available: missing.length === 0, values, missing };
}
