---
"@infrabyx/cms": minor
---

`BLOCK_EDITOR` (the block forms `BLOCK_EDITOR_SPECS` and `RICH_TEXT_CODEC`) gives the Studio block editor (PR-038, R1-D-02) a form for every block type of the library, and a rich text codec: `textToPortableText` reads paragraphs, `##` headings, `-` and `1.` lists, `>` quotations, `**bold**`, `_italic_`, `` `code` ``, `[links](/path)` and media-library images into portable text and runs the sanitiser over the result; `portableTextToText` writes portable text back the same way, escaping anything that would read as markup. Each new block starts from a template that is valid once its reference (a media, form, testimonial or plan id) is filled. No schema, migration or setting changes.
