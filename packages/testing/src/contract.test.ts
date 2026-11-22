import { MemoryFlagProvider } from "@infrabyx/config/flags";
import { defineContractSuite } from "./contract.js";
import { MemorySecrets, MemoryStorage, fakeKms } from "./fakes.js";
import { storageIntegrityContractCases } from "./storage-integrity.js";
import { FakeConsentLedger } from "./web.js";

defineContractSuite("SECRETS", () => new MemorySecrets());
defineContractSuite("KMS", () => fakeKms());
// PR-UDF-058: the named keys the built-in cases name, for their tenant only; PR-UDF-068: the key
// of `lender:contract-off` is disabled; PR-UDF-080 (R1-D-269): a tampered object and an outage,
// through `readError`.
const tampered = new Set<string>();
defineContractSuite(
  "STORAGE",
  () =>
    new MemoryStorage(undefined, {
      keyRefs: (t) =>
        t === "tnt_contract"
          ? ["lender:contract", "lender:contract-b", "lender:contract-off"]
          : undefined,
      keyStates: (_t, ref) => (ref === "lender:contract-off" ? "Disabled" : undefined),
      readError: (k) => (tampered.has(k) ? "integrity" : undefined),
    }),
  storageIntegrityContractCases({
    tamper: async (k) => void tampered.add(k),
    outage: () => new MemoryStorage(undefined, { readError: () => "unavailable" }),
  }),
);
defineContractSuite("FEATURE_FLAG", () => new MemoryFlagProvider());
// PR-LDC-14; R1-plan M41; R1-D-72: `latestByPrincipal` on the fake, as on `pg_local`.
defineContractSuite("CONSENT", () => new FakeConsentLedger());
