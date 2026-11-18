// infrabyx-tally-agent (PR-FBX-46, R1-D-137, R1-D-178): `node dist/main.js [config.json]`.
// Enrols on first start from `<stateDir>/enrol-code`, then polls until SIGTERM or SIGINT.
import { writeFile } from "node:fs/promises";
import { TallyAgent } from "./agent.js";
import { DEFAULT_CONFIG_PATH, loadConfig } from "./config.js";
import { HEARTBEAT_FILE } from "./health.js";
import { FileStateStore } from "./state.js";
import { TallyClient } from "./tally.js";

const log = (line: string) => process.stdout.write(`${new Date().toISOString()} ${line}\n`);

async function main(): Promise<number> {
  const config = await loadConfig(process.argv[2] ?? DEFAULT_CONFIG_PATH);
  const state = new FileStateStore(config.stateDir);
  const beat = () => writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => undefined);
  const agent = new TallyAgent({
    platformUrl: config.platformUrl,
    tally: new TallyClient({ url: config.tallyUrl, timeoutMs: config.tallyTimeoutSeconds * 1000 }),
    state,
    onTurn: beat,
    log,
  });
  await beat();
  if (!(await state.load())) {
    const code = await state.enrolCode();
    if (!code) {
      log(`not enrolled: put the one-time code in ${config.stateDir}/enrol-code and restart`);
      return 78;
    }
    await agent.enrol(code);
    await state.removeEnrolCode();
  }
  const stop = new AbortController();
  for (const s of ["SIGTERM", "SIGINT"] as const) process.once(s, () => stop.abort());
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
