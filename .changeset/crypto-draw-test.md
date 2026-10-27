---
"@infrabyx/crypto": patch
---

Test the seed-password character draw directly: the rejection-sampled draw takes an injectable byte source, and the χ² uniformity test (bound unchanged) runs on seeded draws instead of finished passwords, whose rule-based regeneration skews digits slightly (PL1-C-08).
