import { describe, expect, it } from "vitest";
import { checkRouting } from "./routing.js";
import { ConnectorManifest, lintConnectorManifest } from "./connector-manifest.js";

const fail = (doc: unknown, env = "dev", extra = {}) => {
  try {
    checkRouting(doc, { env, ...extra });
  } catch (e) {
    expect(e).toMatchObject({ code: "IPB-PORT-005" });
    return ((e as { meta?: { problems?: string[] } }).meta?.problems ?? []).join("\n");
  }
  throw new Error("expected IPB-PORT-005");
};

const payments = {
  primary: {
    adapter: "razorpay",
    residency: "IN",
    max_data_class: "REGULATED",
    secrets: "secrets/dev/payments/razorpay",
  },
  secondary: {
    adapter: "cashfree",
    residency: "IN",
    max_data_class: "REGULATED",
    secrets: "secrets/dev/payments/cashfree",
    mode: "active_failover",
  },
  failover_rule: { success_rate_below: 0.8, over_minutes: 10 },
};

describe("@IPB-01-20 provider_routing schema", () => {
  it("accepts a valid file and defaults the P-08 minimum sample to 20", () => {
    const { file } = checkRouting({ version: 1, ports: { PAYMENTS: payments } }, { env: "dev" });
    expect(file.ports.PAYMENTS?.failover_rule?.min_attempts).toBe(20);
  });

  it("refuses literal secrets and secrets for another environment", () => {
    const p = { ...payments, primary: { ...payments.primary, secrets: "rzp_test_abc123" } };
    expect(fail({ version: 1, ports: { PAYMENTS: p } })).toMatch(/SECRETS path/);
    expect(fail({ version: 1, ports: { PAYMENTS: payments } }, "staging")).toMatch(/env "dev"/);
  });

  it("refuses a port missing its primary, an unknown port, and a missing required port", () => {
    expect(fail({ version: 1, ports: { STORAGE: {} } })).toMatch(/primary missing/);
    expect(fail({ version: 1, ports: { NOPE: payments } })).toMatch(/not a catalogue port/);
    expect(fail({ version: 1, ports: {} }, "dev", { requiredPorts: ["KMS"] })).toMatch(
      /KMS: required/,
    );
  });
});

describe("@IPB-01-AT-07 failover never crosses residency", () => {
  it("refuses an IN-ZR REGULATED primary with an active GLOBAL secondary", () => {
    const doc = {
      version: 1,
      ports: {
        LLM: {
          model_classes: {
            "reasoning-large": {
              primary: {
                adapter: "anthropic-bedrock",
                residency: "IN-ZR",
                max_data_class: "REGULATED",
              },
              secondary: {
                adapter: "anthropic-direct",
                residency: "GLOBAL",
                max_data_class: "INTERNAL",
                mode: "active_failover",
              },
            },
          },
        },
      },
    };
    expect(fail(doc)).toMatch(/crosses residency for CONFIDENTIAL/);
  });

  it("allows the same pair with mode none", () => {
    const doc = {
      version: 1,
      ports: {
        STORAGE: {
          primary: { adapter: "s3", residency: "IN", max_data_class: "SECRET" },
          secondary: {
            adapter: "minio",
            residency: "GLOBAL",
            max_data_class: "INTERNAL",
            mode: "none",
          },
        },
      },
    };
    expect(() => checkRouting(doc, { env: "dev" })).not.toThrow();
  });

  it("refuses an adapter whose residency cannot carry its own max data class", () => {
    const doc = {
      version: 1,
      ports: { KMS: { primary: { adapter: "x", residency: "GLOBAL", max_data_class: "SECRET" } } },
    };
    expect(fail(doc)).toMatch(/cannot carry SECRET/);
  });
});

