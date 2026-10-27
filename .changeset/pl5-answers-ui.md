---
"@infrabyx/ui": minor
---

Owner answer #52 (PL5-D-05): the accent is a fill only. `buildTheme` keeps a light accent as set (it moves it only when text on it cannot meet the floor), and `DECLARED_PAIRS` no longer contains accent/surface. Components never use `--color-accent` for text, borders, outlines or icon strokes; a unit test enforces it.
