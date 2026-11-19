// Pinned test images and a generic container starter (PL2 plan §3.11, §7). Digests are recorded in
// infra/docker/TEST_IMAGES.md; a unit test keeps the two in step. Images come from Docker Hub
// (the PL2 spike found ECR Public anonymous pulls capped; GHCR and quay.io unreachable from the
// build sandbox), except Zitadel (GHCR), which runs in CI only. MinIO has no pinnable image any
// more; CI builds its last community release from source (scripts/ci/minio-server.sh, PL2-D-61).
// Set IPB_TEST_<NAME>_URL to reuse a running service instead of starting one.
import { z } from "zod";
import type { GenericContainer } from "testcontainers";
import { envVar, validateEnv } from "@infrabyx/config/env";

import { TEST_IMAGES, withJvmMitigation, type TestImageName } from "./images.js";

export * from "./images.js";

export interface StartedService {
  host: string;
  /** Mapped host port for each requested container port. */
  ports: Record<number, number>;
  /** Set when IPB_TEST_<NAME>_URL pointed at an existing service. */
  url?: string;
  stop(): Promise<void>;
}

export interface StartServiceOptions {
  ports: readonly number[];
  env?: Record<string, string>;
  command?: readonly string[];
  /** Log line that marks the service ready. */
  readyLog?: RegExp;
  /** HTTP path answering 200 when ready, probed from the host (for images without a shell, where
   * the default port check cannot run inside the container). */
  readyHttp?: { path: string; port: number };
  /** Files written into the container before it starts (configuration). */
  files?: ReadonlyArray<{ content: string; target: string }>;
  /** Further container settings (bind mounts, networks, user). */
  configure?: (c: GenericContainer) => GenericContainer;
  /**
   * Build the image from a Dockerfile in the repository instead (e.g. Keycloak with the customer
   * extension, `infra/keycloak/customer-otp`). The Dockerfile must start from the pinned image of
   * `name`; the build is cached by Docker between runs.
   */
  build?: { context: string; dockerfile?: string };
}

/** Start a pinned image, or reuse the service named by IPB_TEST_<NAME>_URL. */
/** The service named by IPB_TEST_<NAME>_URL, if set (services CI starts itself, such as MinIO). */
export async function existingServiceUrl(
  name: TestImageName | "minio",
): Promise<string | undefined> {
  const varName = `IPB_TEST_${name.toUpperCase()}_URL`;
  const schema = z.object({
    [varName]: envVar(z.string().url(), {
      desc: `Existing ${name} service for tests`,
      example: "http://127.0.0.1:1234",
      required: "opt",
      sens: "C",
      port: "IPB",
    }),
  });
  const r = await validateEnv(schema, { guards: [], defaultAppEnv: "test" });
  return r.ok ? (r.values as Record<string, string | undefined>)[varName] : undefined;
}

export async function startService(
  name: TestImageName,
  opts: StartServiceOptions,
): Promise<StartedService> {
  const varName = `IPB_TEST_${name.toUpperCase()}_URL`;
  const schema = z.object({
    [varName]: envVar(z.string().url(), {
      desc: `Existing ${name} service for tests`,
      example: "http://127.0.0.1:1234",
      required: "opt",
      sens: "C",
      port: "IPB",
    }),
  });
  const r = await validateEnv(schema, { guards: [], defaultAppEnv: "test" });
  const existing = r.ok ? (r.values as Record<string, string | undefined>)[varName] : undefined;
  if (existing) {
    const u = new URL(existing);
    const p = Number(u.port);
    return {
      host: u.hostname,
      ports: Object.fromEntries(opts.ports.map((x) => [x, p])),
      url: existing,
      stop: async () => {},
    };
  }
  const { GenericContainer, Wait } = await import("testcontainers");
  let c = (
    opts.build
      ? await GenericContainer.fromDockerfile(
          opts.build.context,
          opts.build.dockerfile ?? "Dockerfile",
        )
          .withBuildkit()
          .withCache(true)
          .build(`ipb-test-${name}-built:local`, { deleteOnExit: false })
      : new GenericContainer(TEST_IMAGES[name].image)
  ).withExposedPorts(...opts.ports);
  // Every start carries the JVM mitigation, built images included (R1-D-192).
  const env = withJvmMitigation(name, opts.env);
  if (Object.keys(env).length > 0) c = c.withEnvironment(env);
  if (opts.command) c = c.withCommand([...opts.command]);
  if (opts.readyLog) c = c.withWaitStrategy(Wait.forLogMessage(opts.readyLog));
  if (opts.readyHttp)
    c = c.withWaitStrategy(
      Wait.forHttp(opts.readyHttp.path, opts.readyHttp.port).forStatusCode(200),
    );
  if (opts.files) c = c.withCopyContentToContainer(opts.files.map((f) => ({ ...f })));
  if (opts.configure) c = opts.configure(c);
  const started = await c.start();
  return {
    host: started.getHost(),
    ports: Object.fromEntries(opts.ports.map((x) => [x, started.getMappedPort(x)])),
    stop: async () => void (await started.stop()),
  };
}

/** A user-defined Docker network for services that talk to each other (e.g. Zitadel and its database). */
export async function startNetwork(): Promise<{ name: string; stop(): Promise<void> }> {
  const { Network } = await import("testcontainers");
  const n = await new Network().start();
  return { name: n.getName(), stop: async () => void (await n.stop()) };
}
