# infra/helm

`infrabyx-app`, the shared chart for every Infrabyx deployable (IPB-01-32, §01.4.8.2; PL6 plan §5). Products deploy it with their own `values.<env>.yaml` and never write raw manifests.

## Values

| Key                                                               | Meaning                                                                                                                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image.repository`, `image.digest`                                | Required. The promoted image by digest (`sha256:…`); a tag is refused                                                                                 |
| `app.kind`                                                        | Required. `api`, `worker`, `web`, `public` or `console`; a worker gets no Service, the Next.js kinds get a writable `.next/cache`                     |
| `env.name`                                                        | Required. One of the IPB-09-15 environments                                                                                                           |
| `env.vars`                                                        | Plain configuration only                                                                                                                              |
| `routing.configMap`                                               | Required. The ConfigMap with this environment's `routing.yaml`, mounted read-only at `/etc/infrabyx/routing`                                          |
| `secrets.provider`, `secrets.parameters`                          | The Secrets Store CSI provider and its `SecretProviderClass` parameters, mounted read-only at `/mnt/secrets`; required in staging, pre-prod, prod, dr |
| `serviceAccount.annotations`                                      | Workload identity (IRSA, Azure, GCP)                                                                                                                  |
| `replicas`, `autoscaling`, `autoscaling.keda`, `pdb.minAvailable` | Replicas (at least 2 in prod and dr), the CPU autoscaler, KEDA for workers, the disruption budget                                                     |
| `networkPolicy.ingressFrom`, `networkPolicy.egressTo`             | Peers allowed in and out; everything else is denied (DNS is always allowed). Default-deny cannot be turned off                                        |
| `probes`                                                          | `/health/live`, `/health/ready`, `/health/startup`                                                                                                    |
| `migrations.job`                                                  | A pre-install and pre-upgrade hook running `infrabyx-migrate --db-file /mnt/secrets/db_migrate_url` as `app_migrate`                                  |
| `otel.endpoint`, `otel.samplingRatio`                             | The OTLP collector                                                                                                                                    |
| `seed.profile`                                                    | Only where seeds may run; refused in prod, dr and pre-prod                                                                                            |

The security context is not configurable: UID and GID 10001, `runAsNonRoot`, `readOnlyRootFilesystem`, no privilege escalation, every capability dropped, `RuntimeDefault` seccomp, and no service-account token mounted.

## Refusals at render time

| Code          | When                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `IPB-ENV-001` | `seed.profile` set with `env.name` prod, dr or pre-prod (`SEED_REFUSED_ENVS`, PL1-D-06; `@IPB-01-AT-12`)                                    |
| `IPB-ENV-002` | An `env.vars` value pointing at `*.supabase.co` in staging, demo, pre-prod, prod or dr (IPB-01 §01.4.11)                                    |
| `IPB-ENV-003` | An `env.vars` name ending in `PASSWORD`, `SECRET`, `TOKEN`, `PRIVATE_KEY`, `API_KEY` or `_KEY` in those environments (IPB-02-28)            |
| schema        | A tag instead of a digest, an unknown kind or environment, no secrets provider from staging up, one replica in prod or dr, default-deny off |

## Tests (`infra` CI job)

```sh
scripts/ci/infra-tools.sh                 # Helm, kubeconform and the Kyverno CLI from pinned versions
pnpm infra:test                           # helm lint and the render tests (tests/render.test.mjs)
infra/helm/infrabyx-app/tests/kubeconform.sh
kyverno test infra/policy/kyverno/tests   # the admission policies
```

The examples in `infrabyx-app/ci/` (public in dev, api in prod, worker in staging, console in preview) are rendered by every test. `kubeconform` reads Kubernetes 1.33 and CRD schemas pinned to commits. `helm diff` needs a cluster and is not run (PL6-D-01).

| Tool        | Version | Source                                                                            |
| ----------- | ------- | --------------------------------------------------------------------------------- |
| Helm        | 4.3.1   | `go install helm.sh/helm/v4/cmd/helm@v4.3.1` (Go checksum database)               |
| kubeconform | 0.8.0   | `go install github.com/yannh/kubeconform/cmd/kubeconform@v0.8.0`                  |
| Kyverno CLI | 1.19.1  | built from the `v1.19.1` tag at commit `40ec788d48bb28d83dbf85538e962a59db9d45c6` |
