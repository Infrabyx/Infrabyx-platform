// The JVM mitigation every JVM-carrying test image is started with (CVE-2026-114938; owner answer
// #143, OWNER-WAIVER-CRIT-01, R1-D-192). The live JVMs are checked in the `containers` job
// (infra/docker/jvm-mitigation.e2e.test.mjs); this is the harness half.
import { describe, expect, it } from "vitest";
import {
  JVM_BASE64_INTRINSIC_OFF,
  TEST_IMAGES,
  TEST_IMAGE_JVM_OPTIONS_VAR,
  withJvmMitigation,
} from "./containers.js";

describe("withJvmMitigation (R1-D-192)", () => {
  it("is the flag the owner named", () => {
    expect(JVM_BASE64_INTRINSIC_OFF).toBe("-XX:-UseBASE64Intrinsics");
  });

  it("covers exactly the test images that carry a JVM (scan of 19 Nov 2026)", () => {
    expect(Object.keys(TEST_IMAGE_JVM_OPTIONS_VAR).sort()).toEqual([
      "gotenberg",
      "keycloak",
      "localstack",
    ]);
    for (const name of Object.keys(TEST_IMAGE_JVM_OPTIONS_VAR))
      expect(TEST_IMAGES).toHaveProperty(name);
  });

  it("sets the flag on an image's variable when the caller sets nothing", () => {
    expect(withJvmMitigation("keycloak")).toEqual({ JAVA_OPTS_APPEND: "-XX:-UseBASE64Intrinsics" });
    expect(withJvmMitigation("gotenberg", { A: "1" })).toEqual({
      A: "1",
      JAVA_TOOL_OPTIONS: "-XX:-UseBASE64Intrinsics",
    });
  });

  it("appends the flag after the caller's own options, so a re-enabling flag loses", () => {
    expect(
      withJvmMitigation("keycloak", { JAVA_OPTS_APPEND: "-Xmx1g -XX:+UseBASE64Intrinsics" }),
    ).toEqual({ JAVA_OPTS_APPEND: "-Xmx1g -XX:+UseBASE64Intrinsics -XX:-UseBASE64Intrinsics" });
  });

  it("does not repeat the flag when it is already last, and leaves images without a JVM alone", () => {
    const env = { JAVA_TOOL_OPTIONS: "-Xss1m -XX:-UseBASE64Intrinsics" };
    expect(withJvmMitigation("localstack", env)).toEqual(env);
    expect(withJvmMitigation("cerbos", { X: "y" })).toEqual({ X: "y" });
    expect(withJvmMitigation("postgres")).toEqual({});
  });

  it("does not change the caller's object", () => {
    const env = { JAVA_OPTS_APPEND: "-Xmx1g" };
    withJvmMitigation("keycloak", env);
    expect(env).toEqual({ JAVA_OPTS_APPEND: "-Xmx1g" });
  });
});
