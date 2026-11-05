// The DISPATCH fake passes its own contract cases (Finbyx PR-FBX-41; ADR-0008; R1-D-104).
import { defineContractSuite } from "../contract.js";
import { FakeDispatch, dispatchContractCases } from "./dispatch.js";

const dispatch = new FakeDispatch();
defineContractSuite("DISPATCH", () => dispatch, dispatchContractCases(dispatch));
