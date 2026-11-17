# Inbound mail on the EMAIL port: design (LawDocsComply PR-LDC-50; wave 14 design, wave 15 build)

**Status:** design for review (R1-D-141). Threat model entry: §3.123. No code until wave 15.

## 1. What a product gets

A product sends a notification that invites a reply, for example "reply to add a note to this matter". The person replies from their mail client. The product receives **one event per accepted reply**:

`{ threadRef, recipientRef, text, attachments[], receivedAt }`

- `text` is the reply's own text with the quoted history removed.
- `attachments` are STORAGE references, each with its scan verdict.
- Every other message is dropped and counted, never delivered.

## 2. The reply address: an opaque, stored token (no new cryptography)

- **On send.** `notify` mints a reply token for one `(tenant, threadRef, recipientRef)`: 20 random bytes (C-06), shown in base32 (32 characters). It sets `Reply-To: reply+<token>@<tenant's reply domain>`, which fits the 64-character local part.
- **What is stored.** Only the token's SHA-256 (as for every other platform secret at rest), with the thread, the recipient's address hash (C-23), an expiry and a use count. The table is `notify.reply_token`, tenant-scoped under forced RLS.
- **Expiry.** 30 days by default (`notify.reply.token_days`, 1 to 90), and at most 50 accepted replies a token.
- **Why stored rather than signed.** A signed (HMAC or JWS) address would need a new use of a key, which is a cryptography item on the stop list. A stored random token gives the same binding and can be revoked; it costs one indexed lookup per inbound message.

## 3. Accepting a reply

The receiving adapter (SES inbound, or another EMAIL adapter's inbound route) hands the platform the raw message and its authentication results. The message is accepted only when all of these hold:

1. **Token.** The recipient local part carries a token whose hash is found, unexpired and under its use limit, in the tenant the domain maps to.
2. **Recipient.** The `From` address's hash equals the token's recipient hash. A forwarded reply from another address is dropped.
3. **Sender authentication.** The adapter's verdict shows DMARC `pass` with alignment for the `From` domain. With no DMARC policy at the sender's domain, the message passes only with aligned SPF and DKIM passes. Anything else is dropped. The adapter's verdict is trusted only from the adapter itself (SES receipt fields), never from headers in the message.
4. **Size and shape.**
   - At most 10 MB and 200 MIME parts, nested at most 10 deep.
   - Headers at most 64 KB; a line at most 998 octets.
   - Only `text/plain`, `text/html` (converted to text, never rendered) and attachments.
   - Character sets are decoded with a fixed allow-list; anything else is dropped.
5. **Attachments.** Each goes to STORAGE quarantine and through `FileScanPort`. Only `CLEAN` is released (PR-LDC-41). At most 20 attachments and the tenant's upload size limits.

The reply text is then stripped of quoted history (the `On … wrote:` line, `>` blocks, common client separators and signature delimiters), trimmed to 20,000 characters, and delivered as the event. Ledger: one entry per accepted reply (thread, token hash prefix, sender hash, attachment digests). A dropped message is counted by reason, and its sender hash is ledgered once a day, never the body.

## 4. Settings and adapters

- `notify.reply.enabled` (TENANT, off), `notify.reply.domain` (the tenant's reply subdomain; MX setup is the tenant's, as for brand hosts), `notify.reply.token_days`.
- SES inbound is the reference adapter. It is configured through the tenant's existing SES account and needs nothing new from the owner. Brevo inbound parse is the alternative.

## 5. Tests (wave 15)

- **Token:** a missing, unknown, expired or over-used token is dropped.
- **Sender:** another sender, a DMARC fail, a forged `Authentication-Results` header and a mismatched tenant domain are dropped.
- **Bounds:** a MIME bomb (part count, depth, size), a header flood and an unknown charset are dropped.
- **Attachments:** an EICAR attachment stays quarantined.
- **Text:** quoted-history fixtures from the main mail clients are stripped, and HTML-only replies are converted.
- **Ledger:** one entry per accepted reply.
