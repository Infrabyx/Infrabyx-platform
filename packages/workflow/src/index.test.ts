import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("workflow", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/workflow");
  });
});
