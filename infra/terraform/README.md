# infra/terraform

OpenTofu modules per cloud with one output contract (IPB-01-34, §01.4.9; PL6 plan §7). Products compose a cloud's `platform` module in `infra/terraform/envs/<product>/<env>/` and read only its outputs. Nothing here is applied from this repository.

| Path                           | What it is                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract/outputs.schema.json` | The output contract of §01.4.9.3 and the bucket classes; `contract.test.mjs` checks every cloud against it                                                                                                  |
| `modules/<cloud>/<module>`     | `aws`, `azure`, `gcp`: `network`, `kubernetes`, `postgres`, `redis`, `object_storage`, `kms`, `secrets`, `dns_cdn_edge`, `observability_backend`, `registry`, `iam_workload_identity`, `bastion_breakglass` |
| `modules/<cloud>/platform`     | The composition: region check (IPB-01-36), every module, the contract outputs; `tests/contract.tftest.hcl`                                                                                                  |
| `envs/example/preview`         | An example environment stack: providers, the platform module, the contract as one output                                                                                                                    |

## What the AWS modules set

- **Regions:** ap-south-1 with DR in ap-south-2; anything else needs `region_adr` (an ADR with the IPB-02 residency review).
- **Keys:** one multi-region platform CMK, rotated, with a DR replica; every bucket, database, cache, log group, secret, node volume and registry is encrypted with it.
- **Buckets:** one per class; `AUDIT`, `REGULATED` and `CONFIDENTIAL` with Object Lock in compliance mode (8 years, the product's statutory period, 1 year) and replicated with their lock to the DR region; every bucket private, versioned, TLS-only, SSE-KMS.
- **PostgreSQL 18:** private, Multi-AZ from staging up, TLS forced, IAM authentication, RDS-managed admin password, deletion protection, 35-day backups.
- **Redis 7:** TLS required, encryption at rest, IAM-authenticated users only, the default user off.
- **EKS:** private endpoint unless `admin_cidrs` is set, secrets envelope-encrypted, control-plane logs, IMDSv2-only nodes with encrypted volumes, IRSA roles per service account.
- **Secrets:** placeholders at `secrets/<env>/…` (database, Redis, kubeconfig) whose values the bootstrap writes; never a value in state.
- **Break-glass:** off by default; an MFA-only role for SSM sessions when enabled.

## What the Azure modules set

- **Regions:** centralindia with DR in southindia (its paired region); anything else needs `region_adr`. Everything sits in one resource group per environment.
- **Keys:** an HSM-backed platform key in a premium vault in each region, rotated yearly, purge protection on, the vault firewall closed except the node subnet and `admin_cidrs`; one user-assigned identity uses it for storage, PostgreSQL and the registry.
- **Storage:** one account per class, with the container `objects`; `AUDIT`, `REGULATED` and `CONFIDENTIAL` geo-zone-redundant (copies in southindia) with an account immutability policy. Azure creates the policy unlocked: set `immutability_locked = true` in the apply after the accounts exist, and `storage.lock_mode` turns from `unlocked` to `compliance`. Every account is private, versioned, HTTPS and TLS 1.2 only, Entra ID only (no shared keys), CMK-encrypted.
- **PostgreSQL 18:** Flexible Server in a delegated subnet, no public access, Entra ID authentication only (the bootstrap runs as the `pg-admin` managed identity), TLS 1.2 or later, zone-redundant HA from staging up, geo-redundant backups under the DR key, a delete lock.
- **Redis:** Azure Cache Premium across three zones behind a private endpoint, TLS 1.2, Entra ID authentication with access keys off. Redis 6 is the newest version Azure Cache offers (PL6-D-06).
- **AKS:** private API server unless `admin_cidrs` is set, local accounts off, Azure RBAC, workload identity, the Key Vault CSI driver, Cilium network policy, encryption at host, control-plane logs. etcd uses Azure's platform-managed encryption (PL6-D-06).
- **Secrets:** a separate vault; OpenTofu creates no secret (Key Vault needs a value). The bootstrap writes `secrets-<env>-db-app-rw`, `-redis-url` and `-k8s-kubeconfig`; each workload identity reads this vault only.
- **Registry:** ACR Premium, no admin user or anonymous pull, a geo-replica in southindia, CMK, untagged manifests purged after 30 days; the kubelet identity pulls.
- **Break-glass:** off by default; named Entra groups get AKS cluster admin while enabled (time-bound elevation is Entra PIM).

## What the GCP modules set

- **Regions:** asia-south1 with DR in asia-south2; anything else needs `region_adr`, and `multi_region` (default `asia`) follows the regions. The project is the provider's.
- **Keys:** an HSM platform key in key rings in the primary region, the DR region and the multi-region, rotated every 90 days; the Google service agents get encrypt and decrypt on them only.
- **Buckets:** one per class; `AUDIT`, `REGULATED` and `CONFIDENTIAL` dual-region (asia-south1 and asia-south2) with a locked retention policy; every bucket with uniform access, public access prevention, versioning and CMEK.
- **PostgreSQL 18:** Cloud SQL on a private IP only, TLS required, IAM database authentication, CMEK, regional HA from staging up, point-in-time recovery with backups in asia-south2, deletion protection, connection, lock and checkpoint logs.
- **Redis 7.2:** Memorystore Standard with a replica in a second zone, private service access, TLS, AUTH, CMEK. Google generates the AUTH string, so it is in state (PL6-D-06).
- **GKE:** regional, private nodes and endpoint unless `admin_cidrs` is set, master authorized networks, Workload Identity, secrets encrypted with the platform key, network policy, Binary Authorization, shielded COS nodes with the GKE metadata server, a dedicated node service account, control-plane logs.
- **Secrets:** Secret Manager entries `secrets-<env>-db-app-rw`, `-redis-url` and `-k8s-kubeconfig` without a version, replicated to both regions under the platform key; each workload service account reads `secrets-<env>-*` only.
- **Registry:** Artifact Registry (Docker) with immutable tags, CMEK, untagged versions cleaned up after 30 days.
- **Break-glass:** off by default; Kubernetes Engine admin for named members under an IAM condition that expires at `expires_at`.

## Tests (`infra` CI job)

`tofu fmt -check`, `tofu init -backend=false` and `tofu validate` for every module and the example stack; `tofu test` in each `platform` (mock providers: no credentials, no resources; `@IPB-01-AT-14`); `tflint --recursive` with `.tflint.hcl` (the Terraform recommended preset and the three cloud rulesets); `trivy config`; and `pnpm infra:test` for the contract file check.

| Tool     | Version                                   | Source                                                                                                          |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| OpenTofu | 1.13.1                                    | built from the `v1.13.1` tag at commit `233700b795b6d2372f1c56ed57a4abaec9d36475` (`scripts/ci/infra-tools.sh`) |
| AWS      | 6.69.1                                    | `hashicorp/aws` from the OpenTofu registry, exact pin in every `versions.tf`                                    |
| AzureRM  | 5.10.0                                    | `hashicorp/azurerm`, as above                                                                                   |
| Google   | 8.7.0                                     | `hashicorp/google`, as above                                                                                    |
| tflint   | 0.64.0                                    | `go install github.com/terraform-linters/tflint@v0.64.0`                                                        |
| Rulesets | AWS 0.49.0, AzureRM 0.32.0, Google 0.40.0 | `go install github.com/terraform-linters/tflint-ruleset-<name>@<version>` into `TFLINT_PLUGIN_DIR`              |

Each was published at least 7 days before it was pinned (PL2-D-32). Lock files are written by `tofu init` and not committed until a session with registry access can generate and review them (PL6-D-05).
