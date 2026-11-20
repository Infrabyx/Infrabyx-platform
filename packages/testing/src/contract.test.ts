import { MemoryFlagProvider } from "@infrabyx/config/flags";
import { defineContractSuite } from "./contract.js";
import { MemorySecrets, MemoryStorage, fakeKms } from "./fakes.js";
import { FakeConsentLedger } from "./web.js";

defineContractSuite("SECRETS", () => new MemorySecrets());
defineContractSuite("KMS", () => fakeKms());
// PR-UDF-058: the named keys the built-in cases name, for their tenant only; PR-UDF-068: the key
// of `lender:contract-off` is disabled.
defineContractSuite(
  "STORAGE",
  () =>
    new MemoryStorage(undefined, {
      keyRefs: (t) =>
        t === "tnt_contract"
          ? ["lender:contract", "lender:contract-b", "lender:contract-off"]
          : undefined,
      keyStates: (_t, ref) => (ref === "lender:contract-off" ? "Disabled" : undefined),
    }),
);
defineContractSuite("FEATURE_FLAG", () => new MemoryFlagProvider());
// PR-LDC-14; R1-plan M41; R1-D-72: `latestByPrincipal` on the fake, as on `pg_local`.
defineContractSuite("CONSENT", () => new FakeConsentLedger());
