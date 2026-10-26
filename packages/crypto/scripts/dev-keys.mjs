// Regenerate dev-keys.json (fingerprints only) from LocalKms. `--check` fails if the file differs.
import { readFileSync, writeFileSync } from "node:fs";
import { devKeyFingerprints } from "../dist/index.js";

const doc = {
  description:
    "Fingerprints of the LocalKms well-known dev keys (PL1-C-10). Values matching these, and the `local` KMS adapter, are refused in staging, demo, pre-prod, prod and dr (IPB-11-17). No key material is stored here.",
  keys: devKeyFingerprints(),
};
const out = JSON.stringify(doc, null, 2) + "\n";
const file = new URL("../dev-keys.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== out) {
    console.error("dev-keys.json is stale; run pnpm --filter @infrabyx/crypto dev-keys");
    process.exit(1);
  }
} else writeFileSync(file, out);
