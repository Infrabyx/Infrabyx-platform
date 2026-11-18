# @infrabyx/fakes

The platform's in-memory port fakes and their fixtures, with no test runner. A product wires these in a fixture environment at runtime (below staging: every real adapter fails closed above it) without carrying `vitest`, Testcontainers or the port contract harness in its production dependencies (Finbyx PR-FBX-48; R1-D-181).

**Specified by:** `docs/ipb/` — IPB-01-15 (every port has a fake and a contract suite), IPB-01 §01.4.2, IPB-09 (supply chain: `pnpm audit --prod --audit-level high`). The package sits beside `testing` in the IPB-14 §14.2 layout (platform request PR-045; ADR-0011).

## Use

```ts
import { MemoryStorage, FakeKyc, FakeAccountingSink } from "@infrabyx/fakes";
```

- Put `@infrabyx/fakes` in `dependencies` when a fixture environment wires fakes at runtime, and keep `@infrabyx/testing` in `devDependencies` only.
- `@infrabyx/testing` re-exports every name here unchanged, so test files keep importing from `@infrabyx/testing`. A fake and the contract cases that exercise it are the same object whichever package you import it from.
- Nothing here is an adapter: a fake is never registered for `staging`, `pre-prod`, `prod` or `dr`.

## What is here

| Module  | Fakes and fixtures                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| core    | `MemorySecrets`, `fakeKms()`, `MemoryStorage`, `MemoryIdentity`, `MemoryPushTokenStore`, `MemoryEsignEnvelopeStore`, `MemoryFlagProvider` |
| ai      | `FakeLlm`, `FakeEmbedding`, `FakeImageGen`, `FakeSpeech`, `FakeRerank`                                                                    |
| web     | consent, CRM, HR, desk, trust feed, catalogue, tag manager, analytics, media, egress, claims gate, law register fakes                     |
| ports/* | one module per port: `FakeKyc`, `FakeAccountingSink`, `FakeCreditBureau`, `FakeAccountAggregator`, `FakeDisbursementRail`, …              |

The contract cases (`kycContractCases`, `accountingContractCases`, …) stay in `@infrabyx/testing`, which runs them against these fakes.

## Dependencies

`@infrabyx/contracts`, `@infrabyx/crypto` and `@infrabyx/config` only. A test in this package fails if any module imports `vitest`, `testcontainers`, `pg` or `@infrabyx/testing`.
