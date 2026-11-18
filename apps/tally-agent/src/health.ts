// The image's HEALTHCHECK (PR-FBX-46, R1-D-178): the agent listens on no port, so its liveness is
// a heartbeat file it rewrites after every loop turn; healthy while that is under 90 seconds old.
// A turn that cannot reach the platform or TallyPrime still beats: the loop is alive and backing
// off, and the platform's port health (`degraded`, then `down`) shows that it is not polling.
import { stat } from "node:fs/promises";

export const HEARTBEAT_FILE = "/tmp/infrabyx-tally-agent.heartbeat";
export const HEARTBEAT_MAX_AGE_MS = 90_000;

export async function healthy(file = HEARTBEAT_FILE, now = Date.now()): Promise<boolean> {
  try {
    return now - (await stat(file)).mtimeMs <= HEARTBEAT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("/health.js"))
  healthy().then(
    (ok) => process.exit(ok ? 0 : 1),
    () => process.exit(1),
  );
