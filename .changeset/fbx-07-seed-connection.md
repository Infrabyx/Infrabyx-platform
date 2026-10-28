---
"@infrabyx/seed": patch
---

`infrabyx-seed` passes `DB_PASSWORD` inside the connection URL (percent-encoded), so `DB_URL` without a password works as documented; before, pg let the URL's empty password win and the connection failed (PR-FBX-07). A refusal without `APP_PRODUCT` names the product from the scaffolded root `package.json` (`infrabyx.product`), else `unknown`, never `LD`.
