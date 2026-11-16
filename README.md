# markdown-render-speed-02 — entry

A fast, dependency-free Markdown renderer whose `parse(markdown)` returns
exactly the HTML that marked 18.1.3 renders with its default options
(GFM on, breaks off, pedantic off).

## Layout

- `parse.js` — the renderer. A block pass splits the document into blocks
  (headings, lists, blockquotes, tables, fenced and indented code, HTML
  blocks, link definitions, paragraphs), an inline pass renders the text
  inside each block (emphasis, links, code spans, autolinks, …), and a
  small renderer joins the pieces. No dependencies, no I/O, no clock, no
  state kept between calls, so two runs over the same input are
  byte-identical.
- `main.ts` — the harness entrypoint: reads `/input/cases.json`, renders
  each case with `parse`, writes `/output/html.json`.

## Notes on fidelity

Where marked departs from the CommonMark or GFM spec, marked wins — the
reference is marked's output, never the spec text. The trickiest part is
list continuation: a following line belongs to the current item, starts a
nested list, or ends the list depending on the item's content indent and
on the indented-block factories, whose indent argument is mapped through
`max(0, min(3, n - 1))`. That mapping is what makes `- foo` followed by
`  - bar` nest with item text `foo\n- bar`.

## License

MIT — see `LICENSE`.
