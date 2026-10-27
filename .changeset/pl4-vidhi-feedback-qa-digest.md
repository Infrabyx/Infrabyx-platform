---
"@infrabyx/vidhi": minor
---

Feedback, QA sampling, the daily digest and AI disclosure (PL4 session 8a, PL4-D-11): migration `vidhi/0004_feedback_qa_digest.sql`; `Feedback` with sealed corrections and the tenant reference set; `QaSampler` with deterministic sampling, owner reviews, precision and recall and demotion below the floor; `Digest` with the daily digest and the action log; `disclosure` and `Vidhi.disclose` for the AI label and the `ai_provenance` sidecar. The promotion evidence window is now compared in SQL, so rows written in a demotion's own transaction no longer count in the new window.
