---
"@infrabyx/connectors": minor
---

ESIGN adapters (new subpath `@infrabyx/connectors/esign`): `leegality` (interim reference; the
webhook `mac` checked with C-25) and `digio` (alternative; callbacks carry the C-19 URL token).
Both read the PDF by reference with its SHA-256 checked, refuse any method they cannot provide as
asked (no downgrade), return only the status read back from the vendor after a webhook, write the
signed PDF to STORAGE, and stay `unproven` until their sandbox legs (#55, #56). `ESIGN` joins the
port-contract matrix.
