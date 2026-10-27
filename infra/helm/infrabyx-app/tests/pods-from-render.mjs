// Turns a rendered chart (stdin) into the Pods its Deployments and Jobs would create (stdout), so
// `kyverno apply` checks the admission policies against exactly what the cluster would admit
// (PL6 plan §6). Labels come from the pod template, as the API server would set them.
import { parseAllDocuments, stringify } from "yaml";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const pods = parseAllDocuments(input)
  .map((d) => d.toJSON())
  .filter((d) => d && (d.kind === "Deployment" || d.kind === "Job"))
  .map((d) => ({
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: `${d.metadata.name}-${d.kind.toLowerCase()}`,
      namespace: "apps",
      labels: d.spec.template.metadata?.labels ?? {},
    },
    spec: d.spec.template.spec,
  }));
if (pods.length === 0) {
  console.error("pods-from-render: no Deployment or Job in the input");
  process.exit(1);
}
process.stdout.write(pods.map((p) => stringify(p)).join("---\n"));
