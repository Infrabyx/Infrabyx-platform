// Which images the platform ships carry an OpenJDK runtime, and the variable each one's JVMs read
// the CVE-2026-114938 mitigation from (owner answer #143, OWNER-WAIVER-CRIT-01, R1-D-192). The
// lists come from a scan of every image in infra/compose/docker-compose.yml, TEST_IMAGES and the
// images built here, on 19 Nov 2026 (a `libjvm.so` in the image's files; the version from
// `java -version`). jvm-mitigation.test.mjs fails when an image is added that is in neither list,
// so a new image is scanned before it ships.

/** The flag the owner named: the HotSpot Base64 intrinsic off on every host, whatever the CPU. */
export const JVM_MITIGATION = "-XX:-UseBASE64Intrinsics";

/** Image repository → the JVM, and the variable its JVMs read the flag from. */
export const JVM_IMAGES = {
  // kc.sh appends JAVA_OPTS_APPEND after every other JVM option.
  "keycloak/keycloak": { variable: "JAVA_OPTS_APPEND", jvm: "Red Hat OpenJDK 21.0.13 (UBI 9.8)" },
  // pdftk is `exec java -jar` from Gotenberg's Go process; the child inherits the variable, and the
  // JVM reads it itself (also when LibreOffice embeds one).
  "gotenberg/gotenberg": {
    variable: "JAVA_TOOL_OPTIONS",
    jvm: "OpenJDK 21.0.12.1 (/opt/java, pdftk)",
  },
  // OpenSearch's launcher ignores JAVA_TOOL_OPTIONS and puts OPENSEARCH_JAVA_OPTS after jvm.options.
  "opensearchproject/opensearch": {
    variable: "OPENSEARCH_JAVA_OPTS",
    jvm: "bundled OpenJDK 25.0.4",
  },
  // Test-only (TEST_IMAGES); its services start JVMs as child processes.
  "localstack/localstack": {
    variable: "JAVA_TOOL_OPTIONS",
    jvm: "OpenJDK 21.0.9 (/usr/lib/localstack/java/21)",
  },
  // Test-only (TEST_IMAGES, PR-FBX-52; scanned 20 Nov 2026): the launcher /opt/verapdf/verapdf
  // runs `exec java $JAVA_OPTS ...` with no JVM option after it that names the flag.
  "verapdf/cli": {
    variable: "JAVA_OPTS",
    jvm: "Eclipse Temurin OpenJDK 11.0.32.1 (/opt/java/openjdk)",
  },
};

/** Image repositories scanned on 19 Nov 2026 with no JVM in them. */
export const NO_JVM_IMAGES = [
  "atmoz/sftp", // FILE_TRANSFER test server (PR-UDF-071; scanned 21 Nov 2026)
  "axllent/mailpit",
  "cerbos/cerbos",
  "clamav/clamav",
  "edoburu/pgbouncer",
  "ghcr.io/zitadel/zitadel",
  "grafana/otel-lgtm",
  "livekit/livekit-server",
  "motoserver/moto",
  "ollama/ollama",
  "openbao/openbao",
  "openfga/openfga",
  "otel/opentelemetry-collector-contrib",
  "pgvector/pgvector",
  "postgres",
  "redis",
  "temporalio/temporal",
  "temporalio/ui",
  "unleashorg/unleash-server",
  "valkey/valkey",
  // The runtime base of every image built here (next, node, tally-agent, the local MinIO).
  "node",
];

/** `repo[:tag][@digest]` → `repo`. */
export function repository(ref) {
  const noDigest = ref.split("@")[0];
  const slash = noDigest.lastIndexOf("/");
  const colon = noDigest.lastIndexOf(":");
  return colon > slash ? noDigest.slice(0, colon) : noDigest;
}
