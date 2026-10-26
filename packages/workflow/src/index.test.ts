import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("workflow", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/workflow");
  });
});
