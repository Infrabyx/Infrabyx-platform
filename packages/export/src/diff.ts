// `golden-archive-diff` (IPB-09-35, PL3 plan §7.4): compare an archive with the golden archive of the
// last release, file by file and byte for byte. Run-time values are normalised when the archive is
// built (`buildArchive({ normalise: true })`); the only part compared loosely is the ECDSA signature
// in `manifest.json.jws`, which differs on every signing, so only its header is compared.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readZip } from "./zip.js";

export interface ArchiveDifference {
  path: string;
  kind: "missing" | "unexpected" | "changed";
}

/**
 * Files of an archive keyed by their full path, root folder included: a ZIP, or a folder that
 * holds the extracted root folder (the committed golden archive).
 */
export function loadArchiveFiles(path: string): Map<string, Buffer> {
  if (statSync(path).isFile()) return readZip(readFileSync(path));
  const out = new Map<string, Buffer>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(path, p).split(sep).join("/"), readFileSync(p));
    }
  };
  walk(path);
  return out;
}

const comparable = (path: string, b: Buffer): Buffer =>
  path.endsWith("manifest.json.jws") ? Buffer.from(b.toString("utf8").split(".")[0] ?? "") : b;

export function diffArchives(
  actual: ReadonlyMap<string, Buffer>,
  golden: ReadonlyMap<string, Buffer>,
): ArchiveDifference[] {
  const out: ArchiveDifference[] = [];
  for (const p of [...new Set([...actual.keys(), ...golden.keys()])].sort()) {
    const a = actual.get(p);
    const g = golden.get(p);
    if (!a) out.push({ path: p, kind: "missing" });
    else if (!g) out.push({ path: p, kind: "unexpected" });
    else if (!comparable(p, a).equals(comparable(p, g))) out.push({ path: p, kind: "changed" });
  }
  return out;
}
