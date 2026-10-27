#!/usr/bin/env bash
# First start of the local PostgreSQL (IPB-01-33): the platform database and one database and role
# each for Keycloak and Unleash, with the generated local passwords from infra/compose/.env.local.
# The platform's own roles (app_rw, app_migrate, app_ro, svc_*) come from `infrabyx-migrate`.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" \
  -v kc_pw="$KEYCLOAK_DB_PASSWORD" -v un_pw="$UNLEASH_DB_PASSWORD" <<'SQL'
CREATE DATABASE infrabyx;
CREATE ROLE keycloak LOGIN PASSWORD :'kc_pw';
CREATE DATABASE keycloak OWNER keycloak;
CREATE ROLE unleash LOGIN PASSWORD :'un_pw';
CREATE DATABASE unleash OWNER unleash;
SQL
