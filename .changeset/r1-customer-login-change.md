---
"@infrabyx/contracts": minor
"@infrabyx/connectors": minor
---

Changing and retiring a customer's login (Udofin PR-UDF-034; R1-D-51). `CustomerIdentityPort` gains optional `startLoginChange`, `confirmLoginChange` and `retireLogin`. `KeycloakCustomerIdentity` and `ZitadelCustomerIdentity` implement them: a change needs one code to each login, from the same device key, and keeps the account's id, devices and subject; retiring forgets the devices, disables the account and frees the login for a new account. Zitadel accounts are now found by username, so a changed or recycled login maps to the right account. `CustomerAuthStore.recordAccountEvent` (optional) ledgers both events by the account's hash; `PgCustomerAuthStore` implements it.
