// port-contract matrix (PL2-D-13): which ports' contract legs run for a change. Per-port path
// filters on PRs; every port nightly and before a release (--all). Only ports with an adapter
// folder under packages/connectors/src/<port>/ have a leg to run.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export const PL2_PORTS = [
  "SECRETS",
  "KMS",
  "OBSERVABILITY",
  "FEATURE_FLAG",
  "IDENTITY",
  "AUTHZ",
  "STORAGE",
  "QUEUE",
  "WORKFLOW",
  "EMAIL",
  "SMS",
  "WHATSAPP",
  "PAYMENTS",
];

export const portDir = (port) => port.toLowerCase().replace(/_/g, "-");

/** A change under any of these paths runs every port. */
export const SHARED_PATHS = [
  "packages/connectors/src/core/",
  "packages/connectors/package.json",
  "packages/contracts/src/ports/common.ts",
  "packages/contracts/src/ports/payload-class.ts",
  "packages/contracts/src/routing.ts",
  "packages/testing/src/contract.ts",
  "packages/testing/src/containers.ts",
  "packages/testing/src/ports/",
  "packages/crypto/src/",
  "pnpm-lock.yaml",
  ".github/workflows/port-contract.yml",
  "scripts/port-matrix.mjs",
];

export const portPaths = (port) => [
  `packages/connectors/src/${portDir(port)}/`,
  `packages/contracts/src/ports/${portDir(port)}.ts`,
  `packages/testing/src/ports/${portDir(port)}`,
];

/** Ports to run for `changed` files; `all` selects every port; `has` says whether a port has adapters. */
export function selectPorts(changed, { all = false, has = () => true } = {}) {
  const shared = changed.some((f) => SHARED_PATHS.some((p) => f === p || f.startsWith(p)));
  const picked = PL2_PORTS.filter(
    (port) => all || shared || changed.some((f) => portPaths(port).some((p) => f.startsWith(p))),
  );
  return picked.filter(has);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const all = process.argv.includes("--all");
  const baseIdx = process.argv.indexOf("--base");
  const base = baseIdx > 0 ? process.argv[baseIdx + 1] : undefined;
  const changed =
    all || !base
      ? []
      : execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" })
          .split("\n")
          .filter(Boolean);
  const ports = selectPorts(changed, {
    all: all || !base,
    has: (p) => existsSync(`packages/connectors/src/${portDir(p)}`),
  });
  process.stdout.write(`ports=${JSON.stringify(ports)}\n`);
}
