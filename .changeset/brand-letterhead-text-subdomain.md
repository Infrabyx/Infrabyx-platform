---
"@infrabyx/brand": minor
---

The tenant brand layer gains letterhead header and footer text (plain text, at most 2,000 characters each, no markup or running links), a PDF cover asset checked like the letterhead, and a subdomain label served as `<label>.<the pack's app host>` (reserved and `xn--` labels refused, unique group-wide, verified with the app host); `AppliedBrand` returns `letterheadText`, `cover` and `subdomain` (PR-LDC-43).
