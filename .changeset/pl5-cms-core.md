---
"@infrabyx/cms": minor
---

The CMS core (PL5 session 4, IPB-04 §04.3.1).

- **Migration and content:** migration `cms/0001_init.sql` (`infrabyx-migrate` applies it after `brand`). Content items have immutable revisions and the named publish state machine, with maker-checker and legal review.
- **Lint:** the Claims Register and the publish lint (`claims/words.json`), plus the allow-list sanitiser (`@infrabyx/cms/sanitise`).
- **Routing and SEO:** slugs, redirects with loop and chain detection, and a CSV dry run. SEO, JSON-LD, the sitemap, robots.txt, `llms.txt` and RSS builders.
- **Preview and publishing:** preview links. The scheduler, `CmsScheduler.tick()`, runs every minute. The public reader and the read-only `/api/public/v1` handler.
- **Media and footer:** the media library, which strips EXIF and serves uploads as uploaded. The footer validator with `infrabyx-cms validate-footer`, and `brandFooterHook` for Brand Studio.
- **Purge:** soft-deleted content, redirects and media are deleted 90 days after deletion by `CmsPurge.sweep()`, run daily (OWNER-QUESTIONS #48).
