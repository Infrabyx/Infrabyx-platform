// provider_routing loader (IPB-01 §01.4.5, IPB-01-20). Files live at
// infra/routing/<product>/<env>.routing.yaml (`int.routing.file`); an invalid file refuses boot
// and CI with IPB-PORT-005. Secrets stay SECRETS paths and are resolved lazily by the router.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse } from "yaml";
import { PortError } from "@infrabyx/contracts/errors";
import {
  checkRouting,
  type RoutingCheckOptions,
  type RoutingFile,
} from "@infrabyx/contracts/routing";

export interface LoadedRouting {
  env: string;
  file: RoutingFile;
  policyFor: ReturnType<typeof checkRouting>["policyFor"];
}

/** `<env>.routing.yaml` → env. */
export function envFromRoutingPath(path: string): string {
  const m = /^([a-z][a-z0-9-]*)\.routing\.ya?ml$/.exec(basename(path));
  if (!m)
    throw new PortError("IPB-PORT-005", "routing", {
      detail: `routing file name must be <env>.routing.yaml: ${basename(path)}`,
    });
  return m[1] as string;
}

/** Adapters marked `unproven` in packages/connectors/sandbox-status.json (IPB-DEV-04 gate B). */
export async function loadUnprovenAdapters(statusPath: string): Promise<Set<string>> {
  const raw = JSON.parse(await readFile(statusPath, "utf8")) as {
    adapters?: Record<string, { status?: string }>;
  };
  return new Set(
    Object.entries(raw.adapters ?? {})
      .filter(([, v]) => v.status !== "proven")
      .map(([k]) => k),
  );
}

/** Read, parse and validate a routing file. Throws PortError IPB-PORT-005 with every problem. */
export async function loadRoutingFile(
  path: string,
  opts: Omit<RoutingCheckOptions, "env"> & { env?: string } = {},
): Promise<LoadedRouting> {
  const env = opts.env ?? envFromRoutingPath(path);
  let doc: unknown;
  try {
    doc = parse(await readFile(path, "utf8"));
  } catch (e) {
    throw new PortError("IPB-PORT-005", "routing", {
      detail: `${basename(path)} is not valid YAML`,
      cause: e,
    });
  }
  const { file, policyFor } = checkRouting(doc, { ...opts, env });
  return { env, file, policyFor };
}
