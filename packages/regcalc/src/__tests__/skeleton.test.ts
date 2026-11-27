// The package skeleton (ADR-0015; R1-regcalc plan §5 step 1): the number type refuses floats, the
// refusals are coded, and the oracle harness opens only workbooks whose bytes match the filed
// SHA256SUMS and lists every formula cell it must reach.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { D, dec, decIn, RegcalcError, roundBy, DEFAULT_ROUNDING, NO_ROUNDING } from "../index.js";
import { ORACLES, Oracle, a1, filedHash, MODELS_ROOT, openOracle } from "./oracle.js";

describe("regcalc numbers", () => {
  it("takes decimal strings and Decimals, and refuses a JavaScript number, NaN and exponents", () => {
    expect(dec("100000", "amount").toString()).toBe("100000");
    expect(dec(" 0.18 ", "rate").toString()).toBe("0.18");
    expect(dec(new D("969.73"), "emi").toString()).toBe("969.73");
    for (const bad of [100000, 0.18, Number.NaN, "1e5", "1,00,000", "", "abc", null, undefined, {}])
      expect(() => dec(bad, "amount")).toThrow(
        expect.objectContaining({ reason: "input_invalid", field: "amount", status: 422 }),
      );
    expect(() => decIn("-1", "amount", "0")).toThrow(
      expect.objectContaining({ reason: "input_out_of_range" }),
    );
    expect(new RegcalcError("no_solution", "x")).toBeInstanceOf(Error);
  });

  it("rounds half-up to the rupee by default; none keeps the model's figure", () => {
    expect(roundBy(new D("969.5"), DEFAULT_ROUNDING).toString()).toBe("970");
    expect(roundBy(new D("969.49"), DEFAULT_ROUNDING).toString()).toBe("969");
    expect(roundBy(new D("0.125"), { to: "paisa", mode: "half_even" }).toString()).toBe("0.12");
    expect(roundBy(new D("969.7312"), NO_ROUNDING).toString()).toBe("969.7312");
  });

  it("has no I/O, clock, randomness or settings in its source", () => {
    const dir = fileURLToPath(new URL("../", import.meta.url));
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const src = readFileSync(`${dir}${f}`, "utf8");
      expect(src, f).not.toMatch(
        /from "node:|from "@infrabyx\/|Date\.now|new Date\(\)|Math\.random|process\.|console\./,
      );
    }
  });
});

describe("the oracle harness", () => {
  it("opens each oracle workbook only at its filed hash", () => {
    for (const rel of Object.values(ORACLES)) {
      expect(filedHash(rel)).toMatch(/^[0-9a-f]{64}$/);
      expect(openOracle(rel).formulas.size).toBeGreaterThan(0);
    }
  });

  it("refuses a workbook whose bytes are not the filed ones", () => {
    const bytes = new Uint8Array(readFileSync(`${MODELS_ROOT}${ORACLES.kfs}`));
    // The harness hashes before parsing: one changed byte and the workbook is not an oracle.
    const changed = bytes.slice();
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 0xff;
    expect(() => openOracle(ORACLES.kfs, changed)).toThrow(/is not the filed/);
    expect(openOracle(ORACLES.kfs, bytes).rel).toBe(ORACLES.kfs);
    expect(() => filedHash("not/a/model.xlsx")).toThrow(/not in docs\/regulatory-models/);
  });

  it("lists every formula cell and tracks which an assertion reached", () => {
    const o = openOracle(ORACLES.kfs);
    expect(o.formulas.get("APR")).toContain("B13");
    expect(o.value("Loan Input", "B6")).toBe(100000);
    expect(o.uncovered(["APR"])).toContain("APR!B13");
    o.rate("APR", "B4", new D(12));
    expect(o.uncovered(["APR"])).not.toContain("APR!B4");
    expect(a1("B13")).toEqual([12, 1]);
    expect(a1("AA1")).toEqual([0, 26]);
    expect(o).toBeInstanceOf(Oracle);
  });
});
