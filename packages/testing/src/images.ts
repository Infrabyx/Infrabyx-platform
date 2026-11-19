// Pinned test images and the JVM option every JVM-carrying image starts with (PL2 plan §3.11; R1-D-192).
// Digests are recorded in infra/docker/TEST_IMAGES.md; a unit test keeps the two in step. This module
// imports nothing, so repository checks that run before the packages are built (the `containers`
// job's infra/docker tests) can read it; containers.ts re-exports it.

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
  pgvector: {
    image:
      "pgvector/pgvector:0.8.6-pg18@sha256:2ba9ca5f2e7daa0f0e7723cba1ee9167bab54efd3640516a44ac1a928dd67e7a",
    version: "PostgreSQL 18, pgvector 0.8.6",
    role: "platform PostgreSQL with vector search (startPostgres, CI integration; PL4)",
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
  keycloak: {
    image:
      "keycloak/keycloak@sha256:3879c623248408de29a5303178b5816c77e8dfef3890c361f8c0bbeaa979ba3b",
    version: "26.8.2-0",
    role: "Keycloak, dev mode with in-memory H2 (IDENTITY)",
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
  openfga: {
    image:
      "openfga/openfga@sha256:9cf9a20af32a40434cd3a788c429879439ee9ea9abf65c9c200ee17cd43f769e",
    version: "v1.22.0",
    role: "OpenFGA, memory store (AUTHZ)",
  },
  openbao: {
    image:
      "openbao/openbao@sha256:6d2b93856e3fcf7b18ad855a0b51eaba474dc8b79cf554379ea32034797d2acf",
    version: "2.7.1",
    role: "OpenBao KV v2, Transit and database engines (SECRETS, KMS)",
  },
  otelcol: {
    image:
      "otel/opentelemetry-collector-contrib@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6",
    version: "0.162.0",
    role: "OTel Collector with file exporters (OBSERVABILITY)",
  },
  zitadel: {
    image:
      "ghcr.io/zitadel/zitadel@sha256:a586456a208e0db4c633db0ba43c427c24b37846138b8b13ff16ad8e003a18d3",
    version: "v4.19.5",
    role: "Zitadel with PostgreSQL (IDENTITY alternative; GHCR, so CI only)",
  },
  livekit: {
    image:
      "livekit/livekit-server:v1.13.11@sha256:25cd902de7cacbd5f1f779f6a6ac1eae20ba8f56b0935934ce6b0ab80d1e3d20",
    version: "v1.13.11",
    role: "LiveKit server, single node, no egress worker (VIDEO_MEET)",
  },
  gotenberg: {
    image:
      "gotenberg/gotenberg:8.39.0@sha256:13672f317b443c793e972b1bd2155ec62a3e7b6891b411e8196442cc053ee5f5",
    version: "8.39.0",
    role: "Gotenberg (Chromium and LibreOffice, fonts-noto-core) for DOCGEN renderHtml (#120)",
  },
  clamav: {
    image:
      "clamav/clamav:1.5.4@sha256:45fe5149fbee5a46509c9848ef20d0c354b7b2323c9369f285939a37cf33422a",
    version: "1.5.4",
    role: "ClamAV clamd with its signature databases, TCP 3310 (AV; PR-LDC-41)",
  },
  unleash: {
    image:
      "unleashorg/unleash-server@sha256:5020013b7a9a93c8ed3686d36b5025399714020b3fb5ef41afd84ba37a88c050",
    version: "8.2.0",
    role: "Unleash OSS (FEATURE_FLAG)",
  },
} as const satisfies Record<string, TestImage>;
export type TestImageName = keyof typeof TEST_IMAGES;

/**
 * The JVM option the platform sets on every image that carries an OpenJDK runtime: the HotSpot
 * Base64 intrinsic off on every host, whatever the CPU (CVE-2026-114938, "Java4Shell"; owner answer
 * #143, waiver OWNER-WAIVER-CRIT-01, R1-D-192). Remove with the waiver once fixed images are pinned.
 */
export const JVM_BASE64_INTRINSIC_OFF = "-XX:-UseBASE64Intrinsics";

/**
 * The variable each JVM-carrying test image reads the option from: Keycloak's kc.sh appends
 * `JAVA_OPTS_APPEND` last; Gotenberg (pdftk) and LocalStack start their JVMs as child processes,
 * which inherit `JAVA_TOOL_OPTIONS` (the JVM reads it itself, also when embedded). The other test
 * images carry no JVM (scan of 19 Nov 2026, R1-D-192). infra/compose/docker-compose.yml sets the
 * same values; infra/docker/jvm-mitigation.test.mjs keeps the two in step, and the `containers`
 * job reads the flag from the live JVMs.
 */
export const TEST_IMAGE_JVM_OPTIONS_VAR: Readonly<Partial<Record<TestImageName, string>>> = {
  keycloak: "JAVA_OPTS_APPEND",
  gotenberg: "JAVA_TOOL_OPTIONS",
  localstack: "JAVA_TOOL_OPTIONS",
};

/**
 * `env` with {@link JVM_BASE64_INTRINSIC_OFF} appended last to the image's JVM options variable (a
 * caller's own value is kept in front of it; HotSpot takes the last value of a repeated flag).
 * Images without a JVM get `env` unchanged.
 */
export function withJvmMitigation(
  name: TestImageName,
  env: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const variable = TEST_IMAGE_JVM_OPTIONS_VAR[name];
  if (!variable) return { ...env };
  const current = env[variable]?.trim() ?? "";
  if (current.endsWith(JVM_BASE64_INTRINSIC_OFF)) return { ...env };
  return {
    ...env,
    [variable]: current ? `${current} ${JVM_BASE64_INTRINSIC_OFF}` : JVM_BASE64_INTRINSIC_OFF,
  };
}
