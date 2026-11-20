---
"@infrabyx/testing": minor
---

`TEST_IMAGES.verapdf`: the veraPDF CLI 1.30.3 image pinned by digest (pushed 27 Oct 2026), for PDF/A and PDF/UA validation in integration suites (PR-FBX-52, R1-D-248). It carries a JVM, so `withJvmMitigation("verapdf")` sets the CVE-2026-114938 flag on `JAVA_OPTS` (R1-D-192).
