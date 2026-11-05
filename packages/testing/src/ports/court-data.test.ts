// The COURT_DATA fake passes its own contract cases (Finbyx PR-FBX-42; ADR-0009; R1-D-104).
import { defineContractSuite } from "../contract.js";
import { FakeCourtData, courtDataContractCases } from "./court-data.js";

const court = new FakeCourtData();
defineContractSuite("COURT_DATA", () => court, courtDataContractCases(court));
