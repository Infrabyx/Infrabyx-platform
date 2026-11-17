# R1 plan: storage compartments in the Terraform modules (PR-LDC-60, wave 15)

Status: drafted 17 Nov 2026 (fifteenth session); **built 17 Nov 2026 (sixteenth session, R1-D-170)**, with the two changes recorded in §8. Decision of record: R1-D-158 (owner-accepted priority; M110). This plan covers only the part R1-D-158 left for wave 15: the OpenTofu modules take compartment buckets and keys as inputs, off by default, under one output contract.

## 1. Scope

- **In:** `infra/terraform/modules/{aws,azure,gcp}/{object_storage,kms,platform}`, `infra/terraform/contract/outputs.schema.json` and `contract.test.mjs`, each cloud's `platform/tests/contract.tftest.hcl`, `infra/terraform/README.md`, the example stack `envs/example/preview` (compartments stay off there), threat model §3.128, product guide §7cd (the mapping to settings), STATUS, DECISIONS.
- **Out:** applying anything (nothing is applied from this repository; creating the buckets and keys in an environment is the owner's production configuration); tenant CMKs per compartment (a tenant supplies them; the adapter already refuses a missing or shared one); any change to `connectors`, `contracts` or the settings (wave 14 shipped them: `int.storage.bucket.<class>.<compartment>`, `compartmentBuckets`, `compartmentKmsKeyIds`).

## 2. Interface

One new input on each cloud's `platform` and `object_storage` modules:

```hcl
variable "storage_compartments" {
  description = "PR-LDC-60 (R1-D-158): compartment locations to create, each with its own bucket and key. Off by default."
  type = list(object({
    class       = string # REGULATED or CONFIDENTIAL
    compartment = string # BOARD_CONFIDENTIAL or SEALED
  }))
  default = []
  # validation: class in [REGULATED, CONFIDENTIAL]; compartment in [BOARD_CONFIDENTIAL, SEALED];
  # no pair twice.
}
```

One new output field, the same on every cloud (`storage.compartments`, a map; empty when off):

```hcl
storage = {
  buckets      = { <CLASS> = "<bucket>" }                      # unchanged
  lock_mode    = "compliance" | "unlocked"                     # unchanged
  compartments = { "<CLASS>.<COMPARTMENT>" = { bucket = "...", key_id = "..." } }
}
```

The key `<CLASS>.<COMPARTMENT>` is the suffix of the setting `int.storage.bucket.<class>.<compartment>`, so the environment stack maps `bucket` to that setting and `key_id` to the adapter's `compartmentKmsKeyIds[<COMPARTMENT>][<CLASS>]`. `outputs.schema.json` gains `"compartments": "map"` under `storage` and a `"compartments"` list (`BOARD_CONFIDENTIAL`, `SEALED`) with the allowed classes; `contract.test.mjs` checks both on every cloud.

## 3. Resources per compartment

Each compartment location copies its class bucket's controls exactly (lock or immutability, retention, DR replication, private, versioned, TLS-only), with **its own key** in place of the platform key. No new algorithm or key type: the same key kind the platform key uses on that cloud (R1-D-158, C-15, C-17).

| Cloud | Bucket                                                                                                                                                                                                                                      | Key                                                                                                                              | Who may use the key                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| AWS   | `<name>-<cls>-<cmp>` with `cls` `reg` or `conf` and `cmp` `board` or `sealed` (at most 41 + 13 = 54 of S3's 63 characters); Object Lock compliance with the class's retention; a DR bucket and replication rule like the class's            | `aws_kms_key` multi-region, rotation on, its own alias `alias/<name>-<cls>-<cmp>`, and an `aws_kms_replica_key` in the DR region | the replication role gets decrypt on the primary and encrypt on the replica of each compartment key, and nothing else new |
| Azure | a storage account `<compact><abbrev><b or s>` (for example `ibxudfprodconfb`), with a precondition that the name is at most 24 characters; GZRS and the account immutability policy like the class's, the same `immutability_locked` switch | an HSM key in the premium vault of each region, rotated yearly, like the platform key                                            | the existing user-assigned CMK identity gets wrap and unwrap on these keys only                                           |
| GCP   | `<name>-<cls>-<cmp>`, dual-region, locked retention like the class's                                                                                                                                                                        | an HSM key in each of the three key rings (primary, DR, multi-region), rotated every 90 days                                     | the storage service agent gets encrypt and decrypt on these keys only                                                     |

The `kms` module returns the compartment keys as a map; `object_storage` takes that map. A key is never shared between two compartment locations or with the platform key, and the `tofu test` proves it.

## 4. Tests (by ID)

- `@IPB-01-AT-14` (each cloud's `contract.tftest.hcl`, mock providers): (a) default: `storage.compartments` is `{}` and the plan creates no compartment bucket or key; (b) all four pairs on: four buckets and four keys, every key distinct from the platform key and from each other, every bucket locked with its class's retention, every bucket in the DR replication; (c) the validation refuses `GENERAL.SEALED`, an unknown compartment and a pair given twice; (d) Azure: the length precondition refuses an over-long account name.
- `pnpm infra:test` (`contract.test.mjs`): every cloud's `outputs.tf` exposes `storage.compartments`; the schema's classes and compartments equal `contracts`' `StorageCompartment` and the classes `compartmentAllowed` permits (read from the built package, so the two cannot drift).
- The `infra` CI job unchanged otherwise: `tofu fmt -check`, `init -backend=false`, `validate` for every module and the example stack, `tofu test`, `tflint --recursive`, `trivy config`.

## 5. Local verification before the push

`scripts/ci/infra-tools.sh` builds OpenTofu 1.13.1 (tag commit `233700b7…`), tflint 0.64.0 and the three rulesets with Go (available in the session container). Run the `infra` job's commands, `pnpm infra:test` and `pnpm check:full`. If a tool cannot be built here, the PR says so and the `infra` job is the check.

## 6. Exit gate

- [x] All three clouds take `storage_compartments`, default `[]`, and return `storage.compartments`.
- [x] The tests of §4 pass locally and in the `infra` job.
- [x] README "What the … modules set" names the compartment buckets and keys per cloud.
- [x] Threat model §3.128 states the modules' controls; product guide §7cd shows the output-to-setting mapping.
- [x] No package changes, so no changeset: the PR takes the `no-changeset` label with the reason "infra modules only".

## 7. Owner decisions needed

None to build: R1-D-158 accepted the compartments and their own keys. Creating them in an environment (and the cost of the extra keys and buckets) is the product owner's production configuration, done in the product's environment stack, never from here.

## 8. As built (R1-D-170)

- **Keys only where the data is:** on Azure each compartment key sits in the primary vault only (a storage account takes one key, and Key Vault replicates the vault to the paired region itself); on GCP only in the multi-region ring (compartments exist in the locked classes, whose dual-region buckets need a key there). AWS keeps the DR replica, which S3 replication needs. An unused key would add cost and nothing else.
- **No Azure name precondition:** the AzureRM provider already refuses an account name over 24 characters when the configuration is validated (class and compartment accounts alike), and through the `platform` module the longest compartment name is 18 characters; the planned precondition would never fire, so the test of §4 (d) is dropped and the README says so.
- **Refusals:** a location without a key is refused by a validation of the key-map input; a location whose key equals the platform key or another location's is refused by a precondition (`terraform_data.compartment_keys`), which each cloud's tests exercise on the `object_storage` module directly. Resource-level assertions (encryption, lock, retention, DR, replication grants, key kind) run on the `object_storage` and `kms` modules, because a `platform` run sees only its child modules' outputs.
