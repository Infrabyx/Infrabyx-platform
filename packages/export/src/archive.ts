// Archive writer (Ecosystem §12.1, archive standard 1.0; PL3 plan §7.2, PL3-D-22). Pure: rows, column
// metadata and run-time values come in, a folder tree, its signed manifest and a deterministic ZIP
// come out. The same input always gives the same bytes (except the ECDSA signature), which is what
// the golden-archive diff (IPB-09-35) and download-hash stability (IPB-09-37) rely on.
import { readFileSync } from "node:fs";
import { ArchiveManifestV1, type ExportMap } from "@infrabyx/contracts/export";
import {
  canonicalize,
  sha256Hex,
  signDetachedJws,
  type DerSigner,
  type Es256PublicJwk,
} from "@infrabyx/crypto";
import { CODE_TABLES, labelColumn } from "./code-tables.js";
import { toCsv, toJsonl } from "./csv.js";
import { writeZip } from "./zip.js";

export const ARCHIVE_STANDARD_VERSION = "1.0";
export const FOLDER_PROFILE = "platform_reference_v1";
export const START = "00 Start Here";
export const DATA = "01 Data";
export const AUDIT = "02 Audit Trail";
/** The run-time values a normalised (golden) archive uses instead of real ones (IPB-09-35). */
export const NORMALISED = {
  archiveId: "arc_00000000000000000000000000",
  instant: new Date("2000-01-01T00:00:00.000Z"),
  requester: "normalised",
  hash: "0".repeat(64),
} as const;

export interface ColumnInfo {
  name: string;
  /** PostgreSQL type name (`information_schema.columns.data_type`). */
  pgType: string;
  nullable: boolean;
  /** From the column's `dataclass:` comment (IPB-02-19). */
  dataClass: string;
}

export interface DatasetInput {
  /** Map entity name. */
  name: string;
  source: string;
  columns: readonly ColumnInfo[];
  rows: ReadonlyArray<Record<string, unknown>>;
}

export interface Relationship {
  fromDataset: string;
  fromField: string;
  toDataset: string;
  toField: string;
}

export interface ArchiveSigner {
  /** KMS key id of the platform export-signing key (`kid`, C-22). */
  kid: string;
  sign: DerSigner;
  publicJwk: Es256PublicJwk;
}

export interface ArchiveInput {
  map: ExportMap;
  archiveId: string;
  tenantId: string;
  /** Owner legal name for the root folder (sanitised; no personal data in other names). */
  ownerName: string;
  product: string;
  release: string;
  scope: { type: ArchiveManifestV1["scope"]["type"]; ref: string | null };
  /** Hashed principal ids (`ids_only`). */
  requester: string;
  approvers: readonly string[];
  asOf: Date;
  predecessorArchiveId: string | null;
  datasets: readonly DatasetInput[];
  relationships?: readonly Relationship[];
  signer: ArchiveSigner;
  /** Replace run-time timestamps, ids and hashes (the golden-archive normalisers). */
  normalise?: boolean;
}

export interface BuiltArchive {
  /** Root folder name, also the top folder inside the ZIP. */
  root: string;
  /** Every file, keyed by its path below the root. */
  files: Map<string, Buffer>;
  manifest: ArchiveManifestV1;
  manifestBytes: Buffer;
  jws: string;
  zip: Buffer;
  sha256: string;
  manifestHash: string;
}

