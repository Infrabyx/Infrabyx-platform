---
"@infrabyx/testing": minor
---

IDENTITY contract cases for identity-provider brokers, `identityBrokerContractCases(fixtures)` (create and update in place without a secret in any answer; a literal secret, a plain string for the reference, a bad alias or URL refused; another tenant can neither take over nor remove a broker; discovery by verified domain to enabled brokers only, one broker per domain; linking only: an unknown user signing in through a broker is refused and an existing account of the broker's tenant is linked, through the `brokerSignIn` fixture; a session of another tenant's account through the broker refused, where the leg provides `brokeredSession`; SAML when the leg serves metadata; removal frees the domain), and `FakeIdentityBrokers` with `FAKE_BROKER_SIGN_IN`, a fake that passes them (PR-LDC-09; R1-D-78).
