import { describe, expect, it } from "vitest";
import { PORTS, selectPorts } from "../../scripts/port-matrix.mjs";

describe("port-contract matrix path filters (PL2-D-13)", () => {
  it("runs only the ports whose files changed", () => {
    expect(selectPorts(["packages/connectors/src/payments/razorpay/index.ts"])).toEqual([
      "PAYMENTS",
    ]);
    expect(selectPorts(["packages/contracts/src/ports/feature-flag.ts", "docs/STATUS.md"])).toEqual(
      ["FEATURE_FLAG"],
    );
    expect(selectPorts(["docs/STATUS.md"])).toEqual([]);
    // PR-UDF-048: the port's contract, its fake and its adapters select its leg alone.
    for (const f of [
      "packages/contracts/src/ports/statement-analysis.ts",
      "packages/fakes/src/ports/statement-analysis.ts",
      "packages/connectors/src/statement-analysis/http.ts",
    ])
      expect(selectPorts([f])).toEqual(["STATEMENT_ANALYSIS"]);
    // PR-FBX-51: the GRC port, its events, its fake and its adapter select its leg alone.
    for (const f of [
      "packages/contracts/src/ports/grc.ts",
      "packages/contracts/src/events/grc-events.ts",
      "packages/fakes/src/ports/grc.ts",
      "packages/connectors/src/grc/generic.ts",
    ])
      expect(selectPorts([f])).toEqual(["GRC"]);
  });
  it("runs every port for a shared change, nightly and before a release", () => {
    expect(selectPorts(["packages/connectors/src/core/router.ts"])).toEqual(PORTS);
    expect(selectPorts(["pnpm-lock.yaml"])).toEqual(PORTS);
    expect(selectPorts([], { all: true })).toEqual(PORTS);
  });
  it("drops ports that have no adapters yet", () => {
    expect(selectPorts([], { all: true, has: (p) => p === "QUEUE" })).toEqual(["QUEUE"]);
  });
});
