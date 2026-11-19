// CVE-2026-114938 ("Java4Shell"; owner answer #143, waiver OWNER-WAIVER-CRIT-01, R1-D-192): the
// flag read back from the live JVMs. Runs in the `containers` job (and `pnpm check:full
// --with-images`); skipped elsewhere.
//   IPB_KEYCLOAK_IMAGE  the Keycloak customer image that job built: its JVM reports
//                       UseBASE64Intrinsics=false {command line} through `jcmd VM.flags`, also when
//                       the deployment's own JVM options try to turn it back on, and a JVM variable
//                       that names the flag stops the node before it starts.
//   IPB_JVM_IMAGES=1    the third-party JVM images, started as infra/compose/docker-compose.yml and
//                       the test harness define them: stock Keycloak and OpenSearch (`jcmd`), the
//                       pdftk JVM that Gotenberg starts for a merge, and LocalStack's JVM.
// The waiver in trivyignore.yaml is valid only while this file passes (the same required job).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { TEST_IMAGES, withJvmMitigation } from "../../packages/testing/src/containers.ts";
import { JVM_IMAGES, JVM_MITIGATION } from "./jvm-images.mjs";

const keycloakImage = process.env.IPB_KEYCLOAK_IMAGE ?? "";
const thirdParty = process.env.IPB_JVM_IMAGES === "1";
const ROOT = join(import.meta.dirname, "..", "..");
const compose = parse(readFileSync(join(ROOT, "infra/compose/docker-compose.yml"), "utf8"));
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const started = [];
afterAll(() => {
  for (const id of started) spawnSync("docker", ["rm", "-f", id], { stdio: "ignore" });
});

/** The live JVM's value and origin, e.g. `false {command line}`. */
const FLAG_LINE = /bool\s+UseBASE64Intrinsics\s+=\s+(\w+)\s+\{[^}]*\}\s+\{([^}]+)\}/;
const flag = (text) => {
  const m = FLAG_LINE.exec(text);
  return m ? `${m[1]} {${m[2]}}` : `not found in: ${text.slice(0, 400)}`;
};

function start(args) {
  const id = docker(
    "run",
    "-d",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    ...args,
  );
  started.push(id);
  return id;
}

async function waitForLog(id, pattern, seconds) {
  for (let i = 0; i < seconds; i++) {
    const logs = spawnSync("docker", ["logs", id], { encoding: "utf8" });
    if (pattern.test(`${logs.stdout}${logs.stderr}`)) return;
    await sleep(1000);
  }
  throw new Error(`${pattern} not logged in ${seconds}s: ${docker("logs", "--tail", "40", id)}`);
}

/** `jcmd <pid> VM.flags -all` on the JVM whose main class matches, inside the container. */
function liveFlag(id, mainClass, jcmd = "jcmd") {
  const list = docker("exec", id, jcmd, "-l");
  const pid = list
    .split("\n")
    .find((l) => mainClass.test(l))
    ?.split(" ")[0];
  expect(pid, list).toBeTruthy();
  return flag(docker("exec", id, jcmd, pid, "VM.flags", "-all"));
}

const envArgs = (env) => Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
const composeEnv = (service) => compose.services[service].environment ?? {};

