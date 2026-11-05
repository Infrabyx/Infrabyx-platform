// The ODR fake and the Equator stub pass the contract cases (Finbyx PR-FBX-44; ADR-0010; R1-D-104).
import { describe, expect, it } from "vitest";
import { defineContractSuite } from "../contract.js";
import { EQUATOR_DISCLOSURE, FakeOdr, equatorOdrStub, odrContractCases } from "./odr.js";

const plain = new FakeOdr();
defineContractSuite("ODR", () => plain, odrContractCases(plain));
const equator = equatorOdrStub();
defineContractSuite("ODR", () => equator, odrContractCases(equator));

describe("the Equator stub", () => {
  it("carries the group-company disclosure and is not the plain fake", () => {
    expect(equator.disclosure()).toEqual(EQUATOR_DISCLOSURE);
    expect(equator.disclosure().statement).toBe("Equator Resolution is an Infrabyx group company");
    expect(equator.descriptor.adapter).toBe("equator-stub");
    expect(plain.disclosure().groupCompany).toBe(false);
  });
});
