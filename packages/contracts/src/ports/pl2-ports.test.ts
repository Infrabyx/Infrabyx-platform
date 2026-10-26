import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EmailMessage,
  OrderSpec,
  PL2_PORTS,
  PORT_CATALOGUE,
  QueueJobData,
  RefundSpec,
  SmsMessage,
  WhatsappSessionMessage,
  WhatsappTemplateMessage,
  classed,
  decimalToMinor,
  effectiveDataClass,
  minorToDecimal,
  payloadClass,
  portDefaultDataClass,
} from "./index.js";

describe("@IPB-01-16 data-class floor (PL2-D-03)", () => {
  it("defaults per port: messaging, queue, flags, telemetry INTERNAL; payments REGULATED; others CONFIDENTIAL", () => {
    expect(portDefaultDataClass("EMAIL")).toBe("INTERNAL");
    expect(portDefaultDataClass("PAYMENTS")).toBe("REGULATED");
    expect(portDefaultDataClass("STORAGE")).toBe("CONFIDENTIAL");
  });

  it("a caller may raise the class but never lower it below the port default", () => {
    expect(effectiveDataClass("STORAGE")).toBe("CONFIDENTIAL");
    expect(effectiveDataClass("STORAGE", { dataClass: "REGULATED" })).toBe("REGULATED");
    expect(() => effectiveDataClass("STORAGE", { dataClass: "INTERNAL" })).toThrow(
      expect.objectContaining({ code: "IPB-PORT-003" }),
    );
    expect(() => effectiveDataClass("PAYMENTS", { dataClass: "CONFIDENTIAL" })).toThrow(
      expect.objectContaining({ code: "IPB-PORT-003" }),
    );
  });

  it("only a fully annotated payload may go below the port default", () => {
    const full = z.object({ a: classed(z.string(), "PUBLIC"), b: classed(z.number(), "INTERNAL") });
    const partial = z.object({ a: classed(z.string(), "PUBLIC"), b: z.number() });
    expect(payloadClass(full)).toMatchObject({ complete: true, bodyHighest: "INTERNAL" });
    expect(payloadClass(partial)).toMatchObject({ complete: false, unannotated: ["b"] });
    expect(effectiveDataClass("STORAGE", undefined, payloadClass(full))).toBe("INTERNAL");
    expect(effectiveDataClass("STORAGE", undefined, payloadClass(partial))).toBe("CONFIDENTIAL");
  });

  it("annotations raise the class above the port default", () => {
    const hot = z.object({ pan: classed(z.string(), "REGULATED") });
    expect(effectiveDataClass("EMAIL", undefined, payloadClass(hot))).toBe("REGULATED");
  });

  it("every PL2 payload schema is fully annotated and recipients are delivery-only (IPB-DEV-05)", () => {
    const schemas = {
      EmailMessage,
      SmsMessage,
      WhatsappTemplateMessage,
      WhatsappSessionMessage,
      OrderSpec,
      RefundSpec,
      QueueJobData,
    };
    for (const [name, s] of Object.entries(schemas)) {
      const r = payloadClass(s);
      expect(r.unannotated, name).toEqual([]);
    }
    expect(payloadClass(EmailMessage)).toMatchObject({
      bodyHighest: "INTERNAL",
      recipientFields: ["to[]", "cc[]"],
    });
    expect(payloadClass(SmsMessage).recipientFields).toEqual(["to"]);
    expect(payloadClass(OrderSpec).bodyHighest).toBe("REGULATED");
  });
});

describe("PAYMENTS amounts (P-04): integer arithmetic only", () => {
  it.each([
    [1, "0.01"],
    [100, "1.00"],
    [12345, "123.45"],
    [Number.MAX_SAFE_INTEGER, "90071992547409.91"],
  ])("%d paise ⇄ %s", (minor, dec) => {
    expect(minorToDecimal(minor)).toBe(dec);
    expect(decimalToMinor(dec)).toBe(minor);
  });

  it("accepts trailing zeros, refuses inexact or malformed amounts", () => {
    expect(decimalToMinor("10.5")).toBe(1050);
    expect(decimalToMinor("10.500")).toBe(1050);
    expect(() => decimalToMinor("10.505")).toThrow();
    expect(() => decimalToMinor("1e3")).toThrow();
    expect(() => decimalToMinor("-1.00")).toThrow();
    expect(() => minorToDecimal(1.5)).toThrow();
  });

  it("OrderSpec rejects floats, zero and non-INR currencies", () => {
    const base = { customerRef: "cus_1", currency: "INR" as const };
    expect(OrderSpec.safeParse({ ...base, amountMinor: 10.5 }).success).toBe(false);
    expect(OrderSpec.safeParse({ ...base, amountMinor: 0 }).success).toBe(false);
    expect(OrderSpec.safeParse({ ...base, amountMinor: 100, currency: "USD" }).success).toBe(false);
    expect(OrderSpec.safeParse({ ...base, amountMinor: 100 }).success).toBe(true);
  });
});

describe("PL2 catalogue", () => {
  it("defines an interface for each of the thirteen PL2 ports", () => {
    for (const p of PL2_PORTS) expect(PORT_CATALOGUE[p].interfaceDefined, p).toBe(true);
  });
});
