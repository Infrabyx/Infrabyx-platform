import { describe, expect, it } from "vitest";
import { OtelObservability, type OtelOptions } from "../otel.js";
import { createScrubber, scrubText } from "../scrub.js";

const hashId = (id: string) => `h(${id})`;
const base: OtelOptions = {
  serviceName: "test",
  env: "test",
  profile: "collector",
  endpoint: null,
  samplingRatio: 1,
  hashId,
};

describe("@IPB-02-23 telemetry scrubber", () => {
  const s = createScrubber(hashId);

  it("masks REGULATED patterns in free text", () => {
    const out = scrubText(
      "pan ABCDE1234F aadhaar 1234 5678 9012 card 4111 1111 1111 1111 mobile +91 9876543210 mail ravi@example.in",
    );
    for (const raw of [
      "ABCDE1234F",
      "1234 5678 9012",
      "4111 1111 1111 1111",
      "9876543210",
      "ravi@example.in",
    ])
      expect(out).not.toContain(raw);
    expect(out).toContain("XXXX XXXX 9012");
    expect(out).toContain("XXXX XXXX XXXX 1111");
  });

  it("masks by key, redacts credentials, hashes identifiers and drops payloads", () => {
    expect(
      s.attrs({
        pan: "ABCDE1234F",
        api_key: "k",
        authorization: "Bearer x",
        tenant_id: "tnt_a",
        userId: "usr_1",
        body: "hello",
        nested: { email: "a@b.co", headers: { cookie: "c" }, n: 3 },
        list: ["ravi@example.in", 2],
        when: new Date(0),
      }),
    ).toEqual({
      pan: "ABCXX1234X",
      api_key: "[REDACTED]",
      authorization: "[REDACTED]",
      tenant_id: "h(tnt_a)",
      userId: "h(usr_1)",
      "nested.email": "aX@b.co",
      "nested.n": 3,
      list: JSON.stringify(["rXXX@example.in", 2]),
      when: "1970-01-01T00:00:00.000Z",
    });
  });

  it("passes through identifiers the caller already hashed, and only well-formed ones", () => {
    const pre = new Set(["tenant_id"]);
    expect(s.attrs({ tenant_id: "0f3a" }, pre)).toEqual({ tenant_id: "0f3a" });
    expect(s.attrs({ tenant_id: "raw tenant@x" }, pre)).toEqual({});
  });

  it("drops identifiers when no hasher is configured", () => {
    expect(createScrubber().attrs({ tenant_id: "tnt_a", ok: true })).toEqual({ ok: true });
  });
});

describe("otel adapter guards (PL2 plan §6.3)", () => {
  it("refuses content capture, plain HTTP outside local, and profile/header mismatches", () => {
    expect(() => new OtelObservability({ ...base, captureGenAiContent: true })).toThrow(
      /locked false/,
    );
    expect(() => new OtelObservability({ ...base, endpoint: "http://c:4318" })).toThrow(/https/);
    expect(
      () =>
        new OtelObservability({
          ...base,
          profile: "otlp-direct",
          endpoint: "https://intake.example",
        }),
    ).toThrow(/auth headers/);
    expect(
      () =>
        new OtelObservability({
          ...base,
          endpoint: "https://c:4318",
          headers: { authorization: "x" },
        }),
    ).toThrow(/no auth headers/);
    expect(() => new OtelObservability({ ...base, samplingRatio: 2 })).toThrow(/samplingRatio/);
  });

  it("declares IN / INTERNAL and reports its export configuration", async () => {
    const o = new OtelObservability(base);
    expect(o.descriptor).toMatchObject({
      port: "OBSERVABILITY",
      residency: "IN",
      maxDataClass: "INTERNAL",
    });
    expect(o.exportConfig()).toEqual({ endpoint: null, samplingRatio: 1, profile: "collector" });
    expect((await o.health()).status).toBe("up");
    await o.shutdown();
  });
});
