// CVE-2026-114938 ("Java4Shell"; owner answer #143, waiver OWNER-WAIVER-CRIT-01, R1-D-192): every
// definition the platform ships that starts an OpenJDK JVM carries -XX:-UseBASE64Intrinsics, every
// image is classified (JVM or none), and the CRITICAL waiver exists only together with the
// mitigation. Static checks; jvm-mitigation.e2e.test.mjs reads the flag from the live JVMs in the
// `containers` job.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  JVM_BASE64_INTRINSIC_OFF,
  TEST_IMAGES,
  TEST_IMAGE_JVM_OPTIONS_VAR,
} from "../../packages/testing/src/images.ts";
import { JVM_IMAGES, JVM_MITIGATION, NO_JVM_IMAGES, repository } from "./jvm-images.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
const compose = parse(read("infra/compose/docker-compose.yml"));
const KC = "infra/keycloak/customer-otp";
const known = (repo) => repo in JVM_IMAGES || NO_JVM_IMAGES.includes(repo);
const envOf = (service) => {
  const e = service.environment ?? {};
  return Array.isArray(e) ? Object.fromEntries(e.map((x) => x.split(/=(.*)/s).slice(0, 2))) : e;
};
const endsWithFlag = (value) =>
  String(value ?? "")
    .trim()
    .split(/\s+/)
    .at(-1) === JVM_MITIGATION;

describe("@IPB-01-AT-15 JVM mitigation for CVE-2026-114938 (R1-D-192): definitions", () => {
  it("is one flag everywhere", () => {
    expect(JVM_MITIGATION).toBe("-XX:-UseBASE64Intrinsics");
    expect(JVM_BASE64_INTRINSIC_OFF).toBe(JVM_MITIGATION);
  });

  it("every Compose service runs an image that was scanned, and each JVM service carries the flag last", () => {
    const jvmServices = [];
    for (const [name, service] of Object.entries(compose.services)) {
      const repo = repository(service.image);
      if (repo.startsWith("infrabyx/")) continue; // built here; checked below
      expect(known(repo), `${name}: ${repo} was never scanned for a JVM`).toBe(true);
      if (!(repo in JVM_IMAGES)) continue;
      jvmServices.push(name);
      const { variable } = JVM_IMAGES[repo];
      expect(endsWithFlag(envOf(service)[variable]), `${name}: ${variable}`).toBe(true);
    }
    expect(jvmServices.sort()).toEqual(["gotenberg", "keycloak", "opensearch"]);
  });

  it("every test image was scanned, and the harness sets the flag on each JVM image's variable", () => {
    const jvm = {};
    for (const [name, { image }] of Object.entries(TEST_IMAGES)) {
      const repo = repository(image);
      expect(known(repo), `${name}: ${repo} was never scanned for a JVM`).toBe(true);
      if (repo in JVM_IMAGES) jvm[name] = JVM_IMAGES[repo].variable;
    }
    expect(TEST_IMAGE_JVM_OPTIONS_VAR).toEqual(jvm);
  });

  it("the images built here run on a base without a JVM", () => {
    const files = [
      ...readdirSync(join(ROOT, "infra/docker"), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => `infra/docker/${d.name}/Dockerfile`),
      "infra/compose/minio/Dockerfile",
    ];
    for (const f of files) {
      const stages = [...read(f).matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
      // The last stage is what ships; earlier stages only build.
      expect(NO_JVM_IMAGES, f).toContain(repository(stages.at(-1)));
    }
  });

  it("the Keycloak customer image sets the flag in its ENV, its entrypoint and its build check", () => {
    const dockerfile = read(KC, "Dockerfile");
    expect(dockerfile).toContain(`ENV JAVA_OPTS_APPEND="${JVM_MITIGATION}"`);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\/opt\/keycloak\/bin\/ipb-kc\.sh"\]$/m);
    expect(dockerfile).toMatch(/&& \/opt\/keycloak\/bin\/ipb-kc\.sh --ipb-verify-jvm \\\n/);
    // The entrypoint is the last instruction that sets it: nothing after it replaces it.
    expect(dockerfile.trimEnd().split("\n").at(-1)).not.toMatch(/^ENTRYPOINT/);
    expect(dockerfile.match(/^ENTRYPOINT/gm)).toHaveLength(1);
  });

  it("the entrypoint appends the flag last, refuses JVM variables that name it, and hands over to kc.sh", () => {
    const sh = read(KC, "ipb-kc.sh");
    expect(sh).toContain(`readonly IPB_JVM_MITIGATION="${JVM_MITIGATION}"`);
    expect(sh).toContain("for var in _JAVA_OPTIONS JDK_JAVA_OPTIONS JAVA_TOOL_OPTIONS; do");
    expect(sh).toContain(
      'export JAVA_OPTS_APPEND="${JAVA_OPTS_APPEND:+${JAVA_OPTS_APPEND} }${IPB_JVM_MITIGATION}"',
    );
    expect(sh).toMatch(/\nexec \/opt\/keycloak\/bin\/kc\.sh "\$@"\n$/);
    expect(sh.startsWith("#!/bin/bash\n")).toBe(true);
    expect(sh).toContain("set -euo pipefail");
  });

  it("the CRITICAL waiver is OWNER-WAIVER-CRIT-01 only: one CVE, one package build, to 15 Dec 2026 at the latest", () => {
    const ignore = parse(read("infra/docker/trivyignore.yaml"));
    const entries = ignore.vulnerabilities.filter((v) => v.id === "CVE-2026-114938");
    expect(entries).toHaveLength(1);
    const [w] = entries;
    expect(w.purls).toEqual([
      "pkg:rpm/redhat/java-21-openjdk-headless@21.0.13.0.9-1.2.el9?epoch=1",
    ]);
    expect(String(w.expired_at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(w.expired_at) <= "2026-12-15").toBe(true);
    expect(w.statement).toContain("OWNER-WAIVER-CRIT-01");
    // The waived package is the one in the pinned Keycloak base.
    expect(read(KC, "Dockerfile")).toContain(
      "keycloak/keycloak:26.8.2-0@sha256:3879c623248408de29a5303178b5816c77e8dfef3890c361f8c0bbeaa979ba3b",
    );
  });
});
