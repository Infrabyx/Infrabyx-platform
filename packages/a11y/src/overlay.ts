// Accessibility-overlay scan (IPB-06-22, `IPB-A11Y-003`, `@IPB-06-AT-12`). Overlays are banned:
// the scan fails on a known overlay vendor's domain or loader in build output or page config. The
// CMS reuses `scanText` when a page config is saved.
//
// Signatures are stored as parts and joined at run time, so this package's own build output (which
// a site may bundle) never contains a full signature and cannot trip the scan.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const DOMAINS: readonly (readonly string[])[] = [
  ["accessibe", "com"],
  ["acsbapp", "com"],
  ["acsbap", "com"],
  ["userway", "org"],
  ["audioeye", "com"],
  ["equalweb", "com"],
  ["reciteme", "com"],
  ["maxaccess", "io"],
  ["equally", "ai"],
  ["allyable", "com"],
  ["adally", "com"],
  ["truabilities", "com"],
  ["user1st", "info"],
  ["essentialaccessibility", "com"],
];

/** Vendor loader names that appear without the domain (self-hosted copies). */
const LOADERS: readonly (readonly string[])[] = [
  ["acsb", ".js"],
  ["userway", "widget"],
  ["audioeye", "-loader"],
];

export interface OverlayFinding {
  code: "IPB-A11Y-003";
  source: string;
  line: number;
  signature: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function overlaySignatures(extra: readonly string[] = []): string[] {
  return [...DOMAINS.map((p) => p.join(".")), ...LOADERS.map((p) => p.join("")), ...extra];
}

function patterns(extra: readonly string[]): { sig: string; re: RegExp }[] {
  return overlaySignatures(extra).map((sig) => ({
    sig,
    // A domain matches on its own or as a subdomain, never inside a longer host name.
    re: new RegExp(`(^|[^a-z0-9-])${escapeRe(sig.toLowerCase())}(?![a-z0-9-])`),
  }));
}

export function scanText(
  text: string,
  source: string,
  extra: readonly string[] = [],
): OverlayFinding[] {
  const pats = patterns(extra);
  const out: OverlayFinding[] = [];
  const lines = text.toLowerCase().split("\n");
  lines.forEach((l, i) => {
    for (const p of pats)
      if (p.re.test(l)) out.push({ code: "IPB-A11Y-003", source, line: i + 1, signature: p.sig });
  });
  return out;
}

const SCANNED = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
  ".json",
  ".css",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".jsx",
]);
const MAX_BYTES = 20 * 1024 * 1024;

/** Every text file under the given paths (`node_modules` skipped unless named directly). */
export function scanPaths(
  paths: readonly string[],
  extra: readonly string[] = [],
): OverlayFinding[] {
  const out: OverlayFinding[] = [];
  const walk = (p: string) => {
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f !== "node_modules") walk(join(p, f));
    } else if (SCANNED.has(extname(p).toLowerCase()) && st.size <= MAX_BYTES) {
      out.push(...scanText(readFileSync(p, "utf8"), p, extra));
    }
  };
  for (const p of paths) walk(p);
  return out;
}
