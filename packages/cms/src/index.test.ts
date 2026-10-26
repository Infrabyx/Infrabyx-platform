import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("cms", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/cms");
  });
});
