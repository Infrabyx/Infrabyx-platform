// licence (IPB-09-07): every dependency's licence is on the allow-list.
// Reads `pnpm licenses list --json`; fails on copyleft or unknown licences unless listed in EXCEPTIONS
// or matched by a FAMILY_EXCEPTIONS entry. An SPDX "OR" needs one allowed choice; "AND" needs every
// part allowed.
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
  unionfs:
    "Unlicense — LICENSE file in the published package (github.com/streamich/unionfs); package.json has no license field; via @temporalio/worker",
};

// Package families granted a licence exception by the owner, each limited to one licence.
const FAMILY_EXCEPTIONS = [
  {
    // OWNER-QUESTIONS #53 (PL5-D-11): the unmodified, dynamically loaded libvips binaries, used only
    // through `sharp` behind the MEDIA port. Never modified, vendored or statically linked (the
    // wasm32 builds, which link libvips statically, carry "Apache-2.0 AND LGPL-3.0-or-later" and
    // still fail). NOTICE names libvips and its licence.
    name: /^@img\/sharp-libvips-[a-z0-9]+(?:-[a-z0-9]+)*$/,
    licence: "LGPL-3.0-or-later",
    reason:
      "OWNER-QUESTIONS #53: unmodified, dynamically loaded libvips through sharp (MEDIA port)",
  },
];

/** True when an SPDX expression (without WITH clauses) is satisfied by the allow-list. */
function licenceAllowed(expr) {
  return expr
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/)
    .some((choice) =>
      choice
        .split(/\s+AND\s+/)
        .map((p) => p.trim())
        .every((p) => ALLOW.has(p)),
    );
}

const raw = execFileSync("pnpm", ["licenses", "list", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const byLicence = JSON.parse(raw);
let failures = 0;
for (const [licence, pkgs] of Object.entries(byLicence)) {
  // pnpm may report SPDX expressions such as "(MIT OR Apache-2.0)".
  if (licenceAllowed(licence)) continue;
  for (const p of pkgs) {
    const family = FAMILY_EXCEPTIONS.find((f) => f.name.test(p.name) && f.licence === licence);
    if (family) {
      console.log(`licence exception: ${p.name}@${p.versions.join(",")} — ${family.reason}`);
      continue;
    }
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
