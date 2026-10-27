# @infrabyx/trust

The vendor-assurance mirror, the tenant Vendor Assurance Room, the public Trust Centre data, `security.txt` and the acknowledgement purge.

**Specified by:** IPB-08 (Vendor Assurance Room and Trust Centre), Ecosystem §6.34; PL5 plan §7.2; decision PL5-D-10.

## Install

Run `infrabyx-migrate` (migration `trust/0001_init.sql`; it creates the `svc_trust_sweep` reader role). Settings read: `trust.gating.nda_version`, `trust.tenant.view_roles`, `trust.mirror.stale_minutes`, `trust.request.ack_hours`, `trust.request.fulfil_days`, `trust.retention.years`.

## Use

```ts
const mirror = new TrustMirror({ kernel, audit, product: "FBX", trust, outbox });
await mirror.onPublished({ eventId, data }); // in.infrabyx.trust.VendorAssuranceDocumentPublished.v1
await mirror.onStateChanged({ eventId, data }); // …StateChanged.v1
await mirror.reconcile(); // daily (IPB-08-29)

const room = new TrustRoom({
  kernel,
  audit,
  product: "FBX",
  mirror,
  trust,
  support,
  outbox,
  settings,
});
await room.list(ctx); // Settings › Security & trust › Vendor documents
await room.acceptNda(ownerCtx);
await room.download(ctx, vadId, { purpose });
await room.request(ctx, { description, regulatorDeadline });

const centre = await trustCentre(mirror, { planned, claims, links }); // /trust
const txt = securityTxt({ contacts, canonical, policy }); // /.well-known/security.txt
```

## Rules

- **Operations Hub is the system of record.** Only the mirror consumer (`svc_trust_mirror`) can write `trust.mirror_*`, and PostgreSQL enforces it. Nothing here creates or edits a `vad_`.
- **Gated downloads:** a login- or NDA-gated document must be watermarked. Until a DOCGEN watermark adapter exists, such a download answers `IPB-TRUST-012`, and no unwatermarked gated original is ever served (OWNER-QUESTIONS #44).
- **Not built yet:** evidence packs and auditor grants (#44).
- **Trust Centre:** it lists only certifications actually held. Lapsed claims show their fallback wording, and planned items need a quarter and never carry a badge. Audit reports and gated files are never linked.
- **Purge:** acknowledgements are deleted 10 years after the document version ended, never under legal hold (OWNER-QUESTIONS #48).
