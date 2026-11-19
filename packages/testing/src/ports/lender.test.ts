// PR-UDF-051 (R1-D-217): the origination contract cases against the mock lender.
import { describe, it } from "vitest";
import { FakeLender } from "@infrabyx/fakes";
import { lenderContractCases } from "./lender.js";

describe("origination contract (Ecosystem Spec §6.2, §6.3): FakeLender", () => {
  for (const c of lenderContractCases()) it(c.name, () => c.run(new FakeLender()));
});
