# infra/policy

Policy-as-code for the platform (IPB-01 §01.4.2). Checks that products also run ship in packages so they can be installed; this folder keeps repository-only policy.

| Location                                      | Check                                                                                                                                                                                                  | IPB                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `@infrabyx/testing/eslint`                    | `ipb/vendor-import`, `ipb/schema-boundary`, `ipb/no-process-env`, `ipb/no-direct-crypto`                                                                                                               | IPB-01-14, IPB-01-09/11, IPB-01-19, 12-05 |
| `@infrabyx/testing` `infrabyx-migration-lint` | every rule of IPB-09 §09.4.6.2 and forbidden operation of §09.4.6.3                                                                                                                                    | IPB-09-31, IPB-01-22/23                   |
| `@infrabyx/tenancy` `infrabyx-rls-lint`       | RLS enabled, forced and tenant-scoped; security-invoker views; no BYPASSRLS                                                                                                                            | IPB-02-12, IPB-09 §09.4.2                 |
| `hooks/precommit-guard.mjs` (lefthook)        | no `.env*` (except `.env.example`) or `SEED_CREDENTIALS.md` in commits                                                                                                                                 | IPB-11-09                                 |
| `github/rulesets.json`                        | GitHub ruleset export                                                                                                                                                                                  | IPB-09 §09.4.1.4                          |
| `kyverno/` (`infra` CI job)                   | admission: locked security context, images by digest, probes, no host access; signed and attested images (Enforce from staging up, Audit in namespaces labelled local, dev, test or preview; PL6-D-16) | IPB-01-31, IPB-01-35, IPB-02-35           |

Rule tests run with `pnpm test:policy`.
