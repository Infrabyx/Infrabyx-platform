#!/usr/bin/env node
// infrabyx-aadhaar-scan [--letters join|boundary] [--max-bytes N] [--allow e164_in,decimal] <path>...
// (PR-UDF-042; PR-UDF-063). Prints `file:line: KIND XXXX XXXX dddd` for each find. Never prints a
// number. Exit status:
//   0  every file was read and nothing was found;
//   1  at least one find;
//   2  nothing proven (fail closed): a usage error (no path, an unknown option or look-alike, a
//      path that does not exist), no file read at all (empty directories, or every file skipped),
//      or a file that could not be read.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AADHAAR_LOOK_ALIKES, type AadhaarLookAlike } from "@infrabyx/contracts/aadhaar";
import { AADHAAR_SCAN_MAX_BYTES, scanPathsForAadhaar } from "./index.js";

const USAGE =
  "usage: infrabyx-aadhaar-scan [--letters join|boundary] [--max-bytes N] [--allow e164_in,decimal] <file or directory>...\n";

const HELP = `${USAGE}
Sweeps files for what reads as an Aadhaar number or a VID (@infrabyx/contracts/aadhaar) and prints
file:line: KIND and the number masked (XXXX XXXX dddd) for each find.

  --letters join|boundary  join (default): a letter next to digits is part of the run (hashes,
                           base64); boundary: a letter bounds the digits, as the AI scrubber reads
  --max-bytes N            skip, and name, files over N bytes (default ${AADHAAR_SCAN_MAX_BYTES})
  --allow NAME[,NAME]      let a look-alike through (repeatable; default none, strict):
                           e164_in  "+91" and ten digits (an Indian E.164 phone number)
                           decimal  digits joined to a "." with a digit beyond it
                           The product's choice and risk: a number written that way is missed.

Exit status: 0 nothing found; 1 a find; 2 nothing proven: a usage error, no file read (empty
directories or every file skipped), or a file that could not be read.
`;

const fail = (msg: string): number => {
  process.stderr.write(`infrabyx-aadhaar-scan: ${msg}\n${USAGE}`);
  return 2;
};

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        letters: { type: "string", default: "join" },
        "max-bytes": { type: "string", default: String(AADHAAR_SCAN_MAX_BYTES) },
        allow: { type: "string", multiple: true, default: [] },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const { positionals, values } = parsed;
  if (values.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const letters = values.letters;
  const maxBytes = Number(values["max-bytes"]);
  const allow = values.allow.flatMap((a) => a.split(",")).map((a) => a.trim());
  const unknown = allow.filter((a) => !(AADHAAR_LOOK_ALIKES as readonly string[]).includes(a));
  if (unknown.length) return fail(`unknown look-alike: ${unknown.join(", ")}`);
  if (
    positionals.length === 0 ||
    (letters !== "join" && letters !== "boundary") ||
    !Number.isInteger(maxBytes) ||
    maxBytes < 1
  ) {
    process.stderr.write(USAGE);
    return 2;
  }
  let r;
  try {
    r = await scanPathsForAadhaar(positionals, {
      letters,
      maxBytes,
      allow: allow as AadhaarLookAlike[],
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return fail(`no such file or directory: ${err.path}`);
    // Anything else (a file that cannot be read) proves nothing either: fail closed, not 1.
    process.stderr.write(`infrabyx-aadhaar-scan: could not read: ${err.message}\n`);
    return 2;
  }
  for (const f of r.finds) process.stdout.write(`${f.file}:${f.line}: ${f.kind} ${f.masked}\n`);
  for (const s of r.skipped)
    process.stderr.write(`infrabyx-aadhaar-scan: skipped (${s.reason}): ${s.file}\n`);
  process.stderr.write(
    `infrabyx-aadhaar-scan: ${r.files} file(s), ${r.skipped.length} skipped, ${r.finds.length} find(s)${allow.length ? `; look-alikes let through: ${allow.join(", ")}` : ""}\n`,
  );
  if (r.finds.length) return 1;
  if (r.files === 0) {
    process.stderr.write("infrabyx-aadhaar-scan: no file read, so nothing is proven (exit 2)\n");
    return 2;
  }
  return 0;
}

// pnpm and npm run a bin through a symlink; Node resolves the module to its real path (PR-UDF-005).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(2);
    },
  );
}
