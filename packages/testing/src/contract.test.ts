import { MemoryFlagProvider } from "@infrabyx/config/flags";
import { defineContractSuite } from "./contract.js";
import { MemorySecrets, MemoryStorage, fakeKms } from "./fakes.js";
import { FakeConsentLedger } from "./web.js";

defineContractSuite("SECRETS", () => new MemorySecrets());
defineContractSuite("KMS", () => fakeKms());
defineContractSuite("STORAGE", () => new MemoryStorage());
defineContractSuite("FEATURE_FLAG", () => new MemoryFlagProvider());
// PR-LDC-14; R1-plan M41; R1-D-72: `latestByPrincipal` on the fake, as on `pg_local`.
defineContractSuite("CONSENT", () => new FakeConsentLedger());
