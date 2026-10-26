import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import ipb from "./index.mjs";

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: "module" },
});

const repo = "/repo";

describe("ipb/vendor-import (IPB-01-14)", () => {
  it("allows vendor SDKs only inside packages/connectors", () => {
    tester.run("vendor-import", ipb.rules["vendor-import"], {
      valid: [
        {
          code: `import { S3 } from "@aws-sdk/client-s3";`,
          filename: `${repo}/packages/connectors/storage/s3/index.ts`,
        },
        { code: `import { z } from "zod";`, filename: `${repo}/packages/cms/src/index.ts` },
        {
          code: `import { StoragePort } from "@infrabyx/contracts";`,
          filename: `${repo}/apps/api/src/modules/cases/service.ts`,
        },
      ],
      invalid: [
        {
          code: `import { S3 } from "@aws-sdk/client-s3";`,
          filename: `${repo}/packages/cms/src/index.ts`,
          errors: [{ messageId: "vendor" }],
        },
        {
          code: `import Anthropic from "@anthropic-ai/sdk";`,
          filename: `${repo}/packages/ai/src/gateway.ts`,
          errors: [{ messageId: "vendor" }],
        },
        {
          code: `const r = require("razorpay");`,
          filename: `${repo}/apps/api/src/modules/billing/pay.ts`,
          errors: [{ messageId: "vendor" }],
        },
        {
          code: `const m = await import("openai");`,
          filename: `${repo}/packages/vidhi/src/x.ts`,
          errors: [{ messageId: "vendor" }],
        },
      ],
    });
  });
});

describe("ipb/schema-boundary (IPB-01-09)", () => {
  it("fails on cross-module schema imports", () => {
    tester.run("schema-boundary", ipb.rules["schema-boundary"], {
      valid: [
        {
          code: `import { cases } from "./schema";`,
          filename: `${repo}/apps/api/src/modules/cases/repo.ts`,
        },
        {
          code: `import { cases } from "../schema.js";`,
          filename: `${repo}/apps/api/src/modules/cases/sub/repo.ts`,
        },
        {
          code: `import { LoanService } from "../loans/loan.service";`,
          filename: `${repo}/apps/api/src/modules/cases/repo.ts`,
        },
        {
          code: `import { tenants } from "./schema/tenant";`,
          filename: `${repo}/packages/tenancy/src/index.ts`,
        },
        {
          code: `import { TenantContext } from "@infrabyx/tenancy";`,
          filename: `${repo}/packages/audit/src/index.ts`,
        },
      ],
      invalid: [
        {
          code: `import { loans } from "../loans/schema";`,
          filename: `${repo}/apps/api/src/modules/cases/repo.ts`,
          errors: [{ messageId: "cross" }],
        },
        {
          code: `import { loans } from "../loans/drizzle/loans.schema.js";`,
          filename: `${repo}/apps/api/src/modules/cases/repo.ts`,
          errors: [{ messageId: "cross" }],
        },
        {
          code: `import { tenants } from "@infrabyx/tenancy/schema";`,
          filename: `${repo}/packages/audit/src/index.ts`,
          errors: [{ messageId: "cross" }],
        },
        {
          code: `import { pages } from "../../cms/src/schema";`,
          filename: `${repo}/packages/brand/src/index.ts`,
          errors: [{ messageId: "cross" }],
        },
      ],
    });
  });
});

describe("ipb/no-process-env (IPB-01-19)", () => {
  it("allows process.env only inside packages/config", () => {
    tester.run("no-process-env", ipb.rules["no-process-env"], {
      valid: [
        {
          code: `const v = process.env.APP_ENV;`,
          filename: `${repo}/packages/config/src/loader.ts`,
        },
        {
          code: `const v = settings.get("app.env");`,
          filename: `${repo}/packages/cms/src/index.ts`,
        },
      ],
      invalid: [
        {
          code: `const v = process.env.APP_ENV;`,
          filename: `${repo}/packages/cms/src/index.ts`,
          errors: [{ messageId: "env" }],
        },
        {
          code: `const v = process["env"].APP_ENV;`,
          filename: `${repo}/packages/connectors/email/ses/index.ts`,
          errors: [{ messageId: "env" }],
        },
      ],
    });
  });
});

describe("ipb/no-direct-crypto (IPB-12-05, @IPB-12-AT-03)", () => {
  it("allows cryptography only inside packages/crypto", () => {
    tester.run("no-direct-crypto", ipb.rules["no-direct-crypto"], {
      valid: [
        {
          code: `import { createHash } from "node:crypto";`,
          filename: `${repo}/packages/crypto/src/hash.ts`,
        },
        {
          code: `import { sha256Hex } from "@infrabyx/crypto";`,
          filename: `${repo}/packages/audit/src/ledger.ts`,
        },
        {
          code: `const crypto = makeCrypto(); crypto.thing();`,
          filename: `${repo}/packages/cms/src/x.ts`,
        },
      ],
      invalid: [
        {
          code: `import { createSign } from "node:crypto";`,
          filename: `${repo}/apps/api/src/modules/cases/sign.ts`,
          errors: [{ messageId: "module" }],
        },
        {
          code: `const c = require("crypto");`,
          filename: `${repo}/packages/audit/src/x.ts`,
          errors: [{ messageId: "module" }],
        },
        {
          code: `crypto.randomUUID();`,
          filename: `${repo}/packages/seed/src/x.ts`,
          errors: [{ messageId: "global" }],
        },
        {
          code: `globalThis.crypto.subtle.digest("SHA-256", b);`,
          filename: `${repo}/packages/ui/src/x.ts`,
          errors: [{ messageId: "global" }],
        },
      ],
    });
  });
});
