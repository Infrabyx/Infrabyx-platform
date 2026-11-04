---
"@infrabyx/connectors": minor
---

Keycloak breached-password check without a third-party call (PR-LDC-04; R1-D-83): `KeycloakRealmSpec.passwordBlacklist` adds Keycloak's `passwordBlacklist(<file>)` policy to the IPB floor (`length(12) and notUsername and notEmail and passwordHistory(5)`), and `KEYCLOAK_PASSWORD_BLACKLIST` (`ipb-common-passwords.txt`) names the list the Keycloak customer image (`infra/keycloak/customer-otp`) now carries: the 10,000 most common passwords of 12 or more characters from SecLists (MIT). `keycloakPasswordPolicy(file?)` returns the policy string and refuses a name that is not a plain file name. Off unless the realm names a list, because Keycloak refuses a realm whose list it does not hold; set `passwordBlacklist: KEYCLOAK_PASSWORD_BLACKLIST` on realms served by the customer image.
