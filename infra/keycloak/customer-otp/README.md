# Keycloak customer one-time-code extension (`ipb-customer-otp`)

The authenticator behind customer sign-in on Keycloak (OWNER-QUESTIONS #84 (b); R1-D-19, threat model §3.53). It runs in a customer realm's direct-grant flow, after `direct-grant-validate-username`, and only for confidential clients with the attribute `ipb.customer.otp=true`. `KeycloakCustomerIdentity.applyCustomerRealm` in `@infrabyx/connectors/identity` creates the flow, the client and the step's settings.

| Step                                                                | Answer                                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ipb_otp_step=send`                                                 | `202` with `ipb_otp_challenge`, `ipb_otp_code` and `expires_in`; Keycloak keeps only a SHA-256 of `<challenge>:<code>`     |
| `ipb_otp_step=verify`, `ipb_otp_challenge`, `ipb_otp_code`, `DPoP:` | tokens bound to the proof's key (`cnf.jkt`), or `401 invalid_grant`; `attempts` tries per code, then the challenge is dead |

The platform delivers the code through NOTIFY and enforces the per-account limits before it calls either step. Step settings: `ttl` (60 to 900 s) and `attempts` (1 to 10), from the `int.identity.customer.otp.*` settings.

The image also carries the bundled breached-password list (PR-LDC-04, R1-D-83) at `/opt/keycloak/data/password-blacklists/ipb-common-passwords.txt`. A realm applied with `passwordBlacklist: KEYCLOAK_PASSWORD_BLACKLIST` in its `KeycloakRealmSpec` gets Keycloak's `passwordBlacklist` policy over it, beside the IPB length, username, email and history rules, and refuses any password on the list; nothing is called at runtime. Keycloak refuses a realm naming a list it does not hold, so set the option only on this image (or a Keycloak with the file mounted at that path). Source, licence and checksums: `password-blacklists/README.md`.

Build: `docker build -t <you>/keycloak-customer:26.8.2-0 infra/keycloak/customer-otp`. The extension compiles against the jars of the pinned Keycloak image itself, so nothing is downloaded and the SPI cannot drift; rebuild whenever the pin moves. Keycloak warns at start that the authenticator SPI is internal; the IDENTITY contract leg proves the step on every pin.

## JVM mitigation for CVE-2026-114938 (until a fixed Keycloak image is pinned)

CVE-2026-114938 ("Java4Shell") is memory corruption in HotSpot's Base64 intrinsic on x86-64 CPUs with AVX-512 VBMI, in unpatched OpenJDK 17.0.6 and later (21 and 25 included). Keycloak decodes Base64 from requests before authentication, so the pinned base's OpenJDK (`java-21-openjdk-headless` 1:21.0.13.0.9-1.2.el9, no fixed build yet) is reachable. The owner's decision (#143; waiver OWNER-WAIVER-CRIT-01, R1-D-192): turn the intrinsic off on every node, whatever its CPU.

- The image's entrypoint is `/opt/keycloak/bin/ipb-kc.sh`, which appends `-XX:-UseBASE64Intrinsics` last to `JAVA_OPTS_APPEND` and then runs `kc.sh` with the same arguments, so every start (`start`, `start --optimized`, `start-dev`), every cluster node, failover node and rolling-update replacement carries it, and a deployment's own `JAVA_OPTS` or `JAVA_OPTS_APPEND` cannot drop it (HotSpot takes the last value of a repeated flag). `ENV JAVA_OPTS_APPEND` holds it too, for a deployment that calls `kc.sh` itself.
- A node refuses to start (exit 64) if `_JAVA_OPTIONS`, `JDK_JAVA_OPTIONS` or `JAVA_TOOL_OPTIONS` names `UseBASE64Intrinsics`: those are read outside `kc.sh`, and `_JAVA_OPTIONS` would win over the command line.
- **Do not override the entrypoint.** If your deployment must (some operators do), set `JAVA_OPTS_APPEND` to end with `-XX:-UseBASE64Intrinsics` yourself and check the running JVM: `jcmd <pid> VM.flags -all | grep UseBASE64Intrinsics` must show `false {command line}`.
- The image build fails unless the JVM resolves the flag to `false` from the command line (`ipb-kc.sh --ipb-verify-jvm`), and the `containers` job reads it from the live JVM (`infra/docker/jvm-mitigation.e2e.test.mjs`). The CRITICAL waiver in `infra/docker/trivyignore.yaml` is valid only while those pass, covers only that OpenJDK build, and ends on the day a fixed Keycloak image is moved to, 15 Dec 2026 at the latest.
