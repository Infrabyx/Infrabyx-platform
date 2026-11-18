// infrabyx-tally-agent (PR-FBX-46, R1-D-137, R1-D-178): `node dist/main.js [config.json]`.
// Until it is enrolled it waits for the one-time code in `<stateDir>/enrol-code` (looking every
// 30 seconds, and backing off when the platform cannot be reached); once enrolled it removes the
// code file and polls for jobs until SIGTERM or SIGINT. It beats the heartbeat all along, so the
// image's health check reflects a live loop.
import { writeFile } from "node:fs/promises";
import { PlatformRefused, TallyAgent } from "./agent.js";
import { DEFAULT_CONFIG_PATH, loadConfig } from "./config.js";
import { HEARTBEAT_FILE } from "./health.js";
import { DpapiKeyGuard } from "./keyguard.js";
import { FileStateStore } from "./state.js";
import { TallyClient } from "./tally.js";

const log = (line: string) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);
const beat = () => writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => undefined);

/** Sleeps up to `ms`, beating every 15 seconds; false once `signal` aborts. */
async function rest(ms: number, signal: AbortSignal): Promise<boolean> {
  const until = Date.now() + ms;
  while (!signal.aborted && Date.now() < until) {
    await beat();
    await new Promise((r) => setTimeout(r, Math.min(15_000, until - Date.now())));
  }
  return !signal.aborted;
}

async function main(): Promise<number> {
  const config = await loadConfig(process.argv[2] ?? DEFAULT_CONFIG_PATH);
  const state = new FileStateStore(config.stateDir);
  const stop = new AbortController();
  for (const s of ["SIGTERM", "SIGINT"] as const) process.once(s, () => stop.abort());
  const agent = new TallyAgent({
    platformUrl: config.platformUrl,
    tally: new TallyClient({ url: config.tallyUrl, timeoutMs: config.tallyTimeoutSeconds * 1000 }),
    state,
    // #136 (4): DPAPI on Windows for the account the agent's service runs as.
    keyGuard:
      process.platform === "win32" && config.keyProtection === "auto"
        ? new DpapiKeyGuard(config.powershellPath ? { powershellPath: config.powershellPath } : {})
        : null,
    onTurn: beat,
    log,
  });
  await beat();
  let backoff = 30_000;
  let told = false;
  while (!(await state.load())) {
    const code = await state.enrolCode();
    if (!code) {
      if (!told) log(`not enrolled: put the one-time code in ${config.stateDir}/enrol-code`);
      told = true;
      if (!(await rest(30_000, stop.signal))) return 0;
      continue;
    }
    try {
      await agent.enrol(code);
      await state.removeEnrolCode();
    } catch (e) {
      if (e instanceof PlatformRefused && (e.status === 400 || e.status === 401)) {
        log("the platform refused the enrolment code; ask an admin to issue a new one");
        await state.removeEnrolCode();
      } else log(`enrolment failed: ${e instanceof Error ? e.message : "error"}; retrying`);
      if (!(await rest(backoff, stop.signal))) return 0;
      backoff = Math.min(backoff * 2, 300_000);
    }
  }
  log("polling");
  await agent.run(stop.signal);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    log(`stopped: ${e instanceof Error ? e.message : "error"}`);
    process.exit(1);
  },
);