const AUDIT_ENTITY = "audit_event";
const TIME_TYPES = /^(timestamp|date|time)/;
const WINDOWS_UNSAFE = /[\\/:*?"<>|]/g;

/** Plain, Windows-safe, NFC folder or file name segment (Ecosystem §12.1 naming). */
export function safeName(s: string, max = 80): string {
  const visible = [...s.normalize("NFC")]
    .map((ch) => (ch.charCodeAt(0) < 0x20 ? " " : ch))
    .join("");
  const n = visible.replace(WINDOWS_UNSAFE, " ").replace(/\s+/g, " ").trim();
  return n.slice(0, max).replace(/[. ]+$/, "") || "Unnamed";
}

const SCOPE_LABEL: Record<string, string> = {
  DATASET: "Dataset",
  LEGAL_ENTITY: "Legal Entity",
  MODULE: "Module",
  AUDIT_PACK: "Audit Pack",
  RE_PACK: "RE Pack",
  FULL_TENANT: "Full Tenant",
  EXIT: "Exit",
};

function jsonType(c: ColumnInfo): Record<string, unknown> {
  const t = c.pgType;
  let s: Record<string, unknown>;
  if (TIME_TYPES.test(t)) s = { type: "string", format: t === "date" ? "date" : "date-time" };
  else if (t === "integer" || t === "smallint") s = { type: "integer" };
  else if (t === "bigint" || t === "numeric")
    s = { type: "string", pattern: "^-?[0-9]+(\\.[0-9]+)?$" };
  else if (t === "boolean") s = { type: "boolean" };
  else if (t === "ARRAY") s = { type: "array", items: { type: "string" } };
  else if (t === "jsonb" || t === "json") s = {};
  else s = { type: "string" };
  if (c.nullable && typeof s.type === "string") s.type = [s.type, "null"];
  return { ...s, "x-dataclass": c.dataClass };
}

/** Output columns of a dataset: each column, then `<column>_label` where a code table exists. */
function outputColumns(d: DatasetInput): string[] {
  const out: string[] = [];
  for (const c of d.columns) {
    out.push(c.name);
    if (CODE_TABLES[c.name]) out.push(labelColumn(c.name));
  }
  return out;
}

function withLabels(d: DatasetInput, rows: ReadonlyArray<Record<string, unknown>>) {
  const coded = d.columns.filter((c) => CODE_TABLES[c.name]).map((c) => c.name);
  if (!coded.length) return rows;
  return rows.map((r) => {
    const o = { ...r };
    for (const c of coded) {
      const v = r[c];
      o[labelColumn(c)] = typeof v === "string" ? (CODE_TABLES[c]?.[v] ?? null) : null;
    }
    return o;
  });
}

/** The `ulid_stable_sort` normaliser: rows by id; audit events by sequence. */
function sortRows(d: DatasetInput, idField: string): Array<Record<string, unknown>> {
  const rows = [...d.rows];
  if (d.name === AUDIT_ENTITY) return rows.sort((a, b) => Number(a.seq) - Number(b.seq));
  const key = (r: Record<string, unknown>) => String(r[idField] ?? "");
  return rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** The `timestamps_iso8601` and `runtime_ids` normalisers for golden archives. */
function normaliseRows(d: DatasetInput, rows: Array<Record<string, unknown>>) {
  const times = d.columns.filter((c) => TIME_TYPES.test(c.pgType)).map((c) => c.name);
  return rows.map((r, i) => {
    const o = { ...r };
    for (const c of times) if (o[c] !== null && o[c] !== undefined) o[c] = NORMALISED.instant;
    if (d.name === AUDIT_ENTITY) {
      o.id = `led_normalised_${String(i + 1).padStart(6, "0")}`;
      for (const h of ["prev_hash", "entry_hash", "before_digest", "after_digest"])
        if (o[h]) o[h] = NORMALISED.hash;
      if (o.trace_id) o.trace_id = "normalised";
      if (o.resource_id && /_[0-9A-HJKMNP-TV-Z]{26}$/.test(String(o.resource_id)))
        o.resource_id = String(o.resource_id).replace(/[0-9A-HJKMNP-TV-Z]{26}$/, "NORMALISED");
    }
    return o;
  });
}

const VERIFY_DIR = new URL("../verify/", import.meta.url);

/** An instant as ISO 8601 in IST (UTC+05:30, no daylight saving), for the README only. */
export function istTime(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().replace("Z", "+05:30");
}

function readme(
  i: ArchiveInput,
  root: string,
  folders: readonly string[],
  datasets: string[],
  fp: string,
): {
  txt: string;
  md: string;
} {
  const asOf = i.asOf.toISOString();
  const sections: Array<[string, string[]]> = [
    [
      "Purpose and scope",
      [
        `This archive holds the ${SCOPE_LABEL[i.scope.type] ?? i.scope.type} export of tenant ${i.tenantId} from ${i.product}, release ${i.release}, under export map ${i.map.map_version} and archive standard ${ARCHIVE_STANDARD_VERSION} (folder profile ${FOLDER_PROFILE}).`,
        `Archive id: ${i.archiveId}. Predecessor: ${i.predecessorArchiveId ?? "none"}.`,
      ],
    ],
    [
      "As of",
      [
        `This archive was exported at ${asOf} (UTC), which is ${istTime(i.asOf)} in India Standard Time (IST, UTC+05:30). Every dataset shows the records as they were at that moment.`,
        "Every time inside the data files, manifests and audit trail is in UTC, written in ISO 8601 with its offset (`Z` means UTC). To read a time in IST, add 5 hours 30 minutes.",
      ],
    ],
    [
      "Requester and approvers",
      [
        `Requester: ${i.requester}. Approvers: ${i.approvers.join(", ") || "none (the tenant owner's own export needs no approval)"}. Ids only; no names.`,
      ],
    ],
    [
      "Folder guide",
      folders.map((f) =>
        f === START
          ? `${f}: this README, the manifests and signature, the data dictionary, relationships, code tables, JSON Schemas and the offline verifier.`
          : f === DATA
            ? `${f}: one CSV (and one JSONL) per dataset: ${datasets.join(", ")}.`
            : `${f}: the audit trail, one JSONL file per month, hash-chained.`,
      ),
    ],
    [
      "Opening CSV files",
      [
        "The CSV files are UTF-8 with a byte-order mark, comma-separated (RFC 4180), with a header row. To keep leading zeros and long numbers, import them as text: in Excel use Data > From Text/CSV and set the columns to Text; in LibreOffice Calc choose the Text column type in the import dialog.",
        "Code columns have a `_label` column beside them; the full code lists are in `00 Start Here/code-tables/`.",
      ],
    ],
    [
      "Verifying checksums and the signature",
      [
        "Every file's SHA-256 and size are listed in `00 Start Here/export-manifest.csv` and `manifest.json`. Check one file with `sha256sum <file>` (Linux), `shasum -a 256 <file>` (macOS), `Get-FileHash -Algorithm SHA256 <file>` (PowerShell) or `CertUtil -hashfile <file> SHA256` (Windows).",
        "`manifest.json.jws` is a detached JWS (RFC 7515 Appendix F, ES256) over `manifest.json`, made with the Infrabyx platform export-signing key.",
        `Signing key id: ${i.signer.kid}. Public key (JWK) in \`00 Start Here/verify/export-signing-key.jwk.json\`; its SHA-256 fingerprint is ${fp}.`,
        'To check everything at once (hashes, signature, control totals, CSV headers and the audit chain) run `node "00 Start Here/verify/verify.mjs"` from the archive folder with Node.js 20 or later. It needs no network.',
      ],
    ],
    [
      "Joining tables",
      [
        "`00 Start Here/relationships.csv` lists which column of one dataset refers to which column of another; `data-dictionary.csv` describes every column with its type and data class.",
      ],
    ],
    [
      "Glossary",
      [
        "Tenant: the organisation that owns this data. Ledger: the append-only, hash-chained audit trail. Data class: PUBLIC, INTERNAL, CONFIDENTIAL, REGULATED or SECRET (IPB-02).",
      ],
    ],
    [
      "Restricted folders",
      [
        "This archive contains no restricted folder. HR, privileged legal and collections material is exported separately, encrypted, only with a second approver.",
      ],
    ],
    [
      "Retention and legal hold",
      [
        "No record in this archive is under legal hold. Keep the archive as your own retention policy requires; the producing system keeps its own copies under its retention schedule.",
      ],
    ],
    [
      "Contacts",
      ["Ask your organisation's administrator, or raise a support request in the product."],
    ],
  ];
  const txt = [
    root,
    "",
    ...sections.flatMap(([h, ps]) => [h.toUpperCase(), ...ps.map((p) => `  ${p}`), ""]),
  ].join("\r\n");
  const md = [
    `# ${root}`,
    "",
    ...sections.flatMap(([h, ps]) => [`## ${h}`, "", ...ps.map((p) => `- ${p}`), ""]),
  ].join("\n");
  return { txt, md };
}

export async function buildArchive(input: ArchiveInput): Promise<BuiltArchive> {
  const i: ArchiveInput = input.normalise
    ? {
        ...input,
        archiveId: NORMALISED.archiveId,
        asOf: NORMALISED.instant,
        release: "normalised",
        requester: NORMALISED.requester,
        approvers: input.approvers.map(() => NORMALISED.requester),
      }
    : input;
  const ymd = i.asOf.toISOString().slice(0, 10);
  const root = safeName(
    `${safeName(i.ownerName, 60)} - ${safeName(i.product, 20)} Archive - ${SCOPE_LABEL[i.scope.type] ?? i.scope.type} - as of ${ymd}`,
    150,
  );
  const files = new Map<string, Buffer>();
  const put = (path: string, b: Buffer | string) => {
    if (`${root}/${path}`.length > 240) throw new Error(`path too long: ${path}`);
    files.set(path, typeof b === "string" ? Buffer.from(b, "utf8") : b);
  };
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  const totals: Record<string, number> = {};
  const datasetNames: string[] = [];
  const records = new Map<string, number>();
  const dict: Array<Record<string, unknown>> = [];

  for (const d of [...i.datasets].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const entity = i.map.entities[d.name];
    if (!entity) throw new Error(`dataset ${d.name} is not in map ${i.map.map_version}`);
    let rows = sortRows(d, entity.id);
    if (i.normalise) rows = normaliseRows(d, rows);
    const cols = outputColumns(d);
    const labelled = withLabels(d, rows);
    totals[d.name] = rows.length;
    for (const c of d.columns) {
      dict.push({
        dataset: d.name,
        field: c.name,
        type: c.pgType,
        nullable: c.nullable ? "Y" : "N",
        data_class: c.dataClass,
        code_table: CODE_TABLES[c.name] ? `code-tables/${c.name}.csv` : "",
        source: `${d.source}.${c.name}`,
      });
      if (CODE_TABLES[c.name])
        dict.push({
          dataset: d.name,
          field: labelColumn(c.name),
          type: "text",
          nullable: "Y",
          data_class: "PUBLIC",
          code_table: `code-tables/${c.name}.csv`,
          source: "label of the code",
        });
    }
    const props: Record<string, unknown> = {};
    for (const c of d.columns) {
      props[c.name] = jsonType(c);
      if (CODE_TABLES[c.name])
        props[labelColumn(c.name)] = { type: ["string", "null"], "x-dataclass": "PUBLIC" };
    }
    put(
      `${START}/schemas/${d.name}.schema.json`,
      json({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: `urn:infrabyx:export:${i.map.map_version}:${d.name}`,
        title: d.name,
        description: `Rows of ${d.source} exported under ${i.map.map_version}`,
        type: "object",
        properties: props,
        required: d.columns.filter((c) => !c.nullable).map((c) => c.name),
        additionalProperties: false,
      }),
    );
    if (d.name === AUDIT_ENTITY) {
      const byMonth = new Map<string, Array<Record<string, unknown>>>();
      for (const r of labelled) {
        const at = r.occurred_at instanceof Date ? r.occurred_at : new Date(String(r.occurred_at));
        const m = at.toISOString().slice(0, 7);
        byMonth.set(m, [...(byMonth.get(m) ?? []), r]);
      }
      if (!byMonth.size) byMonth.set(ymd.slice(0, 7), []);
      for (const [m, rs] of byMonth) {
        const path = `${AUDIT}/audit-events-${m}.jsonl`;
        put(
          path,
          toJsonl(
            d.columns.map((c) => c.name),
            rs,
          ),
        );
        records.set(path, rs.length);
      }
      const last = rows.at(-1);
      totals["audit_event.last_seq"] = last ? Number(last.seq) : 0;
      continue;
    }
    datasetNames.push(d.name);
    put(`${DATA}/${d.name}.csv`, toCsv(cols, labelled));
    put(`${DATA}/${d.name}.jsonl`, toJsonl(cols, labelled));
    records.set(`${DATA}/${d.name}.csv`, rows.length);
    records.set(`${DATA}/${d.name}.jsonl`, rows.length);
  }

  for (const [name, codes] of Object.entries(CODE_TABLES).sort(([a], [b]) => (a < b ? -1 : 1)))
    put(
      `${START}/code-tables/${name}.csv`,
      toCsv(
        ["code", "label"],
        Object.entries(codes).map(([code, label]) => ({ code, label })),
      ),
    );
  put(
    `${START}/data-dictionary.csv`,
    toCsv(["dataset", "field", "type", "nullable", "data_class", "code_table", "source"], dict),
  );
  put(
    `${START}/relationships.csv`,
    toCsv(
      ["from_dataset", "from_field", "to_dataset", "to_field"],
      [...(i.relationships ?? [])]
        .sort((a, b) => (canonicalize(a) < canonicalize(b) ? -1 : 1))
        .map((r) => ({
          from_dataset: r.fromDataset,
          from_field: r.fromField,
          to_dataset: r.toDataset,
          to_field: r.toField,
        })),
    ),
  );
  const jwkText = json(i.signer.publicJwk);
  const fp = sha256Hex(canonicalize(i.signer.publicJwk));
  put(`${START}/verify/export-signing-key.jwk.json`, jwkText);
  put(`${START}/verify/verify.mjs`, readFileSync(new URL("verify.mjs", VERIFY_DIR)));
  put(`${START}/verify/LICENSE.txt`, readFileSync(new URL("LICENSE.txt", VERIFY_DIR)));
  put(
    `${START}/verify/README.txt`,
    [
      "Offline verifier for this archive (Apache-2.0).",
      "",
      'Run from the archive folder:  node "00 Start Here/verify/verify.mjs"',
      "It checks every file's size and SHA-256, the pack hash, the manifest signature with",
      "export-signing-key.jwk.json, the CSV headers against schemas/, the row counts against the",
      "control totals, and the audit trail hash chain. Exit code 0 means every check passed.",
      `Public key fingerprint (SHA-256 of the JWK in JCS form): ${fp}`,
      "",
    ].join("\r\n"),
  );
  const folders = [
    START,
    ...(datasetNames.length ? [DATA] : []),
    ...(i.map.entities[AUDIT_ENTITY] && i.datasets.some((d) => d.name === AUDIT_ENTITY)
      ? [AUDIT]
      : []),
  ];
  const r = readme(i, root, folders, datasetNames, fp);
  put(`${START}/README.txt`, r.txt);
  put(`${START}/README.md`, r.md);

  const listed = [...files.keys()].sort();
  const entries = listed.map((p) => {
    const b = files.get(p) as Buffer;
    return { path: p, bytes: b.length, sha256: sha256Hex(b) };
  });
  const pack = sha256Hex(
    entries
      .map((e) => `${e.path} ${e.sha256}\n`)
      .sort()
      .join(""),
  );
  const asOf = i.asOf.toISOString();
  put(
    `${START}/export-manifest.csv`,
    toCsv(
      [
        "path",
        "sha256",
        "bytes",
        "media_type",
        "record_count",
        "legal_entity",
        "dataset",
        "schema_version",
        "as_of",
        "created_at",
        "source_ids",
        "restricted",
        "retention_class",
        "legal_hold",
        "upsi",
      ],
      entries.map((e) => {
        const ds = /^(?:01 Data\/([a-z0-9_]+)\.|02 Audit Trail\/)/.exec(e.path);
        return {
          path: e.path,
          sha256: e.sha256,
          bytes: e.bytes,
          media_type: mediaType(e.path),
          record_count: records.get(e.path) ?? "",
          legal_entity: "",
          dataset: ds ? (ds[1] ?? AUDIT_ENTITY) : "",
          schema_version: ds ? i.map.map_version : "",
          as_of: asOf,
          created_at: asOf,
          source_ids: "",
          restricted: "N",
          retention_class: "audit",
          legal_hold: "N",
          upsi: "N",
        };
      }),
    ),
  );
  const manifest = ArchiveManifestV1.parse({
    archive_standard_version: ARCHIVE_STANDARD_VERSION,
    archive_id: i.archiveId,
    folder_profile: FOLDER_PROFILE,
    map_version: i.map.map_version,
    producer: { product: i.product, release: i.release },
    tenant_id: i.tenantId,
    scope: i.scope,
    requester: i.requester,
    approvers: [...i.approvers],
    as_of: asOf,
    control_totals: totals,
    predecessor_archive_id: i.predecessorArchiveId,
    files: entries,
    pack_sha256: pack,
    signature: { file: "manifest.json.jws", alg: "ES256", kid: i.signer.kid },
  });
  const manifestBytes = Buffer.from(json(manifest), "utf8");
  put(`${START}/manifest.json`, manifestBytes);
  const jws = await signDetachedJws({
    payload: manifestBytes,
    kid: i.signer.kid,
    sign: i.signer.sign,
    cty: "application/json",
  });
  put(`${START}/manifest.json.jws`, `${jws}\n`);
  const zipped = new Map<string, Uint8Array>();
  for (const [p, b] of files) zipped.set(`${root}/${p}`, b);
  const zip = writeZip(zipped, { entryTime: i.normalise ? NORMALISED.instant : i.asOf });
  return {
    root,
    files,
    manifest,
    manifestBytes,
    jws,
    zip,
    sha256: sha256Hex(zip),
    manifestHash: sha256Hex(manifestBytes),
  };
}

function mediaType(p: string): string {
  if (p.endsWith(".csv")) return "text/csv";
  if (p.endsWith(".jsonl")) return "application/jsonl";
  if (p.endsWith(".json")) return "application/json";
  if (p.endsWith(".md")) return "text/markdown";
  if (p.endsWith(".mjs")) return "text/javascript";
  return "text/plain";
}
