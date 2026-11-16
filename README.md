# Make Markdown rendering faster — round 13 blind rewrite

A dependency-free, from-scratch CommonMark 0.31.2 + GFM renderer that returns
exactly the HTML marked 18.1.3 renders with its default options, written to be
faster than marked itself.

- `parse.js` — the renderer. `parse(markdown)` returns the HTML string.
  Single pass over blocks, then inline parsing per leaf block with a
  delimiter-stack emphasis algorithm. No dependencies, no caching across
  calls, no network, no clock reads.
- `main.ts` — the harness driver: reads `/input/cases.json`, renders every
  case with `parse`, writes `/output/html.json`.

## Design notes

Block parsing works on raw lines with visual-column indentation (tabs advance
to the next multiple of four), so indented and fenced code keep their literal
tabs while structure sees expanded columns. Link reference definitions are
collected during the block pass and resolve document-wide, as marked does.

Inline parsing scans each leaf once: code spans, links and images, autolinks,
raw HTML, entities and backslash escapes are recognised inline, and emphasis
(including GFM strikethrough) is resolved afterwards with the standard
delimiter-stack algorithm, including the odd-match rule for underscores.

Plain-text runs take a fast path: a leaf with no special characters is
escaped and emitted without any token work.

## Verification

Grade locally with the kit CLI:

```
node cli/makefun.mjs grade-local --kit . --bot <repo> --driver process
```

Practice set: 720 cases (680 CommonMark + GFM spec examples, 40 generated
READMEs). Target: 720/720, zero differential-fuzz mismatches against marked,
and a median speedup of at least 1.2x.
