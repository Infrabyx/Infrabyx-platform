// `pnpm test:contract -- --port <PORT>`: the unit and hermetic contract legs of one port
// (port-contract.yml, PL2 plan §3.11). Contract tests live in src/<port-dir>/**/*.contract.test.ts;
// sandbox legs inside them skip themselves unless their IPB_TEST_SANDBOX_* variables are present.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const i = process.argv.indexOf("--port");
const port = i > 0 ? process.argv[i + 1] : undefined;
if (!port || !/^[A-Z][A-Z_]*$/.test(port)) {
  console.error("usage: test:contract -- --port <PORT>");
  process.exit(2);
}
const dir = `src/${port.toLowerCase().replace(/_/g, "-")}`;
if (!existsSync(dir)) {
  console.error(`${port}: no adapter folder ${dir}`);
  process.exit(1);
}
const r = spawnSync("vitest", ["run", dir], {
  stdio: "inherit",
  env: { ...process.env, INFRABYX_TEST_CONTRACT: "1" },
});
process.exit(r.status ?? 1);
