---
"@infrabyx/connectors": patch
---

PL6 session 4c: `KeycloakIdentity` writes a display name Keycloak's person-name validator accepts (its prohibited characters removed) as the first name and keeps the display name whole in the `display_name` attribute, so a persona such as "Tenant auditor (RO)" provisions; `getUser` prefers that attribute. A 4xx from the admin API now names the field and validation message in the port error's detail.
