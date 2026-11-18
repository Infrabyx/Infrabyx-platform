// Container hardening of every built image (IPB-01-31, PL6 plan §3.3). Runs in the `containers`
// CI job against the images it built, named in IPB_IMAGES (space-separated); skipped elsewhere.
// The TallyPrime agent (IPB_AGENT_IMAGE; PR-FBX-46, R1-D-178) listens on no port, so it has its
// own block: the same user, root and capability checks, nothing listening, and its heartbeat
// health check while it waits for an enrolment code.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";

const images = (process.env.IPB_IMAGES ?? "").split(/\s+/).filter(Boolean);
const agentImage = process.env.IPB_AGENT_IMAGE ?? "";
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const started = [];

afterAll(() => {
  for (const id of started) execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
});

// The environment the apps validate at start; the database (and the web app's API) is unreachable on purpose, and the
// fixture adapters (allowed in `test`) stand in for the real ones so no adapter variable is needed.
const ENV = [
  "APP_ENV=test",
  "APP_BASE_URL=https://group.example.org",
  "APP_SITE_URL=https://group.example.org",
  "APP_FIXTURE_ADAPTERS=true",
  "DB_URL=postgres://nobody@127.0.0.1:1/none",
  // The reference web app's API, unreachable on purpose as the database is.
  "APP_API_URL=http://127.0.0.1:1",
  "PORT=3000",
];

/** Start an image as the chart runs it: read-only root, no capabilities, two empty volumes. */
function run(image) {
  const id = docker(
    "run",
    "-d",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/app/.next/cache:uid=10001",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    ...ENV.flatMap((e) => ["-e", e]),
    image,
  );
  started.push(id);
  return id;
}

/** GET a path from inside the container (no published port needed). */
const probe = (id, path) =>
  docker(
    "exec",
    id,
    "node",
    "-e",
    `fetch("http://127.0.0.1:3000${path}").then(async (r) => console.log(r.status, await r.text()), () => console.log(0))`,
  );

describe.skipIf(images.length === 0)("@IPB-01-AT-15 container hardening", () => {
  for (const image of images) {
    describe(image, () => {
      const config = () => JSON.parse(docker("inspect", image, "--format", "{{json .Config}}"));

      it("runs as UID 10001 with a HEALTHCHECK and an exec-form entrypoint", () => {
        const c = config();
        expect(c.User).toBe("10001");
        expect(c.Healthcheck?.Test?.[0]).toBe("CMD");
        expect(c.Entrypoint?.[0]).toBe("node");
      });

      it("is not tagged latest", () => {
        expect(image).not.toMatch(/:latest$/);
        expect(image).toMatch(/:[\w.-]+$/);
      });

      it("serves /health/live on a read-only root, fails ready closed, and cannot write its code", async () => {
        const id = run(image);
        let live = "";
        for (let i = 0; i < 60 && !live.startsWith("200"); i++) {
          await sleep(1_000);
          try {
            live = probe(id, "/health/live");
          } catch {
            live = "";
          }
        }
        expect(live).toBe('200 {"status":"up"}');
        expect(probe(id, "/health/ready")).toMatch(/^503 .*"status":"down"/);
        expect(docker("exec", id, "id", "-u")).toBe("10001");
        expect(() =>
          docker("exec", id, "node", "-e", "require('node:fs').writeFileSync('/app/x', '')"),
        ).toThrow();
        expect(() => docker("exec", id, "touch", "/etc/x")).toThrow();
        // The image's own HEALTHCHECK agrees.
        let health = "";
        for (let i = 0; i < 90 && health !== "healthy"; i++) {
          await sleep(1_000);
          health = docker("inspect", id, "--format", "{{.State.Health.Status}}");
        }
        expect(health).toBe("healthy");
      }, 180_000);
    });
  }
});

describe.skipIf(!agentImage)("@IPB-01-AT-15 container hardening: the TallyPrime agent", () => {
  it("runs as UID 10001 with a HEALTHCHECK, an exec-form entrypoint and no exposed port", () => {
    const c = JSON.parse(docker("inspect", agentImage, "--format", "{{json .Config}}"));
    expect(c.User).toBe("10001");
    expect(c.Healthcheck?.Test?.[0]).toBe("CMD");
    expect(c.Entrypoint?.[0]).toBe("node");
    expect(c.ExposedPorts ?? null).toBeNull();
    expect(Object.keys(c.Volumes ?? {})).toEqual(["/data"]);
    expect(agentImage).not.toMatch(/:latest$/);
  });

  it("waits for its code on a read-only root, listens on nothing, and is healthy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tally-agent-"));
    const cfg = join(dir, "config.json");
    // An unreachable platform on purpose: the agent waits for a code and keeps its heartbeat.
    writeFileSync(cfg, JSON.stringify({ platformUrl: "https://127.0.0.1:1" }));
    chmodSync(cfg, 0o644);
    const id = docker(
      "run",
      "-d",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "-v",
      `${cfg}:/etc/infrabyx-tally-agent/config.json:ro`,
      agentImage,
    );
    started.push(id);
    let health = "";
    for (let i = 0; i < 90 && health !== "healthy"; i++) {
      await sleep(1_000);
      health = docker("inspect", id, "--format", "{{.State.Health.Status}}");
    }
    expect(health).toBe("healthy");
    expect(docker("exec", id, "id", "-u")).toBe("10001");
    // No socket in LISTEN (state 0A) in the container's network namespace.
    const listening = docker(
      "exec",
      id,
      "node",
      "-e",
      `const fs=require("node:fs");let n=0;for(const f of ["/proc/net/tcp","/proc/net/tcp6"]){try{for(const l of fs.readFileSync(f,"utf8").split("\\n").slice(1))if(l.trim().split(/\\s+/)[3]==="0A")n++}catch{}}console.log(n)`,
    );
    expect(listening).toBe("0");
    expect(() =>
      docker("exec", id, "node", "-e", "require('node:fs').writeFileSync('/app/x', '')"),
    ).toThrow();
    expect(docker("logs", id)).toMatch(/not enrolled: put the one-time code/);
  }, 180_000);
});
