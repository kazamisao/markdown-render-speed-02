// main.ts — entrypoint harness for the markdown-render-speed-02 entry.
//
// Reads every case from /input/cases.json (an array of {id, markdown}),
// renders each one on its own with parse() from parse.js, and writes the
// HTML strings, in order, to /output/html.json. When run outside the
// grading container, MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR stand in for
// /input and /output. No network, no clock, no state between cases.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as { id: string; markdown: string }[];

const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) html[i] = parse(cases[i].markdown);

writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
