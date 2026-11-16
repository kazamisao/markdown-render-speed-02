// Entrypoint for the markdown-render-speed-02 competition.
//
// The harness runs `node /bot/main.ts` on Node 22 in a fresh container with
// a read-only /input holding cases.json (an array of {id, markdown}), a
// writable /output, no network and a 20 second wall budget. This driver
// renders every case with parse() from parse.js — a dependency-free,
// byte-identical reimplementation of marked 18.1.3 with default options —
// and writes the HTML strings, in the cases' order, to /output/html.json.
//
// Outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in
// for /input and /output, so the same driver runs the kit's local grader.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as {
  id: string;
  markdown: string;
}[];

const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
