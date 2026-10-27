import { describe, expect, it } from "vitest";
import { generateWebhookSecret } from "@infrabyx/crypto";
import { MemoryStorage } from "@infrabyx/testing";
import {
  assertBodyClass,
  checkSharedSecret,
  ipAllowed,
  loadAttachments,
  vendorError,
  withinWindow,
} from "./common.js";

const d = { port: "SMS", adapter: "x", residency: "IN", maxDataClass: "INTERNAL" } as const;

describe("messaging helpers (PL2 plan §6.10–6.12)", () => {
  it("bodies above INTERNAL are refused; INTERNAL and below pass", () => {
    expect(() => assertBodyClass(d)).not.toThrow();
    expect(() => assertBodyClass(d, { dataClass: "PUBLIC" })).not.toThrow();
    expect(() => assertBodyClass(d, { dataClass: "CONFIDENTIAL" })).toThrow(/secure link/);
  });

  it("IPv4 CIDR matching; IPv6 and garbage never match", () => {
    expect(ipAllowed("1.179.112.10", ["1.179.112.0/20"])).toBe(true);
    expect(ipAllowed("1.179.128.1", ["1.179.112.0/20"])).toBe(false);
    expect(ipAllowed("::ffff:172.246.240.5", ["172.246.240.0/20"])).toBe(true);
    expect(ipAllowed("10.0.0.1", ["10.0.0.1"])).toBe(true);
    expect(ipAllowed("2001:db8::1", ["0.0.0.0/0"])).toBe(false);
    expect(ipAllowed(undefined, ["0.0.0.0/0"])).toBe(false);
    expect(ipAllowed("300.1.1.1", ["0.0.0.0/0"])).toBe(false);
  });

  it("shared secret: bearer or URL credentials, and the source range when configured", async () => {
    const s = generateWebhookSecret();
    const auth = { secret: () => s, sourceCidrs: ["198.51.100.0/24"] };
    await expect(
      checkSharedSecret("SMS", "x", auth, { Authorization: `Bearer ${s}` }, "198.51.100.7"),
    ).resolves.toBeUndefined();
    const basic = Buffer.from(`ipb:${s}`).toString("base64");
    await expect(
      checkSharedSecret("SMS", "x", auth, { authorization: `Basic ${basic}` }, "198.51.100.7"),
    ).resolves.toBeUndefined();
    await expect(
      checkSharedSecret("SMS", "x", auth, { authorization: `Bearer ${s}` }, "203.0.113.1"),
    ).rejects.toMatchObject({ code: "IPB-API-018" });
    await expect(
      checkSharedSecret("SMS", "x", auth, { authorization: "Bearer nope" }, "198.51.100.7"),
    ).rejects.toMatchObject({ code: "IPB-API-018" });
    await expect(checkSharedSecret("SMS", "x", auth, {}, "198.51.100.7")).rejects.toMatchObject({
      code: "IPB-API-018",
    });
  });

  it("timestamp windows", () => {
    expect(withinWindow(1_000_000, 300_000, 1_200_000)).toBe(true);
    expect(withinWindow(1_000_000, 300_000, 1_400_000)).toBe(false);
    expect(withinWindow(Number.NaN, 300_000)).toBe(false);
  });

  it("vendor errors: 4xx is a definite refusal, 429 and 5xx leave the outcome unknown", () => {
    expect(vendorError("SMS", "x", 400, "send")).toMatchObject({
      code: "IPB-PORT-001",
      meta: { definite: true, reason: "vendor_rejected" },
    });
    expect(vendorError("SMS", "x", 401, "send").meta).toMatchObject({ reason: "credentials" });
    expect(vendorError("SMS", "x", 503, "send").code).toBe("IPB-PORT-002");
    expect(vendorError("SMS", "x", 429, "send").meta?.definite).toBeUndefined();
  });

  it("attachments need STORAGE and stay within 10 files", async () => {
    const e = { ...d, port: "EMAIL" } as const;
    await expect(loadAttachments(e, ["k"], undefined)).rejects.toMatchObject({
      code: "IPB-PORT-003",
    });
    const keys = Array.from({ length: 11 }, (_, i) => `k${i}`);
    await expect(loadAttachments(e, keys, new MemoryStorage())).rejects.toThrow(/10 attachments/);
    expect(await loadAttachments(e, [], undefined)).toEqual([]);
  });
});
