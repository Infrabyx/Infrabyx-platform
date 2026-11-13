// The ACCOUNTING sink fake passes its own contract cases (Finbyx PR-FBX-46; R1-D-122).
import { defineContractSuite } from "../contract.js";
import { FakeAccountingSink, accountingContractCases } from "./accounting.js";

const sink = new FakeAccountingSink();
defineContractSuite("ACCOUNTING", () => sink, accountingContractCases(sink));
