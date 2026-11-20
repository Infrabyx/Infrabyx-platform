// PR-FBX-51 (R1-D-220): the GRC port's registration and the checks every adapter shares.
import { describe, expect, it } from "vitest";
import { verhoeffValid } from "../aadhaar.js";
import { GRC_EVENTS } from "../events/grc-events.js";
import { PORT_CATALOGUE, R1_PORTS } from "./catalogue.js";
import { portDefaultDataClass } from "./common.js";
import {
  GRC_POST_METHODS,
  GrcObligation,
  GrcObligationQuery,
  GrcReceiptSchema,
  assertGrcClass,
  prepareGrcObligationQuery,
  prepareGrcPost,
} from "./grc.js";

const T = "2026-11-20T10:00:00+05:30";
const att = { policy_id: "pol_fair_practices", version: "3", user_ref: "usr_01JA", attested_at: T };
const withCheck = (stem: string): string => {
  for (let d = 0; d < 10; d++) if (verhoeffValid(`${stem}${d}`)) return `${stem}${d}`;
  throw new RangeError("no check digit");
};

describe("GRC port (PR-FBX-51)", () => {
  it("is registered: tier 2, int.grc., ADR-0013, an R1 port, CONFIDENTIAL by default", () => {
    expect(PORT_CATALOGUE.GRC).toMatchObject({
      tier: 2,
      configPrefix: "int.grc.",
      interfaceDefined: true,
    });
    expect(PORT_CATALOGUE.GRC.ownerFile).toContain("ADR-0013");
    expect(R1_PORTS).toContain("GRC");
    expect(portDefaultDataClass("GRC")).toBe("CONFIDENTIAL");
  });

  it("maps each POST to a §6.15 event that pushes to the GRC system", () => {
    for (const m of Object.values(GRC_POST_METHODS)) {
      expect(GRC_EVENTS[m.event].direction).toBe("TO_GRC");
      expect(m.path).toMatch(/^\/v1\/grc\/[a-z-]+$/);
    }
    expect(Object.keys(GRC_POST_METHODS)).toHaveLength(6);
  });

  it("keys a POST by the caller's key, else the event's Specification key", () => {
    expect(prepareGrcPost("a", "recordPolicyAttestation", att).idempotencyKey).toBe(
      "policy_id=pol_fair_practices|version=3|user_ref=usr_01JA",
    );
    expect(
      prepareGrcPost("a", "recordPolicyAttestation", att, { idempotencyKey: "k-1" }).idempotencyKey,
    ).toBe("k-1");
    expect(() =>
      prepareGrcPost("a", "recordPolicyAttestation", att, { idempotencyKey: 'bad"key' }),
    ).toThrow();
    // Unknown fields are kept, as the event schemas pass them through.
    expect(prepareGrcPost("a", "recordPolicyAttestation", { ...att, x: 1 }).data.x).toBe(1);
  });

  it("refuses personal data before the schema, and a class outside INTERNAL…CONFIDENTIAL", () => {
    const uid = withCheck("23456789012");
    for (const raw of [{ ...att, user_ref: `usr_${uid}` }, { note: "ABCPE1234F" }])
      expect(() => prepareGrcPost("a", "recordPolicyAttestation", raw)).toThrow(
        expect.objectContaining({
          code: "IPB-PORT-003",
          meta: expect.objectContaining({ reason: "personal_data" }),
        }),
      );
    expect(() => prepareGrcPost("a", "recordPolicyAttestation", { ...att, version: "" })).toThrow();
    for (const dataClass of ["REGULATED", "SECRET", "INTERNAL"] as const)
      expect(() => assertGrcClass("a", { dataClass })).toThrow(
        expect.objectContaining({
          code: "IPB-PORT-003",
          meta: expect.objectContaining({ reason: "data_class" }),
        }),
      );
    expect(() => assertGrcClass("a", { dataClass: "CONFIDENTIAL" })).not.toThrow();
  });

  it("checks the obligation query, the obligation and the receipt", () => {
    expect(prepareGrcObligationQuery("a", undefined)).toEqual({});
    for (const bad of [
      { limit: 0 },
      { limit: 201 },
      { cursor: "a b" },
      { updatedSince: "x" },
      { q: 1 },
    ])
      expect(GrcObligationQuery.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    const o = {
      obligation_ref: "obl_01JA0000000000000000000001",
      version: 2,
      paragraph: "CF para 13(1)",
      text_sha256: "b".repeat(64),
      applicability_keys: ["nbfc.base"],
      effective_from: "2026-04-01",
      status: "ACTIVE",
      updated_at: T,
      text: "the obligation's text is never kept",
    };
    const parsed = GrcObligation.parse(o);
    expect("text" in parsed).toBe(false);
    expect(GrcObligation.safeParse({ ...o, status: "DRAFT" }).success).toBe(false);
    expect(
      GrcReceiptSchema.safeParse({
        resource: "PolicyAttestation",
        ref: "pa_1",
        idempotencyKey: "k",
        adapter: "generic-grc",
        receivedAt: T,
      }).success,
    ).toBe(true);
  });
});
