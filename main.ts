// Driver for the markdown-render-speed-02 entry.
//
// Takes the case set from the input directory (cases.json: an array of
// { id, markdown }), renders each case's markdown with parse() from
// ./parse.js, and writes the HTML strings, in the same order, as a JSON
// array to html.json in the output directory. Inside the grading
// container those directories are /input and /output; locally the
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR environment variables can
// point them elsewhere. Only erasable TypeScript syntax is used, so
// Node 22 can strip the types natively.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

type Case = { id: string; markdown: string };

const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inDir, 'cases.json'), 'utf8')) as Case[];
const out: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) out[i] = parse(cases[i].markdown);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'html.json'), JSON.stringify(out));
