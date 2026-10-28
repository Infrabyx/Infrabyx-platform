// @IPB-01-AT-01: the five Node.js pin locations agree, and every Dockerfile FROM line is digest-pinned.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dockerfilePinProblems, dockerfiles, fromLineProblems } from "./dockerfile-pins.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PIN = "24.22.1";
const DIGEST = `sha256:${"a".repeat(64)}`;

describe("@IPB-01-AT-01 Node version pin consistency", () => {
  it("every location resolves to the pin at HEAD", () => {
    const pkg = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8"));
    expect(readFileSync(`${ROOT}/.nvmrc`, "utf8").trim()).toBe(PIN);
    expect(pkg.engines.node).toBe(PIN);
    expect(readFileSync(`${ROOT}/.github/workflows/ci.yml`, "utf8")).toContain(`node: ["${PIN}"]`);
    const renovate = JSON.parse(readFileSync(`${ROOT}/renovate.json`, "utf8"));
    expect(
      renovate.packageRules.some(
        (r) => (r.matchPackageNames ?? []).includes("node") && /24/.test(r.allowedVersions ?? ""),
      ),
    ).toBe(true);
    expect(dockerfiles(ROOT, ["apps", "infra"]).length).toBeGreaterThanOrEqual(3);
    expect(dockerfilePinProblems(ROOT, ["apps", "infra"], PIN)).toEqual([]);
  });

  it("the ipb-check job passes at HEAD", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/ipb-check.mjs"], { cwd: ROOT, stdio: "pipe" }),
    ).not.toThrow();
  });

  it("refuses a FROM line without a digest, and a Node image of another version", () => {
    expect(fromLineProblems(`FROM node:${PIN}-bookworm-slim\n`, PIN)).toHaveLength(1);
    expect(fromLineProblems(`FROM golang:1.24.13-bookworm\n`, PIN)).toEqual([
      "FROM golang:1.24.13-bookworm must name a sha256 digest",
    ]);
    expect(fromLineProblems(`FROM node:22.23.4-bookworm-slim@${DIGEST}\n`, PIN)).toEqual([
      `FROM node:22.23.4-bookworm-slim@${DIGEST} must be node:${PIN}-bookworm-slim@sha256:<digest>`,
    ]);
  });

  it("accepts digest-pinned images and later stages of the same file", () => {
    const text = [
      `FROM --platform=linux/amd64 golang:1.24.13-bookworm@${DIGEST} AS build`,
      `FROM node:${PIN}-bookworm-slim@${DIGEST} AS base`,
      "FROM base AS deps",
      "FROM deps",
    ].join("\n");
    expect(fromLineProblems(text, PIN)).toEqual([]);
  });
});
