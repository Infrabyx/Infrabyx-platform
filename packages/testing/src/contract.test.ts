import { MemoryFlagProvider } from "@infrabyx/config/flags";
import { defineContractSuite } from "./contract.js";
import { MemorySecrets, MemoryStorage, fakeKms } from "./fakes.js";
import { FakeConsentLedger } from "./web.js";

defineContractSuite("SECRETS", () => new MemorySecrets());
defineContractSuite("KMS", () => fakeKms());
// PR-UDF-058: the two named keys the built-in case names, for its tenant only.
defineContractSuite(
  "STORAGE",
  () =>
    new MemoryStorage(undefined, {
      keyRefs: (t) => (t === "tnt_contract" ? ["lender:contract", "lender:contract-b"] : undefined),
    }),
);
defineContractSuite("FEATURE_FLAG", () => new MemoryFlagProvider());
// PR-LDC-14; R1-plan M41; R1-D-72: `latestByPrincipal` on the fake, as on `pg_local`.
defineContractSuite("CONSENT", () => new FakeConsentLedger());
