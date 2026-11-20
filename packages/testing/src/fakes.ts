// Fakes for the ports PL1 consumes (PL1 plan §10): SECRETS, KMS, STORAGE, FEATURE_FLAG, IDENTITY.
export {
  fakeKms,
  MemorySecrets,
  MemoryStorage,
  MemoryIdentity,
  MemoryPushTokenStore,
  MemoryEsignEnvelopeStore,
  type MemoryStorageKeyRefs,
} from "@infrabyx/fakes";

export { MemoryFlagProvider, MemorySnapshotStore } from "@infrabyx/config/flags";
