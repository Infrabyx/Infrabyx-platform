# R1 plan: inbound mail replies on the EMAIL port (LawDocsComply PR-LDC-50, wave 15)

Status: drafted and built 18 Nov 2026 (twentieth session, R1-D-177), from the triage (M98, R1-D-123), the design `docs/phases/R1-inbound-mail-design.md` (R1-D-141) and the threat-model entry written first in wave 14 (§3.123). Packages: `contracts` minor, `connectors` minor, `notify` minor (migration `notify/0007`), `config` minor (three settings), `testing` minor (a fake inbound route and contract cases).

## 1. Scope

A product sends a notification that invites a reply ("reply to add a note to this matter"). The person replies from their mail client. The platform:

- mints, at email delivery, a stored random reply token bound to one `(tenant, threadRef, recipientRef, address)` and sets `Reply-To: reply+<token>@<tenant reply domain>`;
- receives the reply from the EMAIL adapter's inbound route (SES receiving through SNS, with the message inline or in S3), checks the token, the sender and the receiving adapter's authentication verdict, parses the MIME with fixed bounds, strips the quoted history, quarantines and scans every attachment, and records **one accepted reply** with its ledger entry and an outbox event in one transaction;
- drops and counts every other message, never storing or logging its body.

Not in scope: rendering HTML (it is converted to text, never shown), replies to digests (a digest gathers many notifications; no reply address is set on it), forwarding (a reply from another address is dropped), and retention of replies (the product's decision; the platform sets none, as for every other record).

## 2. Interfaces (`contracts` minor)

- `ports/email.ts`:
  - `EmailMessage.replyTo?` (one address, `recipient` class): the reply address of this message, which overrides the brand's `int.email.reply_to`.
  - `InboundAuthResult` = `"pass" | "fail" | "none" | "error"`; `InboundEmail` `{ adapter, vendorMessageId, receivedAt, envelopeFrom, recipients (envelope RCPT TO), auth: { spf, dkimAligned, dmarc }, raw: Uint8Array }`. The verdicts come from the receiving adapter's own signed record, never from headers in the message.
  - `EmailPort.verifyInbound?(rawBody, headers, meta?)`: optional. It verifies the vendor's signature (C-13) as `verifyWebhook` does, then returns the inbound messages. An adapter that has it declares the capability `inbound: "native"`.
  - `INBOUND_MAIL_LIMITS`: 10 MiB, 200 MIME parts, nesting depth 10, headers 64 KiB in all, a line at most 998 octets (RFC 5322 §2.1.1), 20 attachments, reply text 20 000 characters; `INBOUND_MAIL_CHARSETS`, the charset allow-list.
- `ports/notify.ts`: `NotificationRequest.reply?` `{ threadRef }` (1 to 120 printable characters): ask for a reply address on the email deliveries of this notification. `InboundReply` (the accepted reply as `getReply` returns it) and `ReceiveRepliesResult` `{ accepted, duplicate, dropped: Record<InboundDropReason, number> }`. `INBOUND_DROP_REASONS`: `off`, `no_token`, `ambiguous`, `unknown_token`, `expired`, `used_up`, `domain`, `sender`, `auth`, `too_large`, `line_length`, `parse`, `parts`, `depth`, `headers`, `charset`, `attachments`, `empty`.
- `events/pl3-events.ts` and `platform-events.ts`: `NotificationReplyReceived` (`ntf`) with `reply_id`, `thread_ref`, `recipient_ref`, `attachments` (count), `received_at`. The text is never in the event; the product reads it with `getReply`.
- `ids.ts`: prefix `rpl` (reply).

## 3. Adapters (`connectors` minor)

- **SES (reference).** `send` and `sendRaw` unchanged except that `replyTo` replaces the brand's reply-to. `verifyInbound` takes the SNS POST: the SNS signature (C-13, the same `verifySnsMessage`, pinned certificate hosts) and **a separate inbound topic** (`inbound.topicArn`; a delivery-event topic can never carry a reply), the timestamp window, then the SES receipt notification (`notificationType: "Received"`). The message is taken from `content` (SNS action, at most 150 KB per the SES SNS action reference) or read from S3 (S3 action) — only from the configured inbound bucket, and capped at 10 MiB. Verdicts: SES `PASS`, `FAIL`, `GRAY`, `PROCESSING_FAILED` map to `pass`, `fail`, `none`, `error` (SES "Contents of notifications for Amazon SES email receiving", read 18 Nov 2026: DKIM `GRAY` covers "not DKIM-signed or the from domain and DKIM-signature domain do not match", so a DKIM `PASS` is aligned; DMARC `GRAY` is "the sending domain does not have a DMARC policy or uses the p=none policy"). SES receiving is offered in ap-south-1 (SES endpoints reference, read 18 Nov 2026); the SNS topic must be in the receiving region. A notification with `action.type` other than SNS or S3 is refused.
- **Brevo.** `send` sets `replyTo`. Brevo's inbound parsing webhook carries no payload signature and no receiving-side authentication verdict in its documented payload (developers.brevo.com inbound parsing, searched 18 Nov 2026; `[VERIFY]`), so it cannot meet §4 rule 3: `verifyInbound` is not offered, and the exit runbook records the inbound alternative as pending (owner question).
- Exit runbook: EMAIL inbound `ses`, alternative pending.

## 4. Reply service (`notify` minor, `src/reply.ts`)

**Minting (inside `deliver`, email channel only).** When the notification carries `reply_thread_ref`, `ntf.reply.enabled` is on and `ntf.reply.domain` is set for the tenant: 20 random bytes (C-06), base32 lower case (32 characters); the row `notify.reply_token` holds only its SHA-256 (`token_hash`), the thread, the recipient reference, the address hash (C-23, the consent key, as the suppression list), the delivery id, `expires_at` (`ntf.reply.token_days`, 1 to 90, default 30) and `max_uses` 50. The message carries `replyTo: reply+<token>@<domain>` (local part 38 characters, under RFC 5321's 64). A failed mint fails the delivery closed (`reply_unavailable`), never sends without the reply address it promised. Digests never mint.

**Receiving (`NotifyService.receiveReplies(messages)`).** The product's inbound route calls the adapter's `verifyInbound`, which throws on an unverified POST (the product answers 401/400 as for delivery webhooks), and passes the messages on, as it does for delivery events (`routeEmailEvents`). Each verified message, in order, is dropped at the first rule it fails (an already accepted message is answered as a duplicate before it is parsed):

1. **Token.** Exactly one envelope recipient of the form `reply+<32 base32>@<domain>` (`no_token`, `ambiguous`). Its hash is resolved to a tenant by the service reader `SVC_NOTIFY_REPLY` (database role `svc_notify_reply`, granted `token_hash, tenant_id` only; ledgered per tenant, as the unsubscribe link's reader is) (`unknown_token`). In that tenant: `ntf.reply.enabled` (`off`), the domain equals the tenant's `ntf.reply.domain` (`domain`), the token is unexpired (`expired`) and under its use limit (`used_up`).
2. **Size and shape**, before and during the parse: at most 10 MiB (`too_large`); no line over 998 octets (`line_length`); every declared charset (parameters and RFC 2047 words) on the allow-list (`charset`); postal-mime 4.2.1 (MIT-0, no dependencies) with `maxPartCount` 200 (`parts`), `maxNestingDepth` 10 (`depth`), `maxHeadersSize` 64 KiB (`headers`), `maxRfc822NestingDepth` 0 and `forceRfc822Attachments` (a forwarded message is an attachment, never parsed inline); any other parse failure is `parse`.
3. **Sender.** Exactly one `From` mailbox, whose address hash equals the token's (`sender`).
4. **Authentication** (from the adapter, never headers): DMARC `pass`; or DMARC `none` (no enforceable policy) with an aligned DKIM `pass` **and** SPF `pass` whose envelope-from domain equals the `From` domain (strict alignment, so no public-suffix list is needed). Anything else is `auth`.
5. **Attachments.** At most 20 (`attachments`). Each is written to the tenant's STORAGE at `tenant/<tenant>/notify/<ULID>.bin` (class `CONFIDENTIAL`), scanned by `FileScanPort`, and kept with its verdict and state (`RELEASED` only on `CLEAN`, `REJECTED` on `INFECTED`, otherwise `QUARANTINED`, IPB-02-44). A part over the tenant's upload limit (`FileScanPort` default 25 MiB) cannot occur inside 10 MiB.
6. **Text.** `text/plain` if present, else the HTML converted to text (scripts and styles dropped, blocks to line breaks, entities decoded; never rendered). Quoted history removed: the `On … wrote:` line (also split over two lines), `-----Original Message-----`, the Outlook `From:`/`Sent:` header block, an underscore rule, `>` lines, and the signature delimiter `-- `. Trimmed to 20 000 characters. An empty reply with no attachment is `empty`.

**Accepting**, in one transaction in the token's tenant (service principal `svc_notify`): the token's use count is incremented under `uses < max_uses` (a race past the limit is `used_up`); the row `notify.reply` (`rpl_` id, token hash, thread, recipient, sender hash, adapter, vendor message id, text, attachments, received at) is inserted with a unique `(tenant_id, adapter, vendor_message_id)` so an SNS redelivery is `duplicate` and consumes nothing; the ledger entry `notify.reply.accept` (thread, token hash prefix, sender hash, attachment digests and states, never the text); the outbox event `NotificationReplyReceived`.

**Drops.** Counted by reason in the result and passed to `replies.onDrop(reason)` (metrics). When the tenant is known (from the token), the first drop of a day per `(sender hash, reason)` is recorded in `notify.reply_drop_daily` with its ledger entry `notify.reply.drop`; later drops that day write nothing, because every kernel mutation must write a ledger entry (IPB-MOD-003). The body is never stored.

**Reading.** `getReply(ctx, id)` returns the reply in the caller's tenant (RLS). A quarantined attachment can be rescanned later through `FileScanPort` by the product; a platform `rescan` for replies is left until a product asks.

## 5. Data model (migration `notify/0007_reply.sql`, expand-only)

- `notify.notification.reply_thread_ref text null` (INTERNAL).
- `notify.reply_token`: `token_hash` (pk, 64 hex), `tenant_id`, `thread_ref`, `recipient_ref`, `address_hash`, `delivery_id`, `expires_at`, `uses`, `max_uses`, `created_at`. Forced RLS by `app.tenant_id`; `select, insert, update (uses)` to `app_rw`; no delete grant.
- `svc_notify_reply`: a service reader role (contracts `SERVICE_READER_ROLES.SVC_NOTIFY_REPLY`) with `select (token_hash, tenant_id)` on `notify.reply_token`; the table's read policy admits a platform-scope read, as `notify.unsubscribe_token`'s does.
- `notify.reply`: `id` (pk), `tenant_id`, `token_hash`, `thread_ref`, `recipient_ref`, `sender_hash`, `adapter`, `vendor_message_id`, `text` (CONFIDENTIAL), `attachments` jsonb (CONFIDENTIAL), `received_at`, `created_at`; unique `(tenant_id, adapter, vendor_message_id)`. Forced RLS; `select, insert` to `app_rw`, `select` to `app_ro`; an immutability trigger (no update).
- `notify.reply_drop_daily`: `(tenant_id, day, sender_hash, reason)` pk, `first_at`. Forced RLS; `select, insert` to `app_rw`.
- Every column carries its data class. Products map `notify.reply` and `notify.reply_token` in their export maps (product guide).

## 6. Settings (`config` minor)

| Key                    | Tier   | Type   | Default | Change    | mc  |
| ---------------------- | ------ | ------ | ------- | --------- | --- |
| `ntf.reply.enabled`    | TENANT | bool   | false   | ORG_ADMIN | R4  |
| `ntf.reply.domain`     | TENANT | string | ""      | ORG_ADMIN | R4  |
| `ntf.reply.token_days` | TENANT | int    | 30      | ORG_ADMIN | no  |

The design named them `notify.reply.*`; the registry's NOTIFY namespace is `ntf.` (`ntf.org.routing`), so they follow it.

## 7. Tests (by ID)

- `contracts`: the new schemas (reply ref, `replyTo`, limits) and the event data.
- `connectors` unit (`email/__tests__/ses-inbound.test.ts`): SNS signature checked with a test certificate; a delivery-event topic refused; outside the window refused; content inline (UTF-8 and Base64) and from S3 (stub), another bucket refused, over 10 MiB refused; verdict mapping; a forged `Authentication-Results` header in the message changes nothing. `brevo` and `ses` set `replyTo`.
- `notify` unit (`reply-text.test.ts`): quoted-history fixtures for Gmail, Outlook, Apple Mail and Thunderbird; HTML-only replies; the charset and line scans.
- `notify` integration (`reply.int.test.ts`, PostgreSQL): minting at delivery (address hash, expiry, only the hash stored, digests never mint, off and no domain mean no reply address); every drop reason of §4; the forged header; a MIME bomb (parts, depth, headers); an unknown charset; EICAR attachment kept `QUARANTINED`/`REJECTED`; one ledger entry and one outbox event per accepted reply; an SNS redelivery is `duplicate`; RLS across two tenants; the immutability trigger; the use limit under a race.
- `testing`: `FakeEmail` records `replyTo` and offers a fake inbound route; `defineEmailInboundContract` run against `FakeEmail` and the SES adapter.

## 8. Threat model

§3.123 becomes the as-built entry; the header is updated.

## 9. Exit gate

`pnpm check:full` green locally (integration suites and Docker contract legs included), one `ci:run`, then the version PR (minors, #81(a)).

## 10. Owner decisions needed

None blocking. Assumptions `[ASSUMED – owner review]`, each reversible before a product relies on it (OWNER-QUESTIONS #135): (1) the Brevo inbound route is not offered, because its documented payload has neither a signature nor a receiving-side DMARC verdict, so the inbound alternative is pending; (2) with no enforceable DMARC policy at the sender's domain, both an aligned DKIM pass and a strictly aligned SPF pass are needed (a stricter reading of the design's "aligned SPF and DKIM"); (3) settings in the `ntf.` namespace; (4) a delivery whose reply token cannot be minted fails closed rather than going out without it.