describe("@IPB-01-16 tighten-only residency and recipient delivery (IPB-DEV-05)", () => {
  const brevo = { adapter: "brevo", residency: "GLOBAL", max_data_class: "INTERNAL" };
  const ses = { adapter: "ses", residency: "IN", max_data_class: "INTERNAL" };

  it("a GLOBAL messaging adapter needs a DPA reference", () => {
    expect(fail({ version: 1, ports: { EMAIL: { primary: brevo } } })).toMatch(/needs dpa_ref/);
    expect(() =>
      checkRouting(
        { version: 1, ports: { EMAIL: { primary: { ...brevo, dpa_ref: "vad_dpa_brevo" } } } },
        { env: "dev" },
      ),
    ).not.toThrow();
  });

  it("allow_global false refuses GLOBAL messaging adapters", () => {
    const doc = {
      version: 1,
      defaults: { recipient_delivery: { allow_global: false } },
      ports: {
        EMAIL: { primary: ses, secondary: { ...brevo, dpa_ref: "vad_x", mode: "active_failover" } },
      },
    };
    expect(fail(doc)).toMatch(/allow_global is false/);
  });

  it("a product file may tighten residency_policy, never loosen it", () => {
    const tight = {
      version: 1,
      defaults: { residency_policy: { INTERNAL: ["IN", "IN-ZR"] } },
      ports: { EMAIL: { primary: ses } },
    };
    const { policyFor } = checkRouting(tight, { env: "dev" });
    expect(policyFor("EMAIL").INTERNAL).toEqual(["IN", "IN-ZR"]);
    const tightBrevo = { ...tight, ports: { EMAIL: { primary: { ...brevo, dpa_ref: "vad_x" } } } };
    expect(fail(tightBrevo)).toMatch(/cannot carry INTERNAL/);
    const loose = {
      version: 1,
      defaults: { residency_policy: { CONFIDENTIAL: ["IN", "GLOBAL"] } },
      ports: {},
    };
    expect(fail(loose)).toMatch(/may only tighten; GLOBAL/);
  });
});

describe("IPB-DEV-04 gate B: unproven adapters", () => {
  const doc = {
    version: 1,
    ports: { EMAIL: { primary: { adapter: "ses", residency: "IN", max_data_class: "INTERNAL" } } },
  };
  const unproven = new Set(["ses"]);
  it("are allowed in dev and refused in staging and above", () => {
    expect(() => checkRouting(doc, { env: "dev", unprovenAdapters: unproven })).not.toThrow();
    for (const env of ["staging", "pre-prod", "prod", "dr"])
      expect(fail(doc, env, { unprovenAdapters: unproven })).toMatch(/unproven/);
  });
});

describe("@IPB-10-29 connector manifests", () => {
  const base = {
    id: "razorpay",
    name: "Razorpay",
    version: "0.1.0",
    category: "payments",
    vendor: {
      name: "Razorpay",
      privacy_url: "https://razorpay.com/privacy/",
      support_url: "https://razorpay.com/support/",
    },
    auth: { type: "api_key", secrets: ["key_id", "key_secret", "webhook_secret"] },
    scopes_required: ["payments.orders:write"],
    events_consumed: [],
    events_produced: [],
    actions: [],
    settings_schema: {},
    data_class_max: "REGULATED",
    residency: "IN",
    health: { type: "api_ping", interval_seconds: 3600 },
    ports: ["PAYMENTS"],
    tiers: [],
    help_key: "hlp.int.connectors.razorpay",
  };
  it("PAYMENTS connectors must settle only into the tenant's own account (P-18)", () => {
    const m = ConnectorManifest.parse(base);
    expect(lintConnectorManifest(m).join()).toMatch(/tenant_own_account/);
    expect(
      lintConnectorManifest(ConnectorManifest.parse({ ...base, settlement: "tenant_own_account" })),
    ).toEqual([]);
  });
  it("a GLOBAL connector cannot take REGULATED data", () => {
    const m = ConnectorManifest.parse({
      ...base,
      residency: "GLOBAL",
      settlement: "tenant_own_account",
    });
    expect(lintConnectorManifest(m).join()).toMatch(/GLOBAL connector/);
  });
});
