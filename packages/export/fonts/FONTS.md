# Fonts embedded by `toPdf`

Noto Sans (Regular, Bold, Italic, Bold Italic), © 2022 The Noto Project Authors, under the SIL Open Font License 1.1 (`OFL.txt`). Subset once for the platform's PDF writer (OWNER-QUESTIONS #117, R1-D-96); no font is fetched at run time.

| File                             | Upstream file (unhinted TTF) | Upstream SHA-256                                                   | Subset SHA-256                                                     |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `NotoSans-Regular.subset.ttf`    | `NotoSans-Regular.ttf`       | `f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8` | `e613e1ed885616d109765e5abf853888e525a92580466096bba94c39290fd9b2` |
| `NotoSans-Bold.subset.ttf`       | `NotoSans-Bold.ttf`          | `87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9` | `d85e5f833e8db48124d7e84fc77e4d32722aa62821dd5d26d5fb72315407542d` |
| `NotoSans-Italic.subset.ttf`     | `NotoSans-Italic.ttf`        | `678288f868807d4d64a6f3b51466871d117d915780381ce9d0ed4b3bcbd06d37` | `67abd0e133087532a997ca08453afd8256b6757090d8fca0e85f33267fe3c9ac` |
| `NotoSans-BoldItalic.subset.ttf` | `NotoSans-BoldItalic.ttf`    | `3d367743f371f28671d2764e911a53d7c20ec9b6aa8791d059e7090389fc52a5` | `10352e91b18d741a17122425a76e40b39376c613c3150cb0297551f7569ce9be` |

**Source.** `https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts/NotoSans/unhinted/ttf/<file>` at commit `ac9cdcd317b3c34c7578f609189c963c7eeff3c5` (5 Nov 2026); `OFL.txt` from `notofonts/latin-greek-cyrillic`.

**Subset.** fontTools 4.55.3 `pyftsubset <file> --unicodes="U+0020-007E,U+00A0-017F,U+0192,U+02C6,U+02DC,U+2013,U+2014,U+2018-201A,U+201C-201E,U+2020-2022,U+2026,U+2030,U+2039,U+203A,U+20AC,U+20B9,U+2122,U+2212" --no-hinting --layout-features='' --drop-tables+=GSUB,GPOS,GDEF,DSIG,STAT,MVAR,HVAR,fvar,gvar --name-IDs='*' --name-legacy --name-languages='*' --notdef-outline`: Basic Latin, Latin-1, Latin Extended-A, the WinAnsi punctuation, the euro and the **rupee sign (U+20B9)**, and the minus sign. No layout tables, so no shaping: Indic scripts go through DOCGEN (guide §7ay).
