// @IPB-10-29 connector manifests: every packages/connectors/marketplace/*.manifest.json parses and
// passes the P-18 settlement and IPB-10-31 residency rules.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConnectorManifest, lintConnectorManifest } from "@infrabyx/contracts/connector-manifest";

const dir = new URL("../../marketplace/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".manifest.json"));

describe("@IPB-10-29 connector marketplace manifests", () => {
  it("there is a manifest for each PAYMENTS adapter (P-18)", () => {
    expect(files.sort()).toEqual(["cashfree.manifest.json", "razorpay.manifest.json"]);
  });
  it.each(files)("%s parses and lints clean", (f) => {
    const m = ConnectorManifest.parse(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    expect(lintConnectorManifest(m)).toEqual([]);
    expect(`${m.id}.manifest.json`).toBe(f);
    expect(m).toMatchObject({
      data_class_max: "REGULATED",
      residency: "IN",
      settlement: "tenant_own_account",
    });
  });
});
