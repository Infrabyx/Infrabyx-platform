# syntax=docker/dockerfile:1.7
# Keycloak with the Infrabyx customer one-time-code step (`ipb-customer-otp`; OWNER-QUESTIONS #84,
# R1-D-19). The extension is compiled against the jars of the very Keycloak image it ships in, so
# nothing is downloaded at build time and the SPI version cannot drift. Build from this folder:
#   docker build -t infrabyx/keycloak-customer:26.8.1-1 infra/keycloak/customer-otp
# The image runs as Keycloak's own non-root user. Products set their database and hostname options
# at `start` as for the stock image (`--db=postgres` is built in).

FROM keycloak/keycloak:26.8.1-1@sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b AS keycloak

FROM eclipse-temurin:21.0.12_8-jdk-noble@sha256:4d271cd5e0624598cf563342f47281b09cb364bc13acbbd7251f49f83470018d AS compile
WORKDIR /build
COPY --from=keycloak /opt/keycloak/lib/lib/main/ /keycloak-lib/
COPY src/ src/
RUN mkdir classes \
    && find src -name '*.java' > sources.txt \
    && javac --release 21 -Xlint:all -Werror -cp "/keycloak-lib/*" -d classes @sources.txt \
    && cp -r src/META-INF classes/ \
    && jar --create --file ipb-customer-otp.jar --date 2026-10-29T00:00:00Z -C classes .

FROM keycloak
COPY --from=compile --chown=1000:0 /build/ipb-customer-otp.jar /opt/keycloak/providers/ipb-customer-otp.jar
RUN /opt/keycloak/bin/kc.sh build --db=postgres --health-enabled=true
USER 1000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/bin/bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/9000 && printf 'GET /health/ready HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q '\"UP\"' <&3"]