describe.skipIf(!keycloakImage)(
  "@IPB-01-AT-15 CVE-2026-114938 mitigation: the Keycloak customer image",
  () => {
    it("passes its own check (the one its build runs)", () => {
      expect(docker("run", "--rm", keycloakImage, "--ipb-verify-jvm")).toBe(
        "ipb-kc.sh: UseBASE64Intrinsics=false {command line}",
      );
    });

    it("runs Keycloak's JVM with the intrinsic off from the command line", async () => {
      const id = start([keycloakImage, "start-dev"]);
      await waitForLog(id, /Listening on/, 180);
      expect(liveFlag(id, /QuarkusEntryPoint/)).toBe("false {command line}");
    }, 240_000);

    it("keeps it off when the deployment's JAVA_OPTS and JAVA_OPTS_APPEND try to turn it on", async () => {
      const id = start([
        "-e",
        "JAVA_OPTS_APPEND=-XX:+UseBASE64Intrinsics",
        "-e",
        "JAVA_OPTS=-Xms64m -Xmx512m -XX:+UseBASE64Intrinsics",
        keycloakImage,
        "start-dev",
      ]);
      await waitForLog(id, /Listening on/, 180);
      expect(liveFlag(id, /QuarkusEntryPoint/)).toBe("false {command line}");
      const cmdline = docker("exec", id, "jcmd", "1", "VM.command_line");
      expect(cmdline.match(/[-+]UseBASE64Intrinsics/g)?.at(-1)).toBe("-UseBASE64Intrinsics");
    }, 240_000);

    it.each(["_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "JAVA_TOOL_OPTIONS"])(
      "refuses to start when %s names the flag",
      (variable) => {
        const r = spawnSync(
          "docker",
          ["run", "--rm", "-e", `${variable}=-XX:+UseBASE64Intrinsics`, keycloakImage, "start-dev"],
          { encoding: "utf8" },
        );
        expect(r.status).toBe(64);
        expect(r.stderr).toContain(`refusing to start: ${variable} names UseBASE64Intrinsics`);
      },
    );
  },
);

describe.skipIf(!thirdParty)(
  "@IPB-01-AT-15 CVE-2026-114938 mitigation: third-party JVM images as shipped",
  () => {
    it("stock Keycloak (Compose `keycloak`, TEST_IMAGES.keycloak)", async () => {
      const env = composeEnv("keycloak");
      expect(env.JAVA_OPTS_APPEND).toBe(withJvmMitigation("keycloak").JAVA_OPTS_APPEND);
      const id = start([
        ...envArgs({ JAVA_OPTS_APPEND: env.JAVA_OPTS_APPEND }),
        TEST_IMAGES.keycloak.image,
        "start-dev",
      ]);
      await waitForLog(id, /Listening on/, 180);
      expect(liveFlag(id, /QuarkusEntryPoint/)).toBe("false {command line}");
    }, 240_000);

    it("OpenSearch (Compose `opensearch`)", async () => {
      const env = composeEnv("opensearch");
      const id = start([
        ...envArgs({
          "discovery.type": "single-node",
          OPENSEARCH_INITIAL_ADMIN_PASSWORD: "Ipb-jvm-check-9f3c2a7e",
          OPENSEARCH_JAVA_OPTS: env.OPENSEARCH_JAVA_OPTS,
        }),
        compose.services.opensearch.image,
      ]);
      await waitForLog(id, /started|Node .* initialized/, 240);
      expect(
        liveFlag(
          id,
          /org\.opensearch\.bootstrap\.OpenSearch/,
          "/usr/share/opensearch/jdk/bin/jcmd",
        ),
      ).toBe("false {command line}");
    }, 300_000);

    // pdftk's JVM lives only for one request, so it writes its own resolved flags to a file in the
    // container: the shipped JAVA_TOOL_OPTIONS plus diagnostics, read back after a merge forced
    // through pdftk.
    it.each([
      [
        "Compose `gotenberg`",
        () => compose.services.gotenberg.image,
        () => composeEnv("gotenberg"),
      ],
      [
        "TEST_IMAGES.gotenberg",
        () => TEST_IMAGES.gotenberg.image,
        () => withJvmMitigation("gotenberg"),
      ],
    ])(
      "Gotenberg's pdftk JVM (%s)",
      async (_label, image, shippedEnv) => {
        const tool = shippedEnv().JAVA_TOOL_OPTIONS;
        expect(tool).toBe(JVM_MITIGATION);
        const diag = `${tool} -XX:+UnlockDiagnosticVMOptions -XX:+LogVMOutput -XX:LogFile=/tmp/ipb-jvm-%p.log -XX:+PrintFlagsFinal`;
        const id = start([
          "-e",
          `JAVA_TOOL_OPTIONS=${diag}`,
          image(),
          "gotenberg",
          "--pdfengines-merge-engines=pdftk",
        ]);
        await waitForLog(id, /server started|listening|http server/i, 120);
        const pdf = onePagePdf().toString("base64");
        // The merge runs inside the container (no published port), through the API as a product calls it.
        const merge = spawnSync(
          "docker",
          [
            "exec",
            id,
            "sh",
            "-c",
            `echo ${pdf} | base64 -d > /tmp/a.pdf && curl -s -o /tmp/out.pdf -w '%{http_code}' -F files=@/tmp/a.pdf -F files=@/tmp/a.pdf http://127.0.0.1:3000/forms/pdfengines/merge`,
          ],
          { encoding: "utf8" },
        );
        expect(merge.stdout).toBe("200");
        expect(flag(docker("exec", id, "sh", "-c", "cat /tmp/ipb-jvm-*.log"))).toBe(
          "false {environment}",
        );
      },
      180_000,
    );

    it("LocalStack's JVM (TEST_IMAGES.localstack)", () => {
      const env = withJvmMitigation("localstack");
      expect(Object.keys(env)).toEqual([JVM_IMAGES["localstack/localstack"].variable]);
      const r = spawnSync(
        "docker",
        [
          "run",
          "--rm",
          ...envArgs(env),
          "--entrypoint",
          "/usr/lib/localstack/java/21/bin/java",
          TEST_IMAGES.localstack.image,
          "-XX:+PrintFlagsFinal",
          "-version",
        ],
        { encoding: "utf8" },
      );
      expect(flag(r.stdout)).toBe("false {environment}");
    }, 600_000);
  },
);

/** The smallest valid one-page PDF, with a correct cross-reference table. */
function onePagePdf() {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let s = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = s.length;
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  s += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, "latin1");
}
