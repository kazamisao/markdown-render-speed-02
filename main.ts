// main.ts — driver for the markdown-render-speed-02 entry (round 11).
//
// Reads the case set (an array of { id, markdown }) from the input
// directory, renders every case with parse() from ./parse.js, and writes
// the HTML strings, in the same order, as one JSON array to html.json in
// the output directory. Inside the grading container the directories are
// /input and /output; locally MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR can
// point elsewhere. Only erasable TypeScript syntax is used, so Node 22
// strips the types natively.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

interface InputCase {
  id: string;
  markdown: string;
}

const inputDir: string = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw: string = readFileSync(join(inputDir, 'cases.json'), 'utf8');
const cases: InputCase[] = JSON.parse(raw) as InputCase[];
const html: string[] = new Array<string>(cases.length);
for (let idx = 0; idx < cases.length; idx++) {
  html[idx] = parse(cases[idx].markdown);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
