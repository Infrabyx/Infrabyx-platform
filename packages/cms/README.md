# @infrabyx/cms

The headless CMS core (IPB-04 §04.3.1). It provides:

- content items with immutable revisions;
- the named publish state machine with maker-checker and legal review;
- the Claims Register and its lint;
- the allow-list sanitiser;
- slugs and redirects;
- SEO, JSON-LD and the generated files;
- preview links, the scheduler and the public read API;
- the footer validator and the media library;
- the 90-day purge of soft-deleted content.

**Specified by:** `docs/ipb/` IPB-04 (§04.3.1, §04.3.8, §04.4.1, §04.4.3). Its acceptance tests are the `@IPB-04-AT-..` scenarios tagged in `src`.

**Status:** PL5 sessions 4 and 5a. The package stays private until the PL5 gate (`docs/phases/PL5-plan.md` §5.3–§5.7). Session 5b adds resources, forms and pricing.

## Data

Migration `cms/0001_init.sql` creates:

- `cms.content_item`, one row per item. Its id prefix comes from the type (`pg_`, `nav_`, `ftr_`, `ofc_`, `lgl_` …). It carries the current, approved, scheduled and published revision, and its served path.
- `cms.revision` (`rev_`). An update trigger refuses any change.
- `cms.approval` (`cap_`): maker, checker and legal reviewer. Each is set once, and they are always three different people.
- `cms.redirect` (`rdr_`): 301, 302 and 410. Manual and imported redirects stay pending until a checker and the legal reviewer approve them.
- `cms.media` (`med_`): metadata, alt text or a decorative reason, and the sanitiser report.
- `cms.claim` (`clm_`): the Claims Register. Evidence classes run from E0 to E4. Only a legal reviewer activates a claim.
- `cms.preview_token` (`prv_`): stores only the SHA-256 of the token. A token lives at most 24 hours.
- The module outbox and inbox.

All rows are platform rows. Any context reads them; only a platform context writes them, through the kernel with an audit ledger entry. PostgreSQL refuses every delete except the purge of rows soft-deleted more than 90 days ago (OWNER-QUESTIONS #48).

## Flow

```
draft ──submit──▶ in_review ──approve(checker≠maker)──▶ approved ──schedule──▶ scheduled ──tick──▶ published
draft ──submit (legal type or lint flag)──▶ legal_review ──legalApprove──▶ in_review
in_review / legal_review ──requestChanges(reason)──▶ draft;  published ──unpublish──▶ archived (410 or 301)
any edit ──▶ draft (voids the approval; the published revision keeps serving)
```

- `CmsStudio.submit` runs the publish lint and refuses with the finding's code:
  - `IPB-CMS-010`: a figure without an E1 claim. The failure is also ledgered and emitted as `ClaimsLintFailed`.
  - `IPB-CMS-012`: banned or category wording, from `claims/words.json`.
  - `IPB-TRUST-006`: a certification claim without a trust document.
  - `IPB-CMS-014`: a logo, testimonial or photo without permission.
  - `IPB-CMS-007`: an image without alt text.
  - `IPB-CMS-015`: a dark pattern.
  - `IPB-CMS-003`: an empty template slot.
  - `IPB-CMS-011`: an unreviewed machine translation.
- `approve` refuses the maker (`IPB-CMS-004`). Both `approve` and `publishNow` refuse while the legal sign-off is missing (`IPB-CMS-005`).
- Agents may only save drafts and submit (`IPB-SEC-004`). In the platform CMS they cannot open a platform context at all (IPB-02-11).
- A slug change adds a 301 from the old path and repoints earlier redirects, so no chain forms. Loops and chains are refused (`IPB-CMS-009`).
- `CmsScheduler.tick()` runs once a minute. It publishes only the approved revision and ledgers every skip.
- `CmsPurge.sweep()` runs daily. It deletes content, redirects and media soft-deleted more than 90 days ago, with one ledger entry per sweep.
- `PublicContent` serves published revisions only. Its `resolve` returns content (falling back to en-IN with the right `lang`), a redirect, or a 410. `handlePublicApi` is the GET-only `/api/public/v1` API.
- The sanitiser is available as `@infrabyx/cms/sanitise` (`htmlToPortableText`, `sanitisePortableText`, `toHtml`). SEO and the generated files come from `organizationLd`, `sitemapIndex`, `sitemapFor`, `robotsTxt`, `llmsTxt`, `llmsFullTxt` and `rssFeed`.
- The footer: `validateFooter`, `footerInputFrom`, and `brandFooterHook` for Brand Studio's publish precondition. The `infrabyx-cms validate-footer <file.json>` CLI checks it in CI.

## Policies (IPB-05)

Migration `cms/0002_policies.sql` adds `cms.policy_set` (`pol_`), one per brand pack with its parameters, and `cms.policy_instance` (`pin_`), one row per version of a template.

```
draft ──submit (lint)──▶ submitted ──[dpoApprove]──▶ approve ──▶ approved ──tick at effective_at──▶ effective ──▶ superseded
```

- **Templates.** `policies/<key>/1.0.md` holds the 17 IPB-05 skeletons: numbered clause headings, parameters and `[COUNSEL]` markers. The legal reviewer enters the reviewed wording.
- **Roles.** `PolicyStudio` takes a PLT_LEGAL_REVIEWER as maker and a PLT_SUPER_ADMIN as checker. Privacy-class templates also need a PLT_DPO (`IPB-POL-006`). None of them may be the maker.
- **Lint.** Submit and approve run the lint:
  - `IPB-POL-001`: unresolved parameters and counsel markers;
  - `-002`: missing sections;
  - `-003`: banned wording;
  - `-004`: stale citations, checked through LAW_REGISTER;
  - `-005`: the notice period for MAJOR changes to Terms and Payment Terms;
  - `-007`: Hindi.
- **Versions.** An approved version never changes (`IPB-POL-008`).
- **Completeness.** `policySetHook()` is Brand Studio's `policySetPublished` hook (`IPB-POL-009`).
- **Scheduling and review.** Run `PolicyStudio.tick()` with the CMS scheduler. `reviewQueue` and `emitReviewDue` follow the 6- and 12-month cadence.
- **Publishing.** `PublicPolicies` serves the current version, the prior versions with a superseded banner, and `/legal/index.json`.
