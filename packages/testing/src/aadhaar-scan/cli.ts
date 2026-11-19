#!/usr/bin/env node
// infrabyx-aadhaar-scan [--letters join|boundary] [--max-bytes N] <path>... (PR-UDF-042)
// Prints `file:line: KIND XXXX XXXX dddd` for each find; exits 1 on any find, 0 on none and 2 on a
// usage error (no path, an unknown option, a path that does not exist). Never prints a number.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AADHAAR_SCAN_MAX_BYTES, scanPathsForAadhaar } from "./index.js";

const USAGE =
  "usage: infrabyx-aadhaar-scan [--letters join|boundary] [--max-bytes N] <file or directory>...\n";

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        letters: { type: "string", default: "join" },
        "max-bytes": { type: "string", default: String(AADHAAR_SCAN_MAX_BYTES) },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const { positionals, values } = parsed;
  const letters = values.letters;
  const maxBytes = Number(values["max-bytes"]);
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
    r = await scanPathsForAadhaar(positionals, { letters, maxBytes });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
    process.stderr.write(`infrabyx-aadhaar-scan: no such file or directory: ${err.path}\n${USAGE}`);
    return 2;
  }
  for (const f of r.finds) process.stdout.write(`${f.file}:${f.line}: ${f.kind} ${f.masked}\n`);
  for (const s of r.skipped)
    process.stderr.write(`infrabyx-aadhaar-scan: skipped (${s.reason}): ${s.file}\n`);
  process.stderr.write(
    `infrabyx-aadhaar-scan: ${r.files} file(s), ${r.skipped.length} skipped, ${r.finds.length} find(s)\n`,
  );
  return r.finds.length ? 1 : 0;
}

// pnpm and npm run a bin through a symlink; Node resolves the module to its real path (PR-UDF-005).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e: unknown) => {
      process.stderr.write(`${(e as Error).message}\n`);
      process.exit(1);
    },
  );
}
