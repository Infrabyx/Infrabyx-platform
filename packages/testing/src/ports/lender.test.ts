// PR-UDF-051 (R1-D-217), PR-UDF-053 (R1-D-219): the origination contract cases against the mock lender.
import { describe, it } from "vitest";
import { FakeLender } from "@infrabyx/fakes";
import { lenderContractCases, lspSigner } from "./lender.js";

describe("origination contract (Ecosystem Spec §6.2, §6.3, §6.13): FakeLender", () => {
  const lsp = lspSigner();
  for (const c of lenderContractCases({ lsp }))
    it(c.name, () => c.run(new FakeLender({ lspKeys: lsp.keys })));
});

describe("origination contract: FakeLender without the LSP's keys refuses all evidence", () => {
  for (const c of lenderContractCases()) it(c.name, () => c.run(new FakeLender()));
});
