// licence (IPB-09-07): every dependency's licence is on the allow-list.
// Reads `pnpm licenses list --json`; fails on copyleft or unknown licences unless listed in EXCEPTIONS.
import { execFileSync } from "node:child_process";

const ALLOW = new Set([
  "MIT",
  "ISC",
  "0BSD",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "Unlicense",
  "CC0-1.0",
  "CC-BY-3.0",
  "CC-BY-4.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "MPL-2.0",
  "Zlib",
  "WTFPL",
  "MIT-0",
]);
// Packages whose package.json lacks a licence field but whose repository carries an allowed licence.
const EXCEPTIONS = {
  spawndamnit:
    "MIT — LICENSE file in github.com/thejameskyle/spawndamnit; package.json has no license field",
};

const raw = execFileSync("pnpm", ["licenses", "list", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const byLicence = JSON.parse(raw);
let failures = 0;
for (const [licence, pkgs] of Object.entries(byLicence)) {
  // pnpm may report SPDX expressions such as "(MIT OR Apache-2.0)".
  const parts = licence.replace(/[()]/g, "").split(/\s+(?:OR|AND)\s+/);
  const ok = parts.some((p) => ALLOW.has(p));
  if (ok) continue;
  for (const p of pkgs) {
    if (EXCEPTIONS[p.name]) {
      console.log(`licence exception: ${p.name}@${p.versions.join(",")} — ${EXCEPTIONS[p.name]}`);
      continue;
    }
    console.error(
      `LICENCE FAIL: ${p.name}@${p.versions.join(",")} licence "${licence}" is not on the allow-list`,
    );
    failures++;
  }
}
if (failures) process.exit(1);
console.log("LICENCE OK");
