// Render tests of the shared chart (IPB-01-32, §01.4.8.2; PL6 plan §5.4). They run `helm template`
// on the CI values files and on deliberately wrong values, and check what every rendered object
// carries and what the chart refuses. Needs `helm` (Helm 4) on PATH or IPB_HELM; the `infra` CI job
// always provides it, and elsewhere the suite is skipped.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

const CHART = join(import.meta.dirname, "..");
const HELM = process.env.IPB_HELM ?? "helm";
const haveHelm = spawnSync(HELM, ["version", "--short"]).status === 0;

/** Render with a values file and `--set` overrides; returns the objects or the error text. */
function render(file, set = []) {
  const args = ["template", "r", CHART, "-f", join(CHART, "ci", file)];
  for (const s of set) args.push("--set", s);
  const r = spawnSync(HELM, args, { encoding: "utf8" });
  if (r.status !== 0) return { error: r.stderr };
  const docs = parseAllDocuments(r.stdout)
    .map((d) => d.toJSON())
    .filter(Boolean);
  return { docs };
}

const kinds = (docs) => docs.map((d) => d.kind).sort();
const podSpecs = (docs) =>
  docs.filter((d) => d.kind === "Deployment" || d.kind === "Job").map((d) => d.spec.template.spec);
const ciFiles = readdirSync(join(CHART, "ci")).filter((f) => f.endsWith(".yaml"));

describe.skipIf(!haveHelm)("infrabyx-app chart", () => {
  it("lints in strict mode with every CI values file", () => {
    for (const f of ciFiles)
      execFileSync(HELM, ["lint", CHART, "--strict", "-f", join(CHART, "ci", f)], {
        stdio: "pipe",
      });
  });

  it.each(ciFiles)(
    "%s: locked security context, digest image, probes and read-only mounts",
    (f) => {
      const { docs, error } = render(f);
      expect(error).toBeUndefined();
      for (const pod of podSpecs(docs)) {
        expect(pod.automountServiceAccountToken).toBe(false);
        expect(pod.securityContext).toMatchObject({
          runAsNonRoot: true,
          runAsUser: 10001,
          seccompProfile: { type: "RuntimeDefault" },
        });
        for (const c of pod.containers) {
          expect(c.image).toMatch(/@sha256:[a-f0-9]{64}$/);
          expect(c.securityContext).toEqual({
            runAsNonRoot: true,
            runAsUser: 10001,
            runAsGroup: 10001,
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            privileged: false,
            capabilities: { drop: ["ALL"] },
          });
          expect(c.env.find((e) => e.name === "NODE_ENV")?.value).toBe("production");
          for (const m of c.volumeMounts.filter((v) => v.name !== "tmp" && v.name !== "next-cache"))
            expect(m.readOnly, m.name).toBe(true);
        }
      }
      const dep = docs.find((d) => d.kind === "Deployment");
      const c = dep.spec.template.spec.containers[0];
      expect(c.livenessProbe.httpGet.path).toBe("/health/live");
      expect(c.readinessProbe.httpGet.path).toBe("/health/ready");
      expect(c.startupProbe.httpGet.path).toBe("/health/startup");
      const np = docs.find((d) => d.kind === "NetworkPolicy");
      expect(np.spec.policyTypes).toEqual(["Ingress", "Egress"]);
    },
  );

  it("renders the right objects per kind", () => {
    expect(kinds(render("api-prod-values.yaml").docs)).toEqual([
      "Deployment",
      "HorizontalPodAutoscaler",
      "Job",
      "NetworkPolicy",
      "PodDisruptionBudget",
      "SecretProviderClass",
      "Service",
      "ServiceAccount",
    ]);
    // A worker has no Service and scales on queue depth.
    expect(kinds(render("worker-staging-values.yaml").docs)).toEqual([
      "Deployment",
      "NetworkPolicy",
      "PodDisruptionBudget",
      "ScaledObject",
      "SecretProviderClass",
      "ServiceAccount",
    ]);
    const pub = render("public-dev-values.yaml").docs;
    const mounts = pub.find((d) => d.kind === "Deployment").spec.template.spec.containers[0]
      .volumeMounts;
    expect(mounts.map((m) => m.mountPath)).toContain("/app/.next/cache");
  });

  it("runs migrations as a pre-install and pre-upgrade hook reading the URL from the secrets mount", () => {
    const job = render("api-prod-values.yaml").docs.find((d) => d.kind === "Job");
    expect(job.metadata.annotations["helm.sh/hook"]).toBe("pre-install,pre-upgrade");
    const c = job.spec.template.spec.containers[0];
    expect(c.args).toEqual(["--db-file", "/mnt/secrets/db_migrate_url"]);
    expect(JSON.stringify(c.env)).not.toMatch(/postgres:\/\//);
  });

  describe("@IPB-01-AT-12 refusals", () => {
    it.each(["prod", "dr", "pre-prod"])("refuses a seed profile in %s (IPB-ENV-001)", (env) => {
      const r = render("api-prod-values.yaml", [`env.name=${env}`, "seed.profile=demo"]);
      expect(r.error).toMatch(/IPB-ENV-001: seed profile "demo" refused in/);
    });

    it("allows the seed profile in dev and preview, and passes it to the app", () => {
      for (const f of ["public-dev-values.yaml", "console-preview-values.yaml"]) {
        const { docs, error } = render(f);
        expect(error).toBeUndefined();
        const env = docs.find((d) => d.kind === "Deployment").spec.template.spec.containers[0].env;
        expect(env.some((e) => e.name === "SEED_PROFILE")).toBe(true);
      }
    });

    it("refuses a Supabase host from staging upwards (IPB-ENV-002)", () => {
      const r = render("worker-staging-values.yaml", ["env.vars.DB_HOST=db.abcdefgh.supabase.co"]);
      expect(r.error).toMatch(/IPB-ENV-002: DB_HOST points at a Supabase host, refused in staging/);
    });

    it("refuses a secret-named plain variable from staging upwards (IPB-ENV-003)", () => {
      const r = render("api-prod-values.yaml", ["env.vars.DB_PASSWORD=x"]);
      expect(r.error).toMatch(/IPB-ENV-003: DB_PASSWORD looks like a secret/);
    });

    it("refuses a tag instead of a digest, an unknown environment and a missing secrets provider in prod", () => {
      expect(render("public-dev-values.yaml", ["image.digest=latest"]).error).toMatch(/digest/);
      expect(render("public-dev-values.yaml", ["env.name=qa"]).error).toMatch(/env\.name|name/);
      expect(render("api-prod-values.yaml", ["secrets.provider="]).error).toMatch(/provider/);
    });

    it("needs two or more replicas in prod and keeps default-deny on", () => {
      expect(render("api-prod-values.yaml", ["replicas=1"]).error).toMatch(/replicas/);
      expect(render("public-dev-values.yaml", ["networkPolicy.enabled=false"]).error).toMatch(
        /networkPolicy|enabled/,
      );
    });
  });
});
