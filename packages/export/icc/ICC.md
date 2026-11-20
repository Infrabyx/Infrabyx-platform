# ICC profile embedded by `toPdf` in PDF/A mode

`toPdf(doc, { pdfa: "2b" })` writes a PDF/A output intent (`/S /GTS_PDFA1`, `/OutputConditionIdentifier (sRGB IEC61966-2.1)`) whose destination profile is this sRGB profile, embedded once per file (PR-FBX-52, R1-D-248). Plain `toPdf` output does not use it. No profile is fetched at run time.

| File                | Description | Version and class        | Size      | SHA-256                                                            |
| ------------------- | ----------- | ------------------------ | --------- | ------------------------------------------------------------------ |
| `sRGB-v2-magic.icc` | `sRGB`      | ICC v2.1, display (mntr) | 736 bytes | `af4efe28f6d311799865f325ba39184a2e978b113ca74124d60af7de22b105f4` |

**Source.** Compact ICC Profiles by Clinton Ingram, `https://github.com/saucecontrol/Compact-ICC-Profiles`, file `profiles/sRGB-v2-magic.icc`, last changed in commit `abb1b6f48570b4eb0fabd8566e517dca07e617d4` (20 Aug 2019, "switch to 182-point sRGB curve"); repository head `bdd84663061bc4ae95ca70decff54f581e27f702` (6 Jun 2023) when copied on 20 Nov 2026. Copied byte for byte.

**Licence.** CC0 1.0 Universal (public-domain dedication; `LICENSE-CC0.txt`, the repository's `license` file): no attribution or notice is required, and redistribution inside the package is allowed.

**Why this profile.** sRGB IEC 61966-2.1 primaries and white point with a 182-point tone curve that the author tuned to match the standard sRGB curve closely (better than the 1024-point curves of the large profiles for 8-bit values), in an ICC v2 profile that every PDF/A-2 reader and validator accepts. The document's content uses only the default grey of text and rules, so the profile only declares the intended output condition. veraPDF 1.30.3 accepts it (`packages/export/src/__tests__/pdfa.int.test.ts`).
