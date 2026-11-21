// PR-UDF-071 (R1-D-254, ADR-0014): the FILE_TRANSFER port's registration, path rule and checks, and
// the Ecosystem Spec §3.11 file name and manifest helpers.
import { describe, expect, it } from "vitest";
import { PORT_CATALOGUE, R1_PORTS } from "./catalogue.js";
import { portDefaultDataClass } from "./common.js";
import {
  FILE_TRANSFER_GET_DEFAULT_BYTES,
  FILE_TRANSFER_MAX_BYTES,
  FILE_TRANSFER_REFUSALS,
  assertFileTransferClass,
  fileTransferGetLimit,
  fileTransferListLimit,
  fileTransferPath,
  isFileTransferName,
  preparePut,
} from "./file-transfer.js";
import {
  checkFileExchangeManifest,
  fileExchangeManifest,
  fileExchangeName,
  parseFileExchangeName,
} from "./file-exchange.js";

const refusal = async (f: () => unknown) => {
  try {
    await f();
  } catch (e) {
    return e as { code: string; meta: { reason: string } };
  }
  throw new Error("no refusal");
};

describe("FILE_TRANSFER port (PR-UDF-071)", () => {
  it("is registered: tier 2, int.file_transfer., ADR-0014, an R1 port, REGULATED by default", () => {
    expect(PORT_CATALOGUE.FILE_TRANSFER).toMatchObject({
      tier: 2,
      configPrefix: "int.file_transfer.",
      interfaceDefined: true,
    });
    expect(PORT_CATALOGUE.FILE_TRANSFER.ownerFile).toContain("ADR-0014");
    expect(R1_PORTS).toContain("FILE_TRANSFER");
    expect(portDefaultDataClass("FILE_TRANSFER")).toBe("REGULATED");
  });

  it("accepts relative paths of safe segments only", () => {
    for (const p of ["a.csv", "upload/fbx_re1_bureau_v3_20261121_1.csv", "in/2026-11/x_1.txt"])
      expect(fileTransferPath(p)).toBe(p);
    for (const p of [
      "",
      "/etc/passwd",
      "../x",
      "a/../b",
      "a/./b",
      "a//b",
      "a/",
      "a\\b",
      "a b",
      "a\u0000b",
      "-rf",
      "é.csv",
      "a/".repeat(17) + "b",
      "x".repeat(256),
    ])
      expect(fileTransferPath(p), JSON.stringify(p)).toBeNull();
    expect(fileTransferPath(".")).toBeNull();
    expect(fileTransferPath(".", { allowHome: true })).toBe(".");
    expect(isFileTransferName(".hidden")).toBe(true);
    expect(isFileTransferName("..")).toBe(false);
  });

  it("checks a put before anything is sent: path, class, ifAbsent and size", async () => {
    const b = new Uint8Array([1]);
    expect(preparePut("t", "a.csv", b, { ifAbsent: true })).toBe("a.csv");
    expect((await refusal(() => preparePut("t", "../a", b, { ifAbsent: true }))).meta.reason).toBe(
      "invalid_path",
    );
    expect(
      (await refusal(() => preparePut("t", "a", b, { ifAbsent: false as unknown as true }))).meta
        .reason,
    ).toBe("invalid_path");
    const r = await refusal(() => preparePut("t", "a", b, { ifAbsent: true, dataClass: "SECRET" }));
    expect(r).toMatchObject({ code: "IPB-PORT-003", meta: { reason: "data_class" } });
    expect(
      (await refusal(() => assertFileTransferClass("t", { dataClass: "CONFIDENTIAL" }))).meta
        .reason,
    ).toBe("data_class");
    expect(() => assertFileTransferClass("t", { dataClass: "REGULATED" })).not.toThrow();
    const big = { byteLength: FILE_TRANSFER_MAX_BYTES + 1 } as Uint8Array;
    Object.setPrototypeOf(big, Uint8Array.prototype);
    expect((await refusal(() => preparePut("t", "a", big, { ifAbsent: true }))).code).toBe(
      "IPB-SEC-013",
    );
  });

  it("caps lists and gets at the platform maxima", () => {
    expect(fileTransferGetLimit()).toBe(FILE_TRANSFER_GET_DEFAULT_BYTES);
    expect(fileTransferGetLimit({ maxBytes: 10 })).toBe(10);
    expect(fileTransferGetLimit({ maxBytes: 2 ** 40 })).toBe(FILE_TRANSFER_MAX_BYTES);
    expect(fileTransferGetLimit({ maxBytes: -1 })).toBe(FILE_TRANSFER_GET_DEFAULT_BYTES);
    expect(fileTransferListLimit({ maxEntries: 50_000 })).toBe(10_000);
    expect(fileTransferListLimit()).toBe(1_000);
  });

  it("maps every refusal label to a catalogued code", () => {
    expect(FILE_TRANSFER_REFUSALS.exists).toBe("IPB-STOR-003");
    expect(FILE_TRANSFER_REFUSALS.host_key_mismatch).toBe("IPB-SEC-018");
    expect(FILE_TRANSFER_REFUSALS.too_large).toBe("IPB-SEC-013");
    expect(FILE_TRANSFER_REFUSALS.not_found).toBe("IPB-STOR-001");
  });
});

