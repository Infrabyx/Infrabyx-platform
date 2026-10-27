// Archive writer, ZIP and the offline verifier (PL3 plan §7.2, PL3-D-22).
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalKms, sha256Hex, verifyDetachedJws } from "@infrabyx/crypto";
import { buildArchive, safeName, type ArchiveInput } from "./archive.js";
import { REF_EXPORT_MAP } from "./maps.js";
import { readZip, writeZip } from "./zip.js";
import { kmsArchiveSigner } from "./service.js";

const kms = new LocalKms();
const tmp = mkdtempSync(join(tmpdir(), "ipb-export-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const col = (name: string, pgType = "text", nullable = false, dataClass = "INTERNAL") => ({
  name,
  pgType,
  nullable,
  dataClass,
});

async function input(over: Partial<ArchiveInput> = {}): Promise<ArchiveInput> {
  const t0 = new Date("2026-10-27T10:00:00.000Z");
  return {
    map: REF_EXPORT_MAP,
    archiveId: "arc_01M5XQT0PRXMKBEGFFSHNHTA61",
    tenantId: "tnt_demo",
    ownerName: 'Demo: Co / "Ltd".',
    product: "REF",
    release: "0.1.0",
    scope: { type: "FULL_TENANT", ref: null },
    requester: "sha256:abc",
    approvers: [],
    asOf: t0,
    predecessorArchiveId: null,
    datasets: [
      {
        name: "tenant",
        source: "tenancy.tenant",
        columns: [
          col("id"),
          col("product"),
          col("name"),
          col("status"),
          col("residency"),
          col("created_at", "timestamp with time zone"),
        ],
        rows: [
          {
            id: "tnt_demo",
            product: "LD",
            name: "Demo, Co",
            status: "active",
            residency: "IN",
            created_at: t0,
          },
        ],
      },
      {
        name: "membership",
        source: "tenancy.membership",
        columns: [
          col("user_id"),
          col("roles", "ARRAY"),
          col("entity_ids", "ARRAY"),
          col("created_at", "timestamp with time zone"),
        ],
        rows: [
          { user_id: "usr_b", roles: ["ORG_MEMBER"], entity_ids: [], created_at: t0 },
          { user_id: "usr_a", roles: ["ORG_OWNER"], entity_ids: [], created_at: t0 },
        ],
      },
      {
        name: "audit_event",
        source: "audit.ledger",
        columns: REF_EXPORT_MAP.entities.audit_event!.fields.map((f) =>
          col(
            f,
            f === "seq" ? "integer" : f === "occurred_at" ? "timestamp with time zone" : "text",
            /digest|corrects|trace|ip_hash|ua_hash/.test(f),
          ),
        ),
        rows: chain(3),
      },
    ],
    signer: await kmsArchiveSigner(kms, "local:sign:export"),
    ...over,
  };
}

/** A valid hash chain of `n` entries, computed as the audit trigger does. */
function chain(n: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let prev = "0".repeat(64);
  for (let i = 1; i <= n; i++) {
    const e: Record<string, unknown> = {
      id: `led_${String(i).padStart(26, "0")}`,
      tenant_id: "tnt_demo",
      seq: i,
      actor_id: "usr_a",
      actor_type: "user",
      action: "tenancy.member.add",
      resource_type: "membership",
      resource_id: `usr_${i}`,
      before_digest: null,
      after_digest: null,
      corrects_id: null,
      trace_id: null,
      ip_hash: null,
      ua_hash: null,
      occurred_at: new Date(Date.UTC(2026, 8 + Math.floor(i / 3), 1, 0, 0, i)),
    };
    const body = Object.fromEntries(
      Object.keys(e)
        .sort()
        .map((k) => [k, e[k] instanceof Date ? (e[k] as Date).toISOString() : e[k]]),
    );
    e.prev_hash = prev;
    e.entry_hash = sha256Hex(`${prev}\n${JSON.stringify(body)}`);
    prev = e.entry_hash as string;
    out.push(e);
  }
  return out;
}

function extract(zip: Buffer): string {
  const dir = mkdtempSync(join(tmp, "x-"));
  for (const [p, b] of readZip(zip)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), b);
  }
  return dir;
}

