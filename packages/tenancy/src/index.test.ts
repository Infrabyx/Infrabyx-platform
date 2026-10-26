import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("tenancy", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/tenancy");
  });
});
