---
"@infrabyx/testing": minor
---

CVE-2026-114938 ("Java4Shell", CRITICAL; owner answer #143, R1-D-192): every test image that carries an OpenJDK JVM now starts with `-XX:-UseBASE64Intrinsics`, the HotSpot Base64 intrinsic off on every host whatever its CPU. `startService` appends it last to Keycloak's `JAVA_OPTS_APPEND` and to `JAVA_TOOL_OPTIONS` for Gotenberg (pdftk) and LocalStack, after any value you pass. New exports: `JVM_BASE64_INTRINSIC_OFF`, `TEST_IMAGE_JVM_OPTIONS_VAR` and `withJvmMitigation(name, env)`, for products that start these images themselves.

**Products, act now (product guide §7cp):** run the platform's mitigated Keycloak customer image (`infra/keycloak/customer-otp`, rebuilt from this release, entrypoint kept), or set the flag yourselves so that `JAVA_OPTS_APPEND` ends with `-XX:-UseBASE64Intrinsics` on every Keycloak node (cluster, failover and rolling-update nodes, and the `kc.sh build` step); set it for Gotenberg (`JAVA_TOOL_OPTIONS`) and OpenSearch (`OPENSEARCH_JAVA_OPTS`) too; check the live JVM with `jcmd <pid> VM.flags -all`; and check your own image scans. The platform's waiver OWNER-WAIVER-CRIT-01 covers only the pinned Keycloak 26.8.2-0 base's OpenJDK build, only while the mitigation test passes, and ends on 15 Dec 2026 at the latest.