const runVerifier = (dir: string, root: string): { ok: boolean; out: string } => {
  try {
    const out = execFileSync(
      process.execPath,
      [join(dir, root, "00 Start Here", "verify", "verify.mjs")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String((e as { stderr?: string }).stderr ?? e) };
  }
};

describe("ZIP writer", () => {
  it("is deterministic and round-trips UTF-8 names", () => {
    const files = new Map([
      ["b/é.txt", Buffer.from("héllo".repeat(100))],
      ["a.txt", Buffer.from("x")],
    ]);
    const a = writeZip(files);
    expect(writeZip(new Map([...files].reverse()))).toEqual(a);
    expect([...readZip(a)]).toEqual([...files].sort(([x], [y]) => (x < y ? -1 : 1)));
  });
});

describe("archive writer (Ecosystem §12.1, archive standard 1.0)", () => {
  it("lays out 00 Start Here, datasets and the audit trail with Windows-safe names", async () => {
    const a = await buildArchive(await input());
    expect(a.root).toBe("Demo Co Ltd - REF Archive - Full Tenant - as of 2026-10-27");
    const paths = [...a.files.keys()];
    for (const p of [
      "00 Start Here/README.txt",
      "00 Start Here/README.md",
      "00 Start Here/export-manifest.csv",
      "00 Start Here/manifest.json",
      "00 Start Here/manifest.json.jws",
      "00 Start Here/data-dictionary.csv",
      "00 Start Here/relationships.csv",
      "00 Start Here/code-tables/risk_class.csv",
      "00 Start Here/schemas/tenant.schema.json",
      "00 Start Here/verify/verify.mjs",
      "00 Start Here/verify/LICENSE.txt",
      "01 Data/tenant.csv",
      "01 Data/membership.jsonl",
      "02 Audit Trail/audit-events-2026-09.jsonl",
      "02 Audit Trail/audit-events-2026-10.jsonl",
    ])
      expect(paths).toContain(p);
    for (const p of paths) {
      expect(`${a.root}/${p}`.length).toBeLessThanOrEqual(240);
      expect(p).not.toMatch(/[\\:*?"<>|]/);
    }
    expect(safeName("a/b: c. ")).toBe("a b c");
  });

  it("writes RFC 4180 CSV with a BOM, rows sorted by id, code labels beside codes", async () => {
    const a = await buildArchive(await input());
    const csv = a.files.get("01 Data/tenant.csv")!.toString("utf8");
    expect(csv.startsWith("﻿id,product,name,status,residency,residency_label,created_at\r\n")).toBe(
      true,
    );
    expect(csv).toContain('tnt_demo,LD,"Demo, Co",active,IN,India,2026-10-27T10:00:00.000Z\r\n');
    const members = a.files.get("01 Data/membership.jsonl")!.toString("utf8").trim().split("\n");
    expect(members.map((l) => JSON.parse(l).user_id)).toEqual(["usr_a", "usr_b"]);
  });

  it("signs manifest.json with a detached ES256 JWS (C-22) and lists every other file with its hash", async () => {
    const a = await buildArchive(await input());
    const spki = await kms.getPublicKey("local:sign:export");
    expect(verifyDetachedJws(a.jws, a.manifestBytes, spki)).toEqual({
      ok: true,
      kid: "local:sign:export",
    });
    const listed = a.manifest.files.map((f) => f.path);
    expect(listed).not.toContain("00 Start Here/manifest.json");
    expect(listed).not.toContain("00 Start Here/export-manifest.csv");
    expect(a.manifest.control_totals).toMatchObject({
      tenant: 1,
      membership: 2,
      audit_event: 3,
      "audit_event.last_seq": 3,
    });
    for (const f of a.manifest.files) expect(sha256Hex(a.files.get(f.path)!)).toBe(f.sha256);
  });

  it("is byte-identical for the same input, so a re-download has the same hash (IPB-09-37)", async () => {
    const i = await input();
    const [x, y] = [await buildArchive(i), await buildArchive(i)];
    for (const [p, b] of x.files) if (!p.endsWith(".jws")) expect(y.files.get(p)).toEqual(b);
    expect(x.manifestHash).toBe(y.manifestHash);
  });

  it("the README names every top-level folder, and every folder it names exists", async () => {
    const a = await buildArchive(await input());
    const readme = a.files.get("00 Start Here/README.txt")!.toString("utf8");
    const top = new Set([...a.files.keys()].map((p) => p.split("/")[0]));
    for (const f of top) expect(readme).toContain(`${f}:`);
    for (const m of readme.matchAll(/(\d{2} [A-Z][A-Za-z ]+?):/g))
      expect(top.has(m[1]!)).toBe(true);
  });

  it("the offline verifier passes on the archive and fails on a changed file or signature", async () => {
    const a = await buildArchive(await input());
    const dir = extract(a.zip);
    const ok = runVerifier(dir, a.root);
    expect(ok.out).toContain("OK:");
    expect(ok.ok).toBe(true);
    writeFileSync(join(dir, a.root, "01 Data", "tenant.csv"), "tampered");
    expect(runVerifier(dir, a.root).out).toMatch(/SHA-256 differs: 01 Data\/tenant.csv/);
    const dir2 = extract(a.zip);
    writeFileSync(
      join(dir2, a.root, "00 Start Here", "manifest.json.jws"),
      a.jws.replace(/.{4}$/, "AAAA"),
    );
    expect(runVerifier(dir2, a.root).out).toMatch(/signature does not verify/);
  });

  it("the verifier catches a broken audit chain", async () => {
    const rows = chain(3);
    rows[1]!.action = "tenancy.member.remove";
    const i = await input();
    i.datasets = i.datasets.map((d) => (d.name === "audit_event" ? { ...d, rows } : d));
    const a = await buildArchive(i);
    expect(runVerifier(extract(a.zip), a.root).out).toMatch(/audit entry hash differs at seq 2/);
  });

  it("normalises run-time timestamps, ids and hashes for the golden archive", async () => {
    const a = await buildArchive({ ...(await input()), normalise: true });
    expect(a.manifest.archive_id).toBe("arc_00000000000000000000000000");
    expect(a.manifest.as_of).toBe("2000-01-01T00:00:00.000Z");
    const audit = a.files.get("02 Audit Trail/audit-events-2000-01.jsonl")!.toString("utf8");
    expect(audit).not.toMatch(/led_0000/);
    expect(audit).toContain('"entry_hash":"' + "0".repeat(64));
  });
});
