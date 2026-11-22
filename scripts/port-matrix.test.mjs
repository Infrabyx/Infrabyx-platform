// The port-contract matrix finds each port's own contract file (R1-D-274): a change to a port's
// interface runs that port's legs, even when the file is named for what it does.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTS, portDir, portPaths, selectPorts } from "./port-matrix.mjs";

const has = (p) => existsSync(`packages/connectors/src/${portDir(p)}`);

describe("port-contract matrix", () => {
  it("runs BUREAU for its contract file and AA_FIU for its own", () => {
    expect(selectPorts(["packages/contracts/src/ports/credit-bureau.ts"], { has })).toEqual([
      "BUREAU",
    ]);
    expect(selectPorts(["packages/contracts/src/ports/account-aggregator.ts"], { has })).toEqual([
      "AA_FIU",
    ]);
  });

  it("every port with adapters names a contract file that exists", () => {
    for (const port of PORTS.filter(has)) {
      const contracts = portPaths(port).filter(
        (p) => p.startsWith("packages/contracts/src/ports/") && existsSync(p),
      );
      expect(contracts.length, `${port}: no contract file in its paths`).toBeGreaterThan(0);
    }
  });
});
