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

  it("redacts credential-named query parameters such as the webhook ipb_token (PL2-D-65)", () => {
    const t = "GET /hooks/gupshup?externalId=abc&ipb_token=SeCrEt-123_x&status=SUCCESS";
    const out = scrubText(t);
    expect(out).not.toContain("SeCrEt-123_x");
    expect(out).toContain("ipb_token=[REDACTED]&status=SUCCESS");
    expect(s.attrs({ "url.query": "a=1&api_key=k9&sig=zz" })["url.query"]).toBe(
      "a=1&api_key=[REDACTED]&sig=[REDACTED]",
    );
    expect(scrubText("ipb_token=abc123&x=1")).toBe("ipb_token=[REDACTED]&x=1");
    expect(scrubText("/v1/x?externalId=abc&status=SUCCESS")).toBe(
      "/v1/x?externalId=abc&status=SUCCESS",
    );
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

  // PR-UDF-007: every masked field of IPB-02 §02.4.3.3 and IPB-02-22, under its rule key, the
  // spellings products use, and inside a log message.
  const FIELDS: ReadonlyArray<{ raw: string; masked: string; keys: string[]; text: string[] }> = [
    {
      raw: "50100123456789",
      masked: "XXXX6789",
      keys: [
        "bank_account",
        "account_number",
        "accountNumber",
        "bank_account_number",
        "bankAccountNo",
        "acct_no",
        "beneficiary_account_number",
      ],
      text: ["account_number=50100123456789", "A/c no. 50100123456789", "a/c 5010 0123 4567 89"],
    },
    {
      raw: "123456789",
      masked: "XXXX6789",
      keys: ["account_number", "accountNo"],
      text: ["account 123456789", "credited to 123456789 today", "acct: 123456789"],
    },
    {
      raw: "12345678901",
      masked: "XXXX8901",
      keys: ["account_number"],
      text: ['{"account_number":"12345678901"}', "transfer to 12345678901 failed"],
    },
    {
      raw: "9999 1234 5678",
      masked: "XXXX XXXX 5678",
      keys: ["aadhaar", "aadhaar_number", "aadhaarNo", "aadhar"],
      text: ["aadhaar 9999 1234 5678", "uid 999912345678 checked"],
    },
    {
      raw: "ABCDE1234F",
      masked: "ABCXX1234X",
      keys: ["pan", "pan_number", "panNo", "borrower_pan"],
      text: ["pan ABCDE1234F verified"],
    },
    {
      raw: "4111 1111 1111 1111",
      masked: "XXXX XXXX XXXX 1111",
      keys: ["card_pan", "card_number", "cardNo"],
      text: ["card 4111 1111 1111 1111", "card 4111-1111-1111-1111"],
    },
    {
      raw: "9876543210",
      masked: "XXXXXXX210",
      keys: ["mobile", "mobile_number", "phone", "phoneNumber", "customer_mobile", "msisdn"],
      text: ["sms to 9876543210", "sms to 98765 43210", "sms to +91-9876543210"],
    },
    {
      raw: "ravi@example.in",
      masked: "rXXX@example.in",
      keys: ["email", "email_address", "emailId", "customer_email"],
      text: ["mail ravi@example.in"],
    },
    {
      raw: "J8369854",
      masked: "XXXXX854",
      keys: ["passport", "passport_number", "passportNo"],
      text: ["passport J8369854 seen", "passport J83 69854 seen"],
    },
  ];

  it.each(FIELDS)("masks $keys.0 under every key spelling and in free text", (f) => {
    for (const key of f.keys) {
      expect(s.attrs({ [key]: f.raw }), key).toEqual({ [key]: f.masked });
      expect(s.attrs({ loan: { [key]: f.raw } }), `loan.${key}`).toEqual({
        [`loan.${key}`]: f.masked,
      });
    }
    for (const line of f.text) {
      const out = scrubText(line);
      expect(out, line).not.toMatch(/\d{5,}/);
      for (const part of f.raw.split(" "))
        if (part.length > 4) expect(out, line).not.toContain(part);
    }
  });

  it("redacts one-time codes and card security codes by key and in free text", () => {
    for (const key of [
      "otp",
      "otp_code",
      "otpCode",
      "sms_otp",
      "emailOtp",
      "totp",
      "otp_value",
      "mpin",
      "cvv",
      "card_cvv",
      "passcode",
      "pin",
      "password",
    ])
      expect(s.attrs({ [key]: "482913" }), key).toEqual({ [key]: "[REDACTED]" });
    expect(s.attrs({ verify: { otp: { code: "482913" } } })).toEqual({});

    for (const [line, kept] of [
      ["otp=482913", "otp=[REDACTED]"],
      ["POST /verify?otp=482913&ref=a1", "otp=[REDACTED]&ref=a1"],
      ["otp_code=482913", "otp_code=[REDACTED]"],
      ["OTP 482913 sent", "OTP [REDACTED] sent"],
      ["Your OTP is 482913. Do not share it.", "Your OTP is [REDACTED]."],
      ["otp: 482913", "otp: [REDACTED]"],
      ['{"otp":"482913","ok":true}', '"otp":"[REDACTED]"'],
      ["otp_code: 4829", "otp_code: [REDACTED]"],
      ["482913 is your OTP for sign-in", "[REDACTED] is your OTP"],
      ["Use 48291355 as your one-time password", "Use [REDACTED] as your one-time password"],
      ["verification code 482913", "verification code [REDACTED]"],
      ["cvv 123 entered", "cvv [REDACTED] entered"],
      ["cvv=123", "cvv=[REDACTED]"],
    ] as const) {
      const out = scrubText(line);
      expect(out, line).toContain(kept);
      expect(out, line).not.toMatch(/4829|cvv.?123/);
    }
  });

  it("leaves ordinary text, short numbers and non-sensitive keys alone", () => {
    expect(scrubText("retry 3 of 5 after 250 ms, status 404, order 12345678")).toBe(
      "retry 3 of 5 after 250 ms, status 404, order 12345678",
    );
    expect(
      s.attrs({
        account_id: "acc_1",
        account_type: "savings",
        card_status: "active",
        email_verified: true,
        "gen_ai.usage.input_tokens": 120,
        duration_ms: 12345678901,
      }),
    ).toEqual({
      account_id: "acc_1",
      account_type: "savings",
      card_status: "active",
      email_verified: true,
      "gen_ai.usage.input_tokens": 120,
      duration_ms: 12345678901,
    });
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
