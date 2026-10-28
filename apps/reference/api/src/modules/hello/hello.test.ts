import { describe, expect, it } from "vitest";
import {
  checkMessage,
  HELLO_MESSAGE_CEILING,
  helloManifest,
  HELLO_MAX_LENGTH_KEY,
} from "./index.js";

describe("hello manifest (IPB-01-10)", () => {
  it("declares one schema, its RLS table, its setting and its help keys", () => {
    const m = helloManifest("LD");
    expect(m.schema).toBe("hello");
    expect(m.rlsTables).toEqual(["hello.greeting"]);
    expect(m.settings).toEqual([HELLO_MAX_LENGTH_KEY]);
    expect(m.publishes).toContain("in.ld.hello.GreetingCreated.v1");
    expect(m.helpKeys.every((k) => k.startsWith("hlp.hello."))).toBe(true);
  });
});

describe("checkMessage", () => {
  it("trims, refuses empty and refuses over the tenant limit, never above the ceiling", () => {
    expect(checkMessage("  hi  ", 10)).toBe("hi");
    expect(() => checkMessage("   ", 10)).toThrow(/empty/);
    expect(() => checkMessage("a".repeat(11), 10)).toThrow(/longer than 10/);
    expect(() => checkMessage("a".repeat(HELLO_MESSAGE_CEILING + 1), 10_000)).toThrow(
      new RegExp(`longer than ${HELLO_MESSAGE_CEILING}`),
    );
  });
});
