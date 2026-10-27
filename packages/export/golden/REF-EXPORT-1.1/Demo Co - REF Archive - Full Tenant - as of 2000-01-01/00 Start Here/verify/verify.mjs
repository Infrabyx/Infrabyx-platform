#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Infrabyx
//
// Offline verifier for an Infrabyx archive (archive standard 1.0). It needs only Node.js 20 or
// later and no network. It checks:
//   1. every file listed in "00 Start Here/manifest.json" exists with the listed size and SHA-256,
//      and no other file is present (besides manifest.json, manifest.json.jws, export-manifest.csv);
//   2. the pack-level SHA-256 over the sorted "path sha256" lines;
//   3. the detached JWS signature in manifest.json.jws over manifest.json (ES256), with the public
//      key in "00 Start Here/verify/export-signing-key.jwk.json" (compare its fingerprint with the
//      one printed in README.txt);
//   4. each dataset CSV's header against its JSON Schema, and its row count against the control
//      totals;
//   5. the audit trail hash chain (entry_hash = sha256(prev_hash "\n" JCS(entry))), month by month.
//
// Usage: node verify.mjs [path to the archive folder]   (default: two folders up from this file)
// Exit code 0 when every check passes, 1 otherwise.
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, "..", ".."));
const start = join(root, "00 Start Here");
const failures = [];
const fail = (m) => failures.push(m);
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const b64u = (b) => Buffer.from(b).toString("base64url");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(relative(root, p).split(sep).join("/"));
  }
  return out;
}

/** RFC 8785 for the JSON this archive contains (strings, integers, booleans, null, arrays, objects). */
function jcs(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jcs).join(",")}]`;
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(",")}}`;
}

function csvHeader(buf) {
  let s = buf.toString("utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const line = s.slice(0, s.indexOf("\r\n"));
  return line.split(",").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
}

function csvRowCount(buf) {
  let s = buf.toString("utf8");
  let rows = 0;
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (!inQuote && c === "\n") rows += 1;
  }
  return rows - 1;
}

const manifestBytes = readFileSync(join(start, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const RESERVED = new Set([
  "00 Start Here/manifest.json",
  "00 Start Here/manifest.json.jws",
  "00 Start Here/export-manifest.csv",
]);

// 1. Files, sizes and hashes.
const listed = new Map(manifest.files.map((f) => [f.path, f]));
for (const f of manifest.files) {
  let b;
  try {
    b = readFileSync(join(root, ...f.path.split("/")));
  } catch {
    fail(`missing file: ${f.path}`);
    continue;
  }
  if (b.length !== f.bytes) fail(`size differs: ${f.path}`);
  if (sha256(b) !== f.sha256) fail(`SHA-256 differs: ${f.path}`);
}
for (const p of walk(root)) if (!listed.has(p) && !RESERVED.has(p)) fail(`unlisted file: ${p}`);

// 2. Pack hash.
const lines = [...manifest.files]
  .map((f) => `${f.path} ${f.sha256}\n`)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  .join("");
if (sha256(Buffer.from(lines, "utf8")) !== manifest.pack_sha256) fail("pack SHA-256 differs");

// 3. Signature.
try {
  const jws = readFileSync(join(start, "manifest.json.jws"), "utf8").trim();
  const [h, p, s] = jws.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  const jwk = JSON.parse(
    readFileSync(join(start, "verify", "export-signing-key.jwk.json"), "utf8"),
  );
  if (p !== "" || header.alg !== "ES256") fail("manifest.json.jws is not a detached ES256 JWS");
  else if (header.kid !== manifest.signature.kid || header.kid !== jwk.kid)
    fail("the signing key id does not match the manifest");
  else {
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
      format: "jwk",
    });
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${b64u(manifestBytes)}`, "ascii"),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(s, "base64url"),
    );
    if (!ok) fail("the manifest signature does not verify");
  }
} catch (e) {
  fail(`signature check failed: ${e.message}`);
}

// 4. CSV headers and row counts.
for (const f of manifest.files) {
  const m = /^01 Data\/([a-z0-9_]+)\.csv$/.exec(f.path);
  if (!m) continue;
  const name = m[1];
  const csv = readFileSync(join(root, ...f.path.split("/")));
  const schema = JSON.parse(readFileSync(join(start, "schemas", `${name}.schema.json`), "utf8"));
  const header = csvHeader(csv);
  if (header.join(",") !== Object.keys(schema.properties).join(","))
    fail(`CSV header does not match its schema: ${name}`);
  const total = manifest.control_totals[name];
  if (total !== undefined && csvRowCount(csv) !== total)
    fail(`row count differs from control totals: ${name}`);
}

// 5. Audit chain.
const HASHED = [
  "action",
  "actor_id",
  "actor_type",
  "after_digest",
  "before_digest",
  "corrects_id",
  "id",
  "ip_hash",
  "occurred_at",
  "resource_id",
  "resource_type",
  "seq",
  "tenant_id",
  "trace_id",
  "ua_hash",
];
const audit = manifest.files
  .map((f) => f.path)
  .filter((p) => /^02 Audit Trail\/audit-events-\d{4}-\d{2}\.jsonl$/.test(p))
  .sort();
let prev = null;
let count = 0;
for (const p of audit) {
  for (const line of readFileSync(join(root, ...p.split("/")), "utf8").split("\n")) {
    if (!line) continue;
    const e = JSON.parse(line);
    count += 1;
    if (prev && e.prev_hash !== prev.entry_hash) fail(`audit chain broken before seq ${e.seq}`);
    if (prev && e.seq !== prev.seq + 1) fail(`audit sequence gap before seq ${e.seq}`);
    const body = {};
    for (const k of HASHED) body[k] = e[k];
    if (sha256(Buffer.from(`${e.prev_hash}\n${jcs(body)}`, "utf8")) !== e.entry_hash)
      fail(`audit entry hash differs at seq ${e.seq}`);
    prev = e;
  }
}
if (
  manifest.control_totals.audit_event !== undefined &&
  count !== manifest.control_totals.audit_event
)
  fail("audit event count differs from control totals");

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(
  `OK: ${manifest.files.length} files, signature, control totals and ${count} audit events verified`,
);
