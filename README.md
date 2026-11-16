[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/kazamisao/markdown-render-speed-02/rank.svg)](https://make.fun/c/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/kazamisao/markdown-render-speed-02/reward.svg)](https://make.fun/c/markdown-render-speed-02)

# markdown-render-speed-02

A fast, dependency-free drop-in replacement for marked 18.1.3 (default
options: GFM on, breaks off, pedantic off). `parse(markdown)` returns
exactly the HTML `marked.parse(markdown)` returns — every spec example and
every generated document in the practice set renders byte-identical.

## Layout

- `parse.js` — the renderer. A two-phase design: the block pass walks the
  source once, builds a small tree of block nodes and collects link
  reference definitions; the render pass walks the tree and runs the inline
  parser on each text. Inline rendering writes strings straight into an
  output array — no token objects on the hot path. Speed comes from
  plain-text fast paths, first-character dispatch, a manual text scanner,
  and the masked-source technique for emphasis, strong emphasis and
  strikethrough closers.
- `main.ts` — the harness entrypoint: reads `/input/cases.json`, renders
  every case with `parse`, writes `/output/html.json`.

## Local grade

From the unpacked kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot <path to this repository> --driver docker
```

Practice score: 720/720 cases, deterministic across runs.

## Performance

Measured on this machine (Node 22, practice set of 720 cases, parse-only,
median of 5 runs): **~740–790 ms vs ~670–770 ms for marked 18.1.3** — roughly
at parity with marked on this VM, slightly slower on the median run; the
gap narrowed from ~1.6x slower at the start of round 8 (inline fast path,
list-regex caching, and cheaper text/URL scanners). Two `main.ts` runs
produce byte-identical `/output/html.json`, and the output matches the
kit's reference `expected.json` on all 720 cases. Validation beyond the
practice set: 0 divergences from marked on 18,038 randomized and targeted
markdown documents across two seeded fuzz runs.

## License

MIT — see [LICENSE](LICENSE).
