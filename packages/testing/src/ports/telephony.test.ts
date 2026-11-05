// The TELEPHONY fake passes its own contract cases (Finbyx PR-FBX-38; ADR-0007; R1-D-97).
import { defineContractSuite } from "../contract.js";
import { FakeTelephony, telephonyContractCases } from "./telephony.js";

const telephony = new FakeTelephony();
defineContractSuite("TELEPHONY", () => telephony, telephonyContractCases(telephony));
