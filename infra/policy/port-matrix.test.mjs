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
