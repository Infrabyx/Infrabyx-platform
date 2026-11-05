// One tenant-id rule, platform-wide (Finbyx PR-FBX-40; R1-D-103; tenancy/0019): every id the rule
// admits is admitted by every port's storage prefix, and an id with an underscore after `tnt_`
// (which tenancy/0001 allowed and the ports refused) is refused by the rule itself.
import { describe, expect, it } from "vitest";
import { RESERVED_IDS, TENANT_ID_REGEX, ULID_PATTERN, isTenantId } from "./ids.js";

const ulidLike = "01J9ZC9Q2K7M8N3P4R5S6T7V8W";
import { AaFetchRequest } from "./ports/account-aggregator.js";
import { BureauPullRequest } from "./ports/credit-bureau.js";
import { OutputPrefix } from "./ports/doc-file.js";
import { isValidStorageKey } from "./ports/storage.js";

const VALID = [
  ...RESERVED_IDS,
  "tnt_a",
  "tnt_bclenterprises",
  "tnt_bcl2026",
  `tnt_${"a".repeat(60)}`,
  `tnt_${ulidLike}`,
];
const INVALID = [
  "tnt_bcl_enterprises",
  "tnt_other_pay",
  "tnt_",
  "tnt_A",
  "tnt_Bcl",
  "tnt_bcl-enterprises",
  `tnt_${"a".repeat(61)}`,
  "tnt_81J9ZC9Q2K7M8N3P4R5S6T7V8W",
  "usr_abc",
  "tnt_abc\n",
];

describe("the tenant-id rule (PR-FBX-40)", () => {
  it("admits letters and digits after tnt_ and refuses anything else", () => {
    expect(new RegExp(`^${ULID_PATTERN}$`).test(ulidLike)).toBe(true);
    for (const id of VALID) expect(isTenantId(id), id).toBe(true);
    for (const id of INVALID) expect(isTenantId(id), id).toBe(false);
    expect(isTenantId(42)).toBe(false);
    expect(TENANT_ID_REGEX.test("tnt_platform")).toBe(true);
  });

  it("every id the rule admits fits every port's storage prefix", () => {
    for (const id of VALID) {
      expect(OutputPrefix.safeParse(`tenant/${id}/calls`).success, id).toBe(true);
      expect(isValidStorageKey(`tenant/${id}/docs/${ulidLike}.pdf`), id).toBe(true);
      expect(AaFetchRequest.shape.dataPrefix.safeParse(`tenant/${id}/aa/`).success, id).toBe(true);
      expect(
        BureauPullRequest.shape.reportPrefix.safeParse(`tenant/${id}/bureau/`).success,
        id,
      ).toBe(true);
    }
    // What tenancy/0001 allowed and the ports refused: now refused at creation too.
    expect(OutputPrefix.safeParse("tenant/tnt_bcl_enterprises/calls").success).toBe(false);
  });
});
