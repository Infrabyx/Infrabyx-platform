---
"@infrabyx/contracts": minor
---

`@infrabyx/contracts/aadhaar` (Udofin PR-UDF-063, R1-D-242), additive; the default reading is unchanged and stays strict.

- `findAadhaarLike(text, { allow })` and `holdsAadhaarLike`: an opt-in list of look-alikes to let through, `AADHAAR_LOOK_ALIKES` = `e164_in` (`+91` and ten digits, ungrouped, the `+` starting a token; `91dddddddddd` without the `+` is still a find) and `decimal` (an ungrouped run with a `.` right before or after it and a digit beyond the `.`). Default none: every look-alike is still a find. An unknown name throws `TypeError`. Letting one through is the product's choice and its risk: an Aadhaar number written that way is then missed.
- `AADHAAR_FIELD_NAMES`, `isAadhaarFieldName(name)` (any case and separators: `aadhaar_number`, `aadhaarNumber`, `uid_token`, `uid`, ...; not `aadhaar_last_digits` or `uid_kind`), `holdsAadhaarFieldValue(value)` and `findAadhaarNamedFields(json)`: fields named like an Aadhaar carrier that hold a value, by key path, never the value. Also on the package root.
