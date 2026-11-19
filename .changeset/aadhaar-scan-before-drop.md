---
"@infrabyx/contracts": minor
"@infrabyx/testing": minor
"@infrabyx/ai": minor
"@infrabyx/connectors": patch
---

One no-Aadhaar rule, its scanner and a test-database sweep (Udofin PR-UDF-042; R1-D-195). `contracts` adds the subpath `@infrabyx/contracts/aadhaar`: `findAadhaarLike(text, { letters? })` returns `{ kind: "AADHAAR" | "VID", start, end, masked }` for each 12-digit Aadhaar number (first digit 2 to 9, Verhoeff) and 16-digit VID (Verhoeff), plain or grouped in fours, bounded by a non-digit (a letter or `+` is a boundary; `letters: "join"` makes a letter part of the run), masked to the last four digits; also `holdsAadhaarLike` and `AADHAAR_LIKE_KINDS`. `verhoeffValid` moves there and is re-exported unchanged from the root and `./search-refusal`. `testing` adds `startPostgres({ beforeDrop(admin) })` (run by `end()` before the drop; a throwing hook still drops the database, then `end()` rejects with its error), the `infrabyx-aadhaar-scan` bin (exit 1 on a find, 0 on none, 2 on a usage error; masked output only), and `scanTextForAadhaar`, `scanPathsForAadhaar` and `scanDatabaseForAadhaar` (also as `@infrabyx/testing/aadhaar-scan`). `ai`'s scrubber uses the shared rule for its AADHAAR detector: a 16-digit VID is now tokenised as `AADHAAR`, and twelve digits right after a `+` are no longer missed; `verhoeffValid` keeps its behaviour. `connectors`' e-KYC check (`holdsAadhaarNumber`) uses the shared rule with `letters: "join"` and now also refuses a grouped number.
