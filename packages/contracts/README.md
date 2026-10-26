# @infrabyx/contracts

The shared vocabulary of the Infrabyx platform: data classes and residency, identifier formats, the environment catalogue, the role floor, settings tiers and risk classes, the error catalogue with RFC 9457 problems, the internal and Ecosystem event envelopes, the module manifest, the kernel interfaces and the port contracts.

**Specified by:** `docs/ipb/` — IPB-01 (ports, manifest, errors), IPB-02 (data classes, roles, risk classes, error codes), IPB-07 (tiers), IPB-10 (envelopes, problems), IPB-11 (environments, error codes); Ecosystem Spec v1.2 §3.2 (cross-product envelope). Plan: `docs/phases/PL1-plan.md` §4.

**Rule:** zero runtime dependencies beyond Zod (IPB-01 §01.4.2).

| Import                           | Contents                                                                    |
| -------------------------------- | --------------------------------------------------------------------------- |
| `@infrabyx/contracts/data-class` | `DataClass`, Spec §13.2 → tier map, `Residency`, `residencyAllows()`        |
| `@infrabyx/contracts/ids`        | `idSchema(prefix)`, reserved tenant IDs                                     |
| `@infrabyx/contracts/env`        | `AppEnv`, guard groups (prod, staging, seed-refused)                        |
| `@infrabyx/contracts/roles`      | Role floor (PL1-D-05), `AGENT_FORBIDDEN_VERBS`, MFA floor                   |
| `@infrabyx/contracts/tiers`      | Settings tiers and precedence; risk classes R0–R5                           |
| `@infrabyx/contracts/errors`     | Error catalogue, `IpbError`, `PortError`, `toProblem()`                     |
| `@infrabyx/contracts/events`     | `InternalEnvelope`, `EcosystemEnvelope`, `parseEnvelope()`, PL1 event names |
| `@infrabyx/contracts/modules`    | `defineModule()` manifest schema                                            |
| `@infrabyx/contracts/kernel`     | `MutationKernel`, `Tx`, `AuditSink`, `ApprovalGateway` interfaces           |
| `@infrabyx/contracts/ports`      | Port conventions, catalogue, SECRETS, KMS, STORAGE, FEATURE_FLAG, IDENTITY  |

Cross-product events must use `EcosystemEnvelope`; `InternalEnvelope` rejects `in.infrabyx.*` types (decision D-13).
