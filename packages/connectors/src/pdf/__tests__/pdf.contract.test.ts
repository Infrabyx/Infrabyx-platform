// PDF contract leg (PR-LDC-39, R1-D-160; port-contract.yml). The `pdf-text` adapter parses in a
// worker inside the product's own process, so the leg needs no container: the generic PDF text
// contract cases from \`@infrabyx/testing\` against the real adapter over memory storage. The
// adapter's own cases (fixtures, limits, refusals) are in \`text.test.ts\`.
import { defineContractSuite, MemoryStorage, pdfTextContractCases } from "@infrabyx/testing";
import { PdfTextExtractor } from "../text.js";

const storage = new MemoryStorage();

defineContractSuite("PDF", () => new PdfTextExtractor({ storage }), pdfTextContractCases(storage), {
  leg: "hermetic",
});
