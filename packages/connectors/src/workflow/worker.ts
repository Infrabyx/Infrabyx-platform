// Worker helper (PL2 plan §6.9): a Temporal worker with the platform data converter (C-16 codec
// and failure converter) and Worker Versioning by build id. Imported from
// `@infrabyx/connectors/workflow/worker` only by processes that run workers, because it loads
// the Temporal native bridge.
import { NativeConnection, Worker, type WorkerOptions } from "@temporalio/worker";
import { FAILURE_CONVERTER_PATH, type TemporalWorkflow } from "./temporal.js";

export interface IpbWorkerOptions {
  /** The client adapter whose codec, address and namespace the worker shares. */
  adapter: TemporalWorkflow;
  address: string;
  namespace: string;
  taskQueue: string;
  workflowsPath?: string;
  workflowBundle?: WorkerOptions["workflowBundle"];
  activities?: WorkerOptions["activities"];
  /** Worker Versioning: the deployment build id (e.g. the image digest). */
  buildId?: string;
  connection?: NativeConnection;
}

export async function createIpbWorker(o: IpbWorkerOptions): Promise<Worker> {
  const connection = o.connection ?? (await NativeConnection.connect({ address: o.address }));
  return Worker.create({
    connection,
    namespace: o.namespace,
    taskQueue: o.taskQueue,
    ...(o.workflowsPath ? { workflowsPath: o.workflowsPath } : {}),
    ...(o.workflowBundle ? { workflowBundle: o.workflowBundle } : {}),
    ...(o.activities ? { activities: o.activities } : {}),
    dataConverter: {
      payloadCodecs: [o.adapter.codec],
      failureConverterPath: FAILURE_CONVERTER_PATH,
    },
    ...(o.buildId
      ? {
          workerDeploymentOptions: {
            version: { deploymentName: o.taskQueue, buildId: o.buildId },
            useWorkerVersioning: true,
            defaultVersioningBehavior: "PINNED" as const,
          },
        }
      : {}),
  });
}
