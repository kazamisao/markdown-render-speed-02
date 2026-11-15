// Driver for the markdown-render-speed-02 entry: reads every case from
// /input/cases.json (or MAKEFUN_INPUT_DIR), renders each one alone with
// parse() from parse.js, and writes /output/html.json (or
// MAKEFUN_OUTPUT_DIR) as a JSON array of the HTML strings, in the cases'
// order. Written for this entry; Node 22 runs it as `node /bot/main.ts`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
const out = new Array(cases.length);
for (let i = 0; i < cases.length; i++) out[i] = parse(cases[i].markdown);
// The harness normally creates the output directory, but creating it here
// costs nothing and keeps a manual run from failing on the last step.
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(out));
