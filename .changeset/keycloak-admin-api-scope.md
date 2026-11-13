---
"@infrabyx/connectors": patch
---

Keycloak 26.8.2: `applyRealm` (workforce and customer realms) makes the built-in `kc-admin-api` client scope a default scope of the admin service account's client, so its token passes the Admin REST API's new audience check; a realm on an earlier version is unchanged (`grantAdminApiScope`).
