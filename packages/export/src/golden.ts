// The golden archive (IPB-09-35, PL3 plan §7.4, A-10): the demo tenant exported with the run-time
// values normalised, so a PR's export can be compared byte for byte with the archive of the last
// release. The platform's golden archive is a committed fixture under `golden/<map version>/`
// (synthetic data only); products keep theirs the same way until the AUDIT bucket exists.
import type { ExportMap } from "@infrabyx/contracts/export";
import type { MutationKernel } from "@infrabyx/contracts/kernel";
import { buildArchive, type ArchiveSigner, type BuiltArchive } from "./archive.js";
import { exportWorkerContext } from "./service.js";
import { entitiesFor, readSnapshot } from "./snapshot.js";

export async function goldenArchive(o: {
  kernel: MutationKernel;
  map: ExportMap;
  signer: ArchiveSigner;
  tenantId: string;
  product: string;
}): Promise<BuiltArchive> {
  const scope = { type: "FULL_TENANT" as const, ref: null };
  const ctx = exportWorkerContext(o.tenantId);
  const snap = await readSnapshot(o.kernel, ctx, o.map, entitiesFor(o.map, scope));
  return buildArchive({
    map: o.map,
    archiveId: "arc_00000000000000000000000000",
    tenantId: o.tenantId,
    ownerName: snap.ownerName,
    product: o.product,
    release: "normalised",
    scope,
    requester: "normalised",
    approvers: [],
    asOf: snap.asOf,
    predecessorArchiveId: null,
    datasets: snap.datasets,
    relationships: snap.relationships,
    signer: o.signer,
    normalise: true,
  });
}
