// Export maps (IPB-09 §09.4.7.1; PL3 plan §7.1): the reference map `REF-EXPORT-1.2` for
// `apps/reference` and the demo seed, and a registry products add their `<PRODUCT>-EXPORT-x.y` maps
// to. During the dual run (`eng.export.dual_run_days`, floor 90) the previous map is emitted as well.
import { readFileSync } from "node:fs";
import { IpbError } from "@infrabyx/contracts/errors";
import { ExportMap, parseMapVersion } from "@infrabyx/contracts/export";
import type { ColumnInfo } from "./archive.js";

/** Parse and validate an export map file. */
export function loadExportMap(path: string | URL): ExportMap {
  return ExportMap.parse(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * The current reference map. 1.2 (PL4-D-12) adds the AI run log (`ai_runs`, metadata only) and the
 * Vidhi action log (`vidhi_actions`), IPB-03-55 and 03-83; 1.1 (PL3-D-25) added the IST export time
 * to the README.
 */
export const REF_EXPORT_MAP: ExportMap = loadExportMap(
  new URL("../maps/REF-EXPORT-1.2.json", import.meta.url),
);
/** The previous reference map, still emitted during the dual run. */
export const REF_EXPORT_MAP_1_1: ExportMap = loadExportMap(
  new URL("../maps/REF-EXPORT-1.1.json", import.meta.url),
);
/** The map before that (kept for archives built under it). */
export const REF_EXPORT_MAP_1_0: ExportMap = loadExportMap(
  new URL("../maps/REF-EXPORT-1.0.json", import.meta.url),
);

export const DUAL_RUN_FLOOR_DAYS = 90;
const DAY = 86_400_000;

interface Registered {
  map: ExportMap;
  since: Date;
}

export class ExportMapRegistry {
  private readonly maps = new Map<string, Registered[]>();

  /** Register a map; `since` is when it became current (default now). */
  register(map: ExportMap, since: Date = new Date()): this {
    const parsed = ExportMap.parse(map);
    const v = parseMapVersion(parsed.map_version);
    if (!v) throw new Error(`invalid map version ${parsed.map_version}`);
    const list = (this.maps.get(v.product) ?? []).filter(
      (r) => r.map.map_version !== parsed.map_version,
    );
    list.push({ map: parsed, since });
    list.sort((a, b) => cmp(a.map.map_version, b.map.map_version));
    this.maps.set(v.product, list);
    return this;
  }

  /** The newest map of a product. */
  current(product: string): ExportMap {
    const list = this.maps.get(product);
    const last = list?.at(-1);
    if (!last) throw new Error(`no export map registered for ${product}`);
    return last.map;
  }

  get(version: string): ExportMap {
    const v = parseMapVersion(version);
    const r = v && this.maps.get(v.product)?.find((x) => x.map.map_version === version);
    if (!r) throw new Error(`export map ${version} is not registered`);
    return r.map;
  }

  /** Maps an export emits at `now`: the newest, plus each older one still in its dual run. */
  emitted(product: string, now: Date, dualRunDays = DUAL_RUN_FLOOR_DAYS): ExportMap[] {
    const days = Math.max(DUAL_RUN_FLOOR_DAYS, dualRunDays);
    const list = this.maps.get(product) ?? [];
    return list
      .filter((r, i) => {
        const next = list[i + 1];
        return !next || now.getTime() - next.since.getTime() < days * DAY;
      })
      .map((r) => r.map);
  }
}

function cmp(a: string, b: string): number {
  const x = parseMapVersion(a);
  const y = parseMapVersion(b);
  if (!x || !y) return a < b ? -1 : 1;
  return x.major - y.major || x.minor - y.minor;
}

/** Column names that never leave the platform, whatever their data class (Ecosystem §12.1). */
const NEVER_EXPORTED =
  /(^|_)(aadhaar|aadhar|uid_number|card_number|card_no|pan_card_image|cvv)(_|$)/;

/**
 * Refuse a map that names a field no export may carry (IPB-EXP-004): a SECRET column, a sealed
 * (`*_enc`, binary) column, or Aadhaar or card data. Missing fields are refused as well.
 */
export function assertExportable(
  entity: string,
  fields: readonly string[],
  columns: readonly ColumnInfo[],
): void {
  for (const f of fields) {
    const c = columns.find((x) => x.name === f);
    if (!c) throw new Error(`export map field ${entity}.${f} does not exist in the database`);
    if (
      c.dataClass === "SECRET" ||
      c.pgType === "bytea" ||
      f.endsWith("_enc") ||
      NEVER_EXPORTED.test(f)
    )
      throw new IpbError("IPB-EXP-004", { meta: { field: `${entity}.${f}` } });
  }
}
