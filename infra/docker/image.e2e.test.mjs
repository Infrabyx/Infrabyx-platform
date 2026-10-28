// Container hardening of every built image (IPB-01-31, PL6 plan §3.3). Runs in the `containers`
// CI job against the images it built, named in IPB_IMAGES (space-separated); skipped elsewhere.
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";

const images = (process.env.IPB_IMAGES ?? "").split(/\s+/).filter(Boolean);
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const started = [];

afterAll(() => {
  for (const id of started) execFileSync("docker", ["rm", "-f", id], { stdio: "ignore" });
});

// The environment the apps validate at start; the database is unreachable on purpose, and the
// fixture adapters (allowed in `test`) stand in for the real ones so no adapter variable is needed.
const ENV = [
  "APP_ENV=test",
  "APP_BASE_URL=https://group.example.org",
  "APP_SITE_URL=https://group.example.org",
  "APP_FIXTURE_ADAPTERS=true",
  "DB_URL=postgres://nobody@127.0.0.1:1/none",
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
