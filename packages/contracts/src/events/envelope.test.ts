import { describe, expect, it } from "vitest";
import { EcosystemEnvelope, InternalEnvelope, internalType, parseEnvelope } from "./envelope.js";
import { platformEventType } from "./platform-events.js";

const internalExample = {
  specversion: "1.0",
  id: "01J9ZC9Q2K7M8N3P4R5S6T7V8W",
  source: "/infrabyx/ld/documents",
  type: "in.ld.documents.DocumentSigned.v1",
  time: "2026-10-25T09:30:00.000Z",
  datacontenttype: "application/json",
  dataschema: "https://developers.lawdocs.in/events/in.ld.documents.DocumentSigned.v1.schema.json",
  subject: "doc_01J8Z0000000000000000000",
  tenantid: "tnt_01H00000000000000000000000",
  traceid: "4bf92f3577b34da6a3ce929d0e0e4736",
  actorid: `sha256:${"a".repeat(64)}`,
  dataclass: "INTERNAL",
  sequence: "42",
  environment: "live",
  data: { document_id: "doc_01J8Z0000000000000000000", signature_type: "AADHAAR_ESIGN" },
};

const ecosystemExample = {
  specversion: "1.0",
  id: "01922a4f-9a3c-7b1e-8f00-1234567890ab",
  source: "urn:infrabyx:finbyx:tnt_01H00000000000000000000000",
  type: "in.infrabyx.origination.LoanSanctioned.v1",
  subject: "app_01J9ZT8P1A2B",
  time: "2026-10-25T15:00:00+05:30",
  datacontenttype: "application/json",
  dataschema: "https://registry.infrabyx.in/schemas/origination/LoanSanctioned/1.0.0.json",
  tenantid: "tnt_01H00000000000000000000000",
  reid: "re_01H00000000000000000000000",
  productfamily: "PL",
  consentref: "cns_01J9ZT90QW",
  dataclass: "FINANCIAL",
  schemaver: "1.0.0",
  seq: 3,
  data: { application_id: "app_01J9ZT8P1A2B" },
};

describe("internal envelope (IPB-10-37, §10.4.9.1)", () => {
  it("accepts the IPB-10 example", () => {
    expect(InternalEnvelope.parse(internalExample)).toBeTruthy();
  });
  it("rejects cross-product types sent as internal (D-13)", () => {
    expect(
      InternalEnvelope.safeParse({
        ...internalExample,
        type: "in.infrabyx.platform.ProviderIncident.v1",
      }).success,
    ).toBe(false);
  });
  it("rejects non-ULID ids and unhashed actor ids", () => {
    expect(InternalEnvelope.safeParse({ ...internalExample, id: "not-a-ulid" }).success).toBe(
      false,
    );
    expect(InternalEnvelope.safeParse({ ...internalExample, actorid: "usr_123" }).success).toBe(
      false,
    );
  });
  it("builds type names", () => {
    expect(internalType("LDC", "settings", "SettingChanged")).toBe(
      "in.ldc.settings.SettingChanged.v1",
    );
    expect(platformEventType("FBX", "ApprovalDecided")).toBe("in.fbx.security.ApprovalDecided.v1");
    expect(() => internalType("infrabyx", "x", "Y")).toThrow();
  });
});

describe("ecosystem envelope (Ecosystem Spec v1.2 §3.2)", () => {
  it("accepts a Spec-shaped event", () => {
    expect(EcosystemEnvelope.parse(ecosystemExample)).toBeTruthy();
  });
  it("requires consentref or legalbasis for personal data", () => {
    const { consentref: _c, ...noConsent } = ecosystemExample;
    expect(EcosystemEnvelope.safeParse(noConsent).success).toBe(false);
    expect(
      EcosystemEnvelope.safeParse({ ...noConsent, legalbasis: "STATUTORY_REPORTING" }).success,
    ).toBe(true);
    expect(EcosystemEnvelope.safeParse({ ...noConsent, dataclass: "INTERNAL" }).success).toBe(true);
  });
  it("requires UUIDv7 ids and urn sources", () => {
    expect(
      EcosystemEnvelope.safeParse({ ...ecosystemExample, id: "01J9ZC9Q2K7M8N3P4R5S6T7V8W" })
        .success,
    ).toBe(false);
    expect(
      EcosystemEnvelope.safeParse({ ...ecosystemExample, source: "/infrabyx/fbx/loans" }).success,
    ).toBe(false);
  });
  it("routes by type in parseEnvelope", () => {
    expect(parseEnvelope(ecosystemExample).kind).toBe("ecosystem");
    expect(parseEnvelope(internalExample).kind).toBe("internal");
    expect(() => parseEnvelope({ ...ecosystemExample, id: "x" })).toThrow();
  });
});
