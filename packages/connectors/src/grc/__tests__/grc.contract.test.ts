// GRC contract legs (Finbyx PR-FBX-51, R1-D-220, ADR-0013). Hermetic: the `generic-grc` adapter
// against the §9.2 stub, whose shapes are stub-shaped [VERIFY] until a counterparty sandbox exists,
// and the fake (the CI-green alternative). Then what only the generic adapter promises: off until
// its flag, its host required, the token and the Idempotency-Key on every POST, nothing sent for a
// refused body, a keyed POST resent through an outage, and the counterparty's answers checked.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FakeGrc,
  defineContractSuite,
  grcContractCases,
  grcFakeFixtures,
  grcObligations,
  grcSamples,
  startGrcStub,
  type GrcFixtures,
  type GrcStub,
} from "@infrabyx/testing";
import { GenericGrc, grcHttpRefusal, mapGrcObligationPage, mapGrcReceipt } from "../generic.js";

let stub: GrcStub;
let enabled = true;
let host = "grc.example.in";

beforeAll(async () => {
  stub = await startGrcStub();
});
afterAll(async () => stub?.close());

const generic = () =>
  new GenericGrc({
    enabled: () => enabled,
    host: () => host,
    token: () => stub.token,
    baseUrl: stub.url,
    allowLoopbackHttp: true,
  });

describe("@IPB-01-15 GRC hermetic leg (generic-grc, stub)", () => {
  const fixtures: GrcFixtures<GenericGrc> = {
    seedObligations: (_p, o) => stub.seed(o),
    accepted: () => stub.accepted(),
  };
  defineContractSuite("GRC", generic, grcContractCases(fixtures), { leg: "hermetic" });
});

describe("@IPB-01-15 GRC hermetic leg (fake-grc, the alternative)", () => {
  const fake = new FakeGrc();
  defineContractSuite("GRC", () => fake, grcContractCases(grcFakeFixtures), { leg: "hermetic" });
});

describe("R1-D-220 the generic GRC adapter", () => {
  it("is off until its flag: nothing is sent, and health is down", async () => {
    enabled = false;
    try {
      const sent = stub.requests.length;
      await expect(generic().raiseIssue(grcSamples.raiseIssue())).rejects.toMatchObject({
        code: "IPB-PORT-001",
        meta: { reason: "adapter_disabled" },
      });
      await expect(generic().listObligations()).rejects.toMatchObject({
        meta: { reason: "adapter_disabled" },
      });
      expect((await generic().health()).status).toBe("down");
      expect(stub.requests.length).toBe(sent);
    } finally {
      enabled = true;
    }
  });

  it("needs its host, and calls no other", async () => {
    for (const bad of ["", "not a host", "https://grc.example.in/x"]) {
      host = bad;
      try {
        await expect(generic().raiseIssue(grcSamples.raiseIssue())).rejects.toMatchObject({
          code: "IPB-PORT-001",
          meta: { reason: "adapter_unconfigured" },
        });
        expect((await generic().health()).status).toBe("down");
      } finally {
        host = "grc.example.in";
      }
    }
    expect((await generic().health()).status).toBe("up");
  });

  it("sends the token, the Idempotency-Key and the event data as JSON; nothing for a refused body", async () => {
    const d = grcSamples.publishControlTestResult();
    const r = await generic().publishControlTestResult(d);
    const sent = stub.posts().at(-1)!;
    expect(sent.path).toBe("/v1/grc/control-test-results");
    expect(sent.headers.authorization).toBe(`Bearer ${stub.token}`);
    expect(sent.headers["idempotency-key"]).toBe(r.idempotencyKey);
    expect(sent.headers["content-type"]).toBe("application/json");
    expect(sent.json()).toEqual(d);
    const before = stub.requests.length;
    await expect(
      generic().recordPolicyAttestation({
        ...grcSamples.recordPolicyAttestation(),
        user_ref: "ABCPE1234F",
      }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003", meta: { reason: "personal_data" } });
    await expect(
      generic().raiseIssue(grcSamples.raiseIssue(), { dataClass: "REGULATED" }),
    ).rejects.toMatchObject({ code: "IPB-PORT-003" });
    expect(stub.requests.length).toBe(before);
  });

  it("resends a keyed POST through an outage, and the counterparty keeps one record", async () => {
    const before = stub.accepted();
    stub.failNext(2, 503);
    const r = await generic().raiseIssue(grcSamples.raiseIssue());
    expect(r.resource).toBe("Issue");
    expect(stub.accepted()).toBe(before + 1);
    stub.failNext(3, 503);
    await expect(generic().raiseIssue(grcSamples.raiseIssue())).rejects.toMatchObject({
      code: "IPB-PORT-002",
    });
  });

  it("checks the counterparty's answers and maps its refusals", async () => {
    stub.seed(grcObligations(1));
    const page = await generic().listObligations();
    expect(Object.keys(page.items[0]!)).not.toContain("internal_note");
    expect(() => mapGrcObligationPage({})).toThrow();
    expect(() => mapGrcObligationPage({ items: [{ obligation_ref: "x" }] })).toThrow();
    expect(() => mapGrcObligationPage({ items: [], next_cursor: 5 })).toThrow();
    expect(mapGrcObligationPage({ items: [], next_cursor: null })).toEqual({ items: [] });
    const post = {
      method: "raiseIssue" as const,
      resource: "Issue" as const,
      path: "/v1/grc/issues",
      data: {},
      idempotencyKey: "k",
    };
    expect(() => mapGrcReceipt(post, { received_at: "x" }, new Date())).toThrow();
    expect(mapGrcReceipt(post, { id: "rec_1" }, new Date(0)).receivedAt).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(grcHttpRefusal(409, {}, "x")).toMatchObject({ code: "IPB-PORT-002" });
    expect(grcHttpRefusal(422, { code: "other" }, "x")).toMatchObject({ code: "IPB-PORT-001" });
    expect(grcHttpRefusal(401, {}, "x")).toMatchObject({ meta: { reason: "credentials" } });
  });
});
