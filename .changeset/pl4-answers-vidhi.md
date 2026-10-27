---
"@infrabyx/vidhi": minor
---

Owner answers #37 and #40 (PL4-D-13).

- New CLI `infrabyx-vidhi manifest-lint <dir or file>...`: add it to product CI over the skill manifests. It fails on a tool without an explicit `locked: true` or `locked: false`, and notes a `false` that the kernel locked list overrides (word matching stays the safety net). `lintManifest` is exported too.
- `QaSampler` reads the governed, tighten-only settings `vidhi.qa.min_reviews`, `vidhi.qa.precision_floor` and `vidhi.qa.recall_floor` per tenant, never below the platform floor of 20 reviews and 0.8 (`QaSampler.floor(ctx)`). **Breaking:** the `floor` constructor option and `QA_DEFAULT_FLOOR` are removed; use `QA_PLATFORM_FLOOR`.
