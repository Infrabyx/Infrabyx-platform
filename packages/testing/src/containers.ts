// Pinned test images and a generic container starter (PL2 plan §3.11, §7). Digests are recorded in
// infra/docker/TEST_IMAGES.md; a unit test keeps the two in step. Images come from Docker Hub
// (the PL2 spike found ECR Public anonymous pulls capped; GHCR and quay.io unreachable from the
// build sandbox). Set IPB_TEST_<NAME>_URL to reuse a running service instead of starting one.
import { z } from "zod";
import { envVar, validateEnv } from "@infrabyx/config/env";

export interface TestImage {
  image: string;
  version: string;
  /** What the image stands in for. */
  role: string;
}

export const TEST_IMAGES = {
  postgres: {
    image:
      "postgres:18-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5",
    version: "18",
    role: "platform PostgreSQL; pg-boss",
  },
  pgbouncer: {
    image:
      "edoburu/pgbouncer@sha256:8638aa563607256d3c7440437534195f1066a92b68015d89ae9d6b935b444a6d",
    version: "1.26.1",
    role: "transaction-mode pooler standing in for Supavisor (PL2-D-15)",
  },
  redis: {
    image:
      "redis:7.4-alpine@sha256:57e4255cc971b1c8d6f8a6ca283ac01bc3ecdd914273ef6bfaede87aaecd6541",
    version: "7.4.11",
    role: "BullMQ reference (QUEUE)",
  },
  valkey: {
    image: "valkey/valkey@sha256:081c2f5cb575efc901aa80ff9cdbd1ec6a301682fd35e1ebb4b0990a4a4a8507",
    version: "8.1.10",
    role: "BullMQ on Valkey (ElastiCache)",
  },
  temporal: {
    image:
      "temporalio/temporal@sha256:ad4c82c97bd12b417d1ea942610dbcd511afb250c4d5ed26c694009533df447e",
    version: "CLI 1.9.1, server 1.32.0",
    role: "Temporal dev server (WORKFLOW)",
  },
  cerbos: {
    image: "cerbos/cerbos@sha256:e5e3b150b3cb0090975605254f255164567d67e233634199fb20972e3eaff300",
    version: "0.57.0",
    role: "Cerbos PDP (AUTHZ)",
  },
  localstack: {
    image:
      "localstack/localstack@sha256:0df3a97da57de03a588c05d9b8f390f15c7033fc7c4512f94619d344bc3cd317",
    version: "4.12.0 (last licence-free community build)",
    role: "AWS KMS with MessageType DIGEST; SNS",
  },
  moto: {
    image:
      "motoserver/moto@sha256:120b1589c6df7e35d2092935f6ff724486bb2c4189d0e36ce795baba1400ffd2",
    version: "5.2.4",
    role: "AWS Secrets Manager, S3 lock checks, SES v2 send",
  },
} as const satisfies Record<string, TestImage>;
export type TestImageName = keyof typeof TEST_IMAGES;

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
}

/** Start a pinned image, or reuse the service named by IPB_TEST_<NAME>_URL. */
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
  let c = new GenericContainer(TEST_IMAGES[name].image).withExposedPorts(...opts.ports);
  if (opts.env) c = c.withEnvironment(opts.env);
  if (opts.command) c = c.withCommand([...opts.command]);
  if (opts.readyLog) c = c.withWaitStrategy(Wait.forLogMessage(opts.readyLog));
  const started = await c.start();
  return {
    host: started.getHost(),
    ports: Object.fromEntries(opts.ports.map((x) => [x, started.getMappedPort(x)])),
    stop: async () => void (await started.stop()),
  };
}
