import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("vidhi", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@infrabyx/vidhi");
  });
});
