// IPB-06-44 formatters (the @IPB-06-AT-22 rendering for en-IN and hi-IN) and the catalogues.
import { describe, expect, it } from "vitest";
import {
  amountInWords,
  BASE_MESSAGE_KEYS,
  baseCatalogue,
  formatAmountInr,
  formatDate,
  localeFallbacks,
  messages,
} from "./index.js";

describe("Indian formatting", () => {
  it("groups digits the Indian way from integer paise", () => {
    expect(formatAmountInr(123_456_700)).toBe("₹12,34,567.00");
    expect(formatAmountInr(-5)).toBe("-₹0.05");
    expect(formatAmountInr(99_00, { fractionDigits: 0 })).toBe("₹99");
    expect(() => formatAmountInr(1.5)).toThrow();
  });

  it("writes amounts in words in the Indian system", () => {
    expect(amountInWords(1_234_567)).toBe(
      "twelve lakh thirty-four thousand five hundred sixty-seven rupees",
    );
    expect(amountInWords(1)).toBe("one rupee");
    expect(amountInWords(10_00_00_000)).toBe("ten crore rupees");
    expect(amountInWords(1_234_567, "hi-IN")).toBe("बारह लाख चौंतीस हज़ार पाँच सौ सड़सठ रुपये");
  });

  it("shows dates as DD MMM YYYY in Asia/Kolkata", () => {
    // 20:00 UTC on 31 Oct is 01:30 on 1 Nov in India.
    expect(formatDate("2026-10-31T20:00:00Z")).toBe("01 Nov 2026");
  });
});

describe("catalogues", () => {
  it("falls back locale → hi → en", () => {
    expect(localeFallbacks("ta-IN")).toEqual(["ta-IN", "hi-IN", "en-IN"]);
    expect(messages("ta-IN").t("ui.skip.main")).toBe("मुख्य सामग्री पर जाएँ");
    expect(messages("en-IN").t("ui.help.button", { label: "PAN" })).toBe("Help: PAN");
  });

  it("has every base key in Hindi too", () => {
    const hi = baseCatalogue("hi-IN")!;
    expect(BASE_MESSAGE_KEYS.filter((k) => !(k in hi))).toEqual([]);
  });
});
