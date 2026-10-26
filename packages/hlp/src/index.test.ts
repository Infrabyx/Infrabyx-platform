import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("hlp", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/hlp");
  });
});
