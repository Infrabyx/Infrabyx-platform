import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("testing", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/testing");
  });
});