describe("§3.11 file name and manifest (PR-UDF-071)", () => {
  const parts = {
    producer: "fbx",
    reid: "RE01JA",
    layoutId: "bureau_commercial_v310",
    major: 3,
    date: "2026-11-21",
    seq: 1,
    ext: "csv",
  };
  const name = "fbx_RE01JA_bureau_commercial_v310_v3_20261121_1.csv";
  const manifest = {
    file_name: name,
    layout: "bureau_commercial_v310",
    version: "3.10",
    count: 1200,
    control_totals: { sanctioned_amount_minor: "120000000", accounts: "1200" },
    period: { from: "2026-10-01", to: "2026-10-31" },
    sha256: "a".repeat(64),
  };

  it("builds and parses the name, layout ids with underscores included", () => {
    expect(fileExchangeName(parts)).toBe(name);
    expect(parseFileExchangeName(name)).toEqual(parts);
    expect(parseFileExchangeName("udf_RE-9_ack_v1_20261121_12.ndjson.gz")).toMatchObject({
      layoutId: "ack",
      seq: 12,
      ext: "ndjson.gz",
    });
    for (const bad of [
      "fbx_RE01JA_layout_v3_20261131_1.csv", // 31 Nov
      "fbx_RE01JA_layout_v3_20261121_0.csv",
      "fbx_RE01JA_layout_v03_20261121_1.csv",
      "fbx_RE_01_layout_v3_20261121_1", // no extension
      "FBX_RE01JA_layout_v3_20261121_1.csv",
    ])
      expect(parseFileExchangeName(bad), bad).toBeNull();
    expect(() => fileExchangeName({ ...parts, reid: "RE_1" })).toThrow(RangeError);
  });

  it("checks a manifest and reports mismatches as fixed labels", () => {
    expect(fileExchangeManifest(manifest)).toEqual(manifest);
    expect(() => fileExchangeManifest({ ...manifest, version: "4.0" })).toThrow();
    expect(() => fileExchangeManifest({ ...manifest, layout: "other" })).toThrow();
    expect(() =>
      fileExchangeManifest({ ...manifest, period: { from: "2026-11-01", to: "2026-10-01" } }),
    ).toThrow();
    expect(() =>
      fileExchangeManifest({ ...manifest, control_totals: { amount: "1.5" } }),
    ).toThrow();
    expect(checkFileExchangeManifest(manifest, { fileName: name, sha256: "a".repeat(64) })).toEqual(
      [],
    );
    expect(
      checkFileExchangeManifest(manifest, {
        fileName: name,
        sha256: "b".repeat(64),
        count: 1199,
        controlTotals: { sanctioned_amount_minor: "120000000", accounts: "1199" },
      }),
    ).toEqual(["sha256", "count", "control_totals.accounts"]);
    expect(
      checkFileExchangeManifest({ ...manifest, extra: 1 }, { fileName: name, sha256: "" }),
    ).toEqual(["manifest"]);
  });
});
