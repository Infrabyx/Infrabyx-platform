// The fake against ESTAMP's stamp-record contract cases (PR-UDF-054, R1-D-245).
import { describe } from "vitest";
import { defineContractSuite } from "../contract.js";
import { FakeEstamp } from "./documents-money.js";
import { estampRecordContractCases, fakeStampRecordFixtures } from "./estamp-record.js";

describe("ESTAMP stamp records on the fake (R1-D-245)", () => {
  defineContractSuite(
    "ESTAMP",
    () => new FakeEstamp(),
    estampRecordContractCases(fakeStampRecordFixtures()),
  );
});
