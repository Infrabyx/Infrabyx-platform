// The agent's state file (PR-FBX-46, R1-D-178): `<stateDir>/agent.json` holds its identity, its
// P-256 private key and the last request `seq`. Written atomically (a temporary file, then a
// rename) with mode 0600; a state file other users can read is refused, as ssh refuses a private
// key with loose permissions. The tenant's machine is the trust boundary (as for TallyPrime's own
// data); the volume should be the agent's alone. The one-time enrolment code is read from
// `<stateDir>/enrol-code` and the file removed once the agent is enrolled.
import { chmod, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentState, AgentStateStore } from "./agent.js";

// #136 (4), R1-D-184: on Windows the key is a DPAPI blob (`privateKeyDpapi`) for the agent's own
// account; the PEM (`privateKeyPem`) is the fallback, reported as a warning at enrolment.

const State = z
  .object({
    tenantId: z.string().min(5).max(64),
    agentId: z.string().regex(/^tga_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    company: z.string().min(1).max(120),
    privateKeyPem: z.string().startsWith("-----BEGIN PRIVATE KEY-----").max(4096).optional(),
    privateKeyDpapi: z
      .string()
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .max(8192)
      .optional(),
    keyProtection: z.enum(["dpapi", "file"]).optional(),
    lastSeq: z.number().int().min(0),
    pollTimeoutSeconds: z.number().int().min(1).max(55),
  })
  .strict()
  .refine((s) => (s.privateKeyPem === undefined) !== (s.privateKeyDpapi === undefined), {
    message: "exactly one of privateKeyPem and privateKeyDpapi",
  });

export class FileStateStore implements AgentStateStore {
  readonly file: string;
  constructor(private readonly dir: string) {
    this.file = join(dir, "agent.json");
  }

  async load(): Promise<AgentState | null> {
    let st;
    try {
      st = await stat(this.file);
    } catch {
      return null;
    }
    if ((st.mode & 0o077) !== 0)
      throw new Error(`${this.file} is readable by other users; chmod 600 it`);
    return State.parse(JSON.parse(await readFile(this.file, "utf8"))) as AgentState;
  }

  async save(s: AgentState): Promise<void> {
    const tmp = `${this.file}.tmp`;
    const fh = await open(tmp, "w", 0o600);
    try {
      await fh.writeFile(JSON.stringify(State.parse(s)));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await chmod(tmp, 0o600);
    await rename(tmp, this.file);
  }

  /** The one-time code the tenant's admin placed in the state directory, if any. */
  async enrolCode(): Promise<string | null> {
    try {
      return (await readFile(join(this.dir, "enrol-code"), "utf8")).trim() || null;
    } catch {
      return null;
    }
  }

  async removeEnrolCode(): Promise<void> {
    await rm(join(this.dir, "enrol-code"), { force: true });
  }
}
