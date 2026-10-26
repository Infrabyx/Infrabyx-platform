import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("rules", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/rules");
  });
});
