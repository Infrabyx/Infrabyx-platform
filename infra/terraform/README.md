# infra/terraform

OpenTofu modules per cloud with one output contract (IPB-01-34, §01.4.9; PL6 plan §7). Products compose a cloud's `platform` module in `infra/terraform/envs/<product>/<env>/` and read only its outputs. Nothing here is applied from this repository.

| Path                           | What it is                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract/outputs.schema.json` | The output contract of §01.4.9.3 and the bucket classes; `contract.test.mjs` checks every cloud against it                                                                           |
| `modules/aws/<module>`         | `network`, `kubernetes`, `postgres`, `redis`, `object_storage`, `kms`, `secrets`, `dns_cdn_edge`, `observability_backend`, `registry`, `iam_workload_identity`, `bastion_breakglass` |
| `modules/aws/platform`         | The composition: region check (IPB-01-36), every module, the contract outputs; `tests/contract.tftest.hcl`                                                                           |
| `modules/azure`, `modules/gcp` | The same modules and contract (PL6 session 3b)                                                                                                                                       |
| `envs/example/preview`         | An example environment stack: providers, the platform module, the contract as one output                                                                                             |

## What the AWS modules set

- **Regions:** ap-south-1 with DR in ap-south-2; anything else needs `region_adr` (an ADR with the IPB-02 residency review).
- **Keys:** one multi-region platform CMK, rotated, with a DR replica; every bucket, database, cache, log group, secret, node volume and registry is encrypted with it.
- **Buckets:** one per class; `AUDIT`, `REGULATED` and `CONFIDENTIAL` with Object Lock in compliance mode (8 years, the product's statutory period, 1 year) and replicated with their lock to the DR region; every bucket private, versioned, TLS-only, SSE-KMS.
- **PostgreSQL 18:** private, Multi-AZ from staging up, TLS forced, IAM authentication, RDS-managed admin password, deletion protection, 35-day backups.
- **Redis 7:** TLS required, encryption at rest, IAM-authenticated users only, the default user off.
- **EKS:** private endpoint unless `admin_cidrs` is set, secrets envelope-encrypted, control-plane logs, IMDSv2-only nodes with encrypted volumes, IRSA roles per service account.
- **Secrets:** placeholders at `secrets/<env>/…` (database, Redis, kubeconfig) whose values the bootstrap writes; never a value in state.
- **Break-glass:** off by default; an MFA-only role for SSM sessions when enabled.

## Tests (`infra` CI job)

`tofu fmt -check`, `tofu init -backend=false` and `tofu validate` for every module and the example stack; `tofu test` in each `platform` (mock providers: no credentials, no resources; `@IPB-01-AT-14`); `trivy config`; and `pnpm infra:test` for the contract file check.

| Tool     | Version | Source                                                                                                          |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------- |
| OpenTofu | 1.13.1  | built from the `v1.13.1` tag at commit `233700b795b6d2372f1c56ed57a4abaec9d36475` (`scripts/ci/infra-tools.sh`) |
| AWS      | 6.69.1  | `hashicorp/aws` from the OpenTofu registry, exact pin in every `versions.tf`                                    |
| AzureRM  | 5.10.0  | `hashicorp/azurerm` (session 3b)                                                                                |
| Google   | 8.7.0   | `hashicorp/google` (session 3b)                                                                                 |

Each was published at least 7 days before it was pinned (PL2-D-32). Lock files are written by `tofu init` and not committed until a session with registry access can generate and review them (PL6-D-05).
