import { MemoryFlagProvider } from "@infrabyx/config/flags";
import { defineContractSuite } from "./contract.js";
import { MemorySecrets, MemoryStorage, fakeKms } from "./fakes.js";

defineContractSuite("SECRETS", () => new MemorySecrets());
defineContractSuite("KMS", () => fakeKms());
defineContractSuite("STORAGE", () => new MemoryStorage());
defineContractSuite("FEATURE_FLAG", () => new MemoryFlagProvider());
