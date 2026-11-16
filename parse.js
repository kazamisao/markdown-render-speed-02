// parse.js — a fast, dependency-free Markdown renderer whose parse() returns
// exactly the HTML marked 18.1.3 renders with its default options
// (GFM on, breaks off, pedantic off, async off).
//
// Written from scratch against the CommonMark 0.31.2 + GFM 0.29 semantics as
// marked implements them: a block pass splits the document into blocks, an
// inline pass renders the text inside each block, and a small renderer joins
// the pieces. Where marked departs from the spec, marked wins.
//
// Determinism notes: no clock, no network, no I/O, no cross-call state.
// Every call to parse() depends only on its argument.

// ---------------------------------------------------------------- utilities

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escChar = (ch) => ESC_MAP[ch];

// Escape &, <, >, ", ' (encode=true) or only <, >, ", ' plus a bare & that
// is not already part of an entity (encode=false).
const ESC_TEST = /[&<>"']/;
const ESC_REPLACE = /[&<>"']/g;
const ESC_NOENC_TEST = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const ESC_NOENC_REPLACE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
function escHtml(s, encode) {
  if (encode) return ESC_TEST.test(s) ? s.replace(ESC_REPLACE, escChar) : s;
  return ESC_NOENC_TEST.test(s) ? s.replace(ESC_NOENC_REPLACE, escChar) : s;
}

const NUM_REF = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const NUM_REF_OR_AMP = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
// Decode numeric character references; a bare & becomes &amp;.
function decodeRefs(s) {
  if (!NUM_REF.test(s)) return s;
  return s.replace(NUM_REF_OR_AMP, (whole, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const cp = hex === undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '\uFFFD';
    if (cp === 38) return '&amp;';
    return String.fromCodePoint(cp);
  });
}

// Count code points without allocating: one per UTF-16 unit, except a
// high surrogate followed by a low surrogate counts once.
function cpCount(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) i++;
    }
    n++;
  }
  return n;
}

// Sanitize a link destination the way marked does: encodeURI, then restore %.
const PCT25 = /%25/g;
function cleanHref(href) {
  try { return encodeURI(href).replace(PCT25, '%'); } catch { return null; }
}

// Split one table row on unescaped pipes, honouring the header cell count.
const FIND_PIPE = /\|/g;
const SPLIT_PIPE = / \|/;
const SLASH_PIPE = /\\\|/g;
function splitTableRow(row, cellCount) {
  const marked2 = row.replace(FIND_PIPE, (ch, off, whole) => {
    let escaped = false, p = off;
    while (--p >= 0 && whole[p] === '\\') escaped = !escaped;
    return escaped ? '|' : ' |';
  });
  const cells = marked2.split(SPLIT_PIPE);
  let i = 0;
  if (cells[0].trim() || cells.shift(), cells.length > 0 && !cells.at(-1)?.trim()) cells.pop();
  if (cellCount) {
    if (cells.length > cellCount) cells.splice(cellCount);
    else while (cells.length < cellCount) cells.push('');
  }
  for (; i < cells.length; i++) cells[i] = cells[i].trim().replace(SLASH_PIPE, '|');
  return cells;
}

// Normalize a link label for lookup: trim, collapse whitespace, fold case
// through upper+lower so the result is locale independent.
const WS_RUN = /\s+/g;
function normLabel(label) {
  return label.trim().replace(WS_RUN, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Find the index of the close paren matching the open paren at depth 0,
// skipping backslash escapes. -1: none; -2: more opens than closes.
function closeParen(text, pair) {
  if (text.indexOf(pair[0]) === -1 && text.indexOf(pair[1]) === -1) return -1;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === pair[0]) depth++;
    else if (text[i] === pair[1] && (--depth < 0)) return i;
  }
  return depth > 0 ? -2 : -1;
}

// Strip trailing characters: with only=true strip trailing chars equal to
// ch; with only=false strip trailing chars different from ch.
function trimEndChars(s, ch, only) {
  const n = s.length;
  if (n === 0) return '';
  let cut = 0;
  for (; cut < n;) {
    const c = s.charAt(n - cut - 1);
    if (c === ch && !only) cut++;
    else if (c !== ch && only) cut++;
    else break;
  }
  return s.slice(0, n - cut);
}

// Drop trailing blank lines, keeping at most one blank line at the end:
// if the last non-blank line is within two lines of the end, keep as-is.
const BLANK_LINE = /^[ \t]*$/;
function dropBlankTail(s) {
  const lines = s.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && BLANK_LINE.test(lines[last])) last--;
  return lines.length - last <= 2 ? s : lines.slice(0, last + 1).join('\n');
}

// Expand tabs to spaces, tracking the column starting at `col`.
function expandTabs(s, col = 0) {
  let out = '', pos = col;
  for (const ch of s) {
    if (ch === '\t') { const w = 4 - (pos % 4); out += ' '.repeat(w); pos += w; }
    else { out += ch; pos++; }
  }
  return out;
}

// Fenced code: remove from every line at most as many leading spaces as the
// opening fence line was indented by.
const FENCE_INDENT = /^(\s+)(?:```)/;
const LEADING_WS = /^\s+/;
function fenceDedent(raw, body) {
  const m = raw.match(FENCE_INDENT);
  if (m === null) return body;
  const indent = m[1];
  return body.split('\n').map((line) => {
    const w = line.match(LEADING_WS);
    if (w === null) return line;
    const [spaces] = w;
    return line.slice(Math.min(spaces.length, indent.length));
  }).join('\n');
}

// ------------------------------------------------------------- regex tables

// Small builder: take a pattern (string or RegExp), replace each §name§ slot
// with the given fragment, and return a fresh RegExp. Slots use § delimiters
// so a fragment's own text can never collide with a slot name.
function rx(pattern, flags, slots) {
  let src = typeof pattern === 'string' ? pattern : pattern.source;
  if (slots) {
    for (const [name, frag] of Object.entries(slots)) {
      // A fragment that is itself a regex loses a leading ^ when spliced
      // into the middle of another pattern: the anchor is redundant there
      // (the splice point is already fixed by the surrounding pattern).
      let repl = typeof frag === 'string' ? frag : frag.source;
      if (typeof frag !== 'string' && repl.startsWith('^')) repl = repl.slice(1);
      src = src.split('§' + name + '§').join(repl);
    }
  }
  return new RegExp(src, flags);
}

// Factory with a 4-slot cache keyed by an indent argument n, mapped through
// max(0, min(3, n - 1)). This is load-bearing: a list item whose content
// starts 2 columns in only allows a following bullet with at most 1 space,
// which is what makes "- foo\n  - bar" nest instead of staying flat.
function cachedRegex(build) {
  const cache = [];
  return (n) => {
    const slot = Math.max(0, Math.min(3, n - 1));
    return cache[slot] || (cache[slot] = build(slot));
  };
}

const BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

const O = {
  codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
  outputLinkReplace: /\\([\[\]])/g,
  indentCodeCompensation: /^(\s+)(?:```)/,
  beginningSpace: /^\s+/,
  endingHash: /#$/,
  startingSpaceChar: /^ /,
  endingSpaceChar: / $/,
  endingSpaceTabChar: /[ \t]$/,
  nonSpaceChar: /[^ ]/,
  newLineCharGlobal: /\n/g,
  tabCharGlobal: /\t/g,
  leadingSpaceTab: /^[ \t]+/,
  multipleSpaceGlobal: /\s+/g,
  blankLine: /^[ \t]*$/,
  doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
  blockquoteStart: /^ {0,3}>/,
  blockquoteSetextReplace: /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g,
  blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
  blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm,
  listIsTask: /^\[[ xX]\][ \t]+\S/,
  listReplaceTask: /^\[[ xX]\][ \t]+/,
  listTaskCheckbox: /\[[ xX]\]/,
  anyLine: /\n.*\n/,
  hrefBrackets: /^<(.*)>$/,
  tableDelimiter: /[:|]/,
  tableAlignChars: /^\||\| *$/g,
  tableRowBlankLine: /\n[ \t]*$/,
  tableAlignRight: /^ *-+: *$/,
  tableAlignCenter: /^ *:-+: *$/,
  tableAlignLeft: /^ *:-+ *$/,
  startATag: /^<a /i,
  endATag: /^<\/a>/i,
  startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
  endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
  startAngleBracket: /^</,
  endAngleBracket: />$/,
  unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
  notSpaceStart: /^\S*/,
  endingNewline: /\n$/,
  listItemRegex: (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\n]*)?(?:\n|$))`),
  nextBulletRegex: cachedRegex((n) => new RegExp(`^ {0,${n}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\n]*)?(?:\n|$))`)),
  hrRegex: cachedRegex((n) => new RegExp(`^ {0,${n}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\n+|$)`)),
  fencesBeginRegex: cachedRegex((n) => new RegExp(`^ {0,${n}}(?:\`\`\`|~~~)`)),
  headingBeginRegex: cachedRegex((n) => new RegExp(`^ {0,${n}}#{1,6}(?:\\s|$)`)),
  htmlBeginRegex: cachedRegex((n) => new RegExp(`^ {0,${n}}(?:</?(?:${BLOCK_TAGS})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i')),
  blockquoteBeginRegex: cachedRegex((n) => new RegExp(`^ {0,${n}}>`)),
  // One test for every condition that ends a list item's continuation: a
  // fence, heading, HTML block, blockquote, new bullet or thematic break
  // at the item's indent. The union of the six patterns above (the `i`
  // flag changes none of the other branches); a pure OR, so branch order
  // cannot change the result.
  listBreakRegex: cachedRegex((n) => new RegExp(`^ {0,${n}}(?:(?:\`\`\`|~~~)|#{1,6}(?:\\s|$)|</?(?:${BLOCK_TAGS})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[|>|(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))|(?:(?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$))`, 'i')),
};

// Shared fragments. HR_CAP keeps its capture group (table / paragraph /
// blockquote-paragraph lookaheads); HR_NC is the non-capturing twin the
// setext-heading pattern uses, so group numbering stays put.
const HR_CAP = ' {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\n+|$)';
const HR_NC = ' {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\n+|$)';
const HEADING_FRAG = ' {0,3}#{1,6}(?:\\s|$)';
const BLOCKQUOTE_FRAG = ' {0,3}>';
const FENCES_FRAG = ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)';
const HTML_FRAG = ' {0,3}(?:<\\/?(?:' + BLOCK_TAGS + ')(?: +|\\n|\\/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)';
const BULLET_SRC = ' {0,3}(?:[*+-]|\\d{1,9}[.)])';

const HTML_COMMENT = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const HTML_ATTR = / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/;

// Label fragment shared by links and reference definitions.
const BRACKETS = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const LABEL_INNER = rx(/(?:\[(?:§brackets§|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/, '', { brackets: BRACKETS });
const REF_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const TITLE = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\)/;
const LINK_TITLE = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/;

const B = {
  newline: /^(?:[ \t]*(?:\n|$))+/,
  code: /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,
  fences: /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/,
  hr: /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,
  heading: /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,
  list: rx(/^(§bull§)([ \t][^\n]*?)?(?:\n|$)/, '', { bull: BULLET_SRC }),
  html: rx(/^ {0,3}(?:<(script|pre|style|textarea)[\s>][\s\S]*?(?:<\/\1>[^\n]*\n*|$)|§comment§[^\n]*(\n+|$)|<\?[\s\S]*?(?:\?>[^\n]*\n*|$)|<![A-Z][\s\S]*?(?:>[^\n]*\n*|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>[^\n]*\n*|$)|<\/?(§tag§)(?:[ \t]+|\n|\/?>|$)[\s\S]*?(?:(?:\n[ \t]*)+\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:§attribute§)*? *\/?>(?=[ \t]*(?:\n|$))[\s\S]*?(?:(?:\n[ \t]*)+\n|$)|<\/[a-z][a-z0-9-]*\s*>(?=[ \t]*(?:\n|$))[\s\S]*?(?:(?:\n[ \t]*)+\n|$))/, 'i', { comment: HTML_COMMENT, tag: BLOCK_TAGS, attribute: HTML_ATTR }),
  def: rx(/^ {0,3}\[(§label§)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(§title§))? *(?:\n+|$)/, '', { label: REF_LABEL, title: '(?:' + TITLE.source + ')' }),
  table: null,
  lheading: null,
  paragraph: null,
  text: /^[^\n]+/,
  blockquote: null,
};

// Table: header line, delimiter line, then body rows that stop at a blank
// line or a line starting another block.
B.table = rx(/^ *([^\n ].*)\n {0,3}((?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?)(?:\n((?:(?! *\n|§hr§|§heading§|§blockquote§|§code§|§fences§|§list§|§html§).*(?:\n|$))*)\n*|$)/, '', {
  hr: HR_CAP, heading: HEADING_FRAG, blockquote: BLOCKQUOTE_FRAG,
  code: '(?: {4}| {0,3}\t)[^\\n]', fences: FENCES_FRAG,
  list: ' {0,3}(?:[*+-]|1[.)])[ \\t]', html: HTML_FRAG,
});

// Setext heading: one or more text lines, then a === or --- line.
B.lheading = rx(/^(?!§bull§ |§blockCode§|§fences§|§blockquote§|§heading§|§html§|§table§)((?:.|\n(?!\s*?\n|§bull§ |§fences§|§blockquote§|§heading§|§hr§|§html§|§table§))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/, '', {
  bull: BULLET_SRC, blockCode: '(?: {4}| {0,3}\t)', fences: ' {0,3}(?:`{3,}|~{3,})',
  blockquote: BLOCKQUOTE_FRAG, heading: HEADING_FRAG, hr: HR_NC,
  html: ' {0,3}<[^\\n>]+>\\n', table: ' {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n',
});

// Paragraph (top level): text lines that stop before any block start.
const PARA_BASE = /^([^\n]+(?:\n(?!§hr§|§heading§§lheading§|§blockquote§|§fences§|§list§|§html§|§table§|[ \t]+\n)[^\n]+)*)/;
B.paragraph = rx(PARA_BASE, '', {
  hr: HR_CAP, heading: HEADING_FRAG, lheading: '', blockquote: BLOCKQUOTE_FRAG,
  fences: FENCES_FRAG, list: ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]',
  html: HTML_FRAG, table: B.table,
});

// Blockquote paragraph: same shape, but a list item may follow a space or
// end of line, and there is no table alternative in its lookahead.
const PARA_BQ = rx(/^([^\n]+(?:\n(?!§hr§|§heading§§lheading§|§blockquote§|§fences§|§list§|§html§|[ \t]+\n)[^\n]+)*)/, '', {
  hr: HR_CAP, heading: HEADING_FRAG, lheading: '', blockquote: BLOCKQUOTE_FRAG,
  fences: FENCES_FRAG, list: ' {0,3}(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|\\n|$)',
  html: HTML_FRAG,
});
B.blockquote = rx(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(§paragraph§)|[^\n]*)(?:\n|$))+/, '', { paragraph: PARA_BQ });

// ---------------------------------------------------------------- inline rules

const PUNCT = /[\p{P}\p{S}]/u;
const PUNCT_SPACE = /[\s\p{P}\p{S}]/u;
const NOT_PUNCT_SPACE = /[^\s\p{P}\p{S}]/u;
const NOT_TILDE_PUNCT = /(?!~)[\p{P}\p{S}]/u;
const NOT_TILDE_PUNCT_SPACE = /(?!~)[\s\p{P}\p{S}]/u;
const NOT_PUNCT_SPACE_OR_TILDE = /(?:[^\s\p{P}\p{S}]|~)/u;

const INLINE_COMMENT = /<!--(?:-?>|[\s\S]*?-->)/;
const INLINE_ATTR = /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/;

// Link / reference label pieces (Lt / be in marked's terms).
const LABEL_LONG = rx(/(?:[^\[\]\\`]*(?:\[(?:§brackets§|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/, '', { brackets: BRACKETS });
const REF_SHORT = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;

const I = {
  escape: /^\\([!"#$%&'()*+,\-.\/:;<=>?@\[\]\\^_`{|}~])/,
  tag: rx(/^§comment§|^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:§attribute§)*?\s*\/?>|^<\?[\s\S]*?\?>|^<![a-zA-Z]+\s[\s\S]*?>|^<!\[CDATA\[[\s\S]*?\]\]>/, '', { comment: INLINE_COMMENT, attribute: INLINE_ATTR }),
  link: rx(/^!?\[(§label§)\]\([ \t\n]*(§href§)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(§title§))?[ \t\n]*\)/, '', {
    label: LABEL_INNER,
    href: /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/,
    title: LINK_TITLE,
  }),
  reflink: rx(/^!?\[(§label§)\]\[(§ref§)\]/, '', { label: LABEL_INNER, ref: REF_LABEL }),
  nolink: rx(/^!?\[(§ref§)\](?:\[\])?/, '', { ref: REF_LABEL }),
  emStrongLDelim: /^(?:\*+(?:((?!\*)(?!~)[\p{P}\p{S}])|([^\s*]))?)|^_+(?:((?!_)(?!~)[\p{P}\p{S}])|([^\s_]))?/u,
  emStrongRDelimAst: rx("^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)§punct§(\\*+)(?=[\\s]|$)|§notPunctSpace§(\\*+)(?!\\*)(?=§punctSpace§|$)|(?!\\*)§punctSpace§(\\*+)(?=§notPunctSpace§)|[\\s](\\*+)(?!\\*)(?=§punct§)|(?!\\*)§punct§(\\*+)(?!\\*)(?=§punct§)|§notPunctSpace§(\\*+)(?=§notPunctSpace§)", 'gu', {
    punct: NOT_TILDE_PUNCT, notPunctSpace: NOT_PUNCT_SPACE_OR_TILDE, punctSpace: NOT_TILDE_PUNCT_SPACE,
  }),
  emStrongRDelimUnd: rx("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)§punct§(_+)(?=[\\s]|$)|§notPunctSpace§(_+)(?!_)(?=§punctSpace§|$)|(?!_)§punctSpace§(_+)(?=§notPunctSpace§)|[\\s](_+)(?!_)(?=§punct§)|(?!_)§punct§(_+)(?!_)(?=§punct§)", 'gu', {
    punct: PUNCT, notPunctSpace: NOT_PUNCT_SPACE, punctSpace: PUNCT_SPACE,
  }),
  code: /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,
  br: /^( {2,}|\\)\n(?!\s*$)[ \t]*/,
  del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,
  delLDelim: /^~~?(?:((?!~)[\p{P}\p{S}])|[^\s~])/u,
  delRDelim: rx("^[^~]+(?=[^~])|(?!~)§punct§(~~?)(?=[\\s]|$)|§notPunctSpace§(~~?)(?!~)(?=§punctSpace§|$)|(?!~)§punctSpace§(~~?)(?=§notPunctSpace§)|[\\s](~~?)(?!~)(?=§punct§)|(?!~)§punct§(~~?)(?!~)(?=§punct§)|§notPunctSpace§(~~?)(?=§notPunctSpace§)", 'gu', {
    punct: PUNCT, notPunctSpace: NOT_PUNCT_SPACE, punctSpace: PUNCT_SPACE,
  }),
  autolink: rx(/^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_]))>/, '', {}),
  url: rx(/^§emailProtocol§|^((?:§protocol§):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^§email§/, '', {
    emailProtocol: '(?:mailto:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])|xmpp:[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\\w-])(?:\\/[A-Za-z0-9@.]+)?)',
    protocol: /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,
    email: /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/,
  }),
  _backpedal: /(?:[^?!.,:;*_'\"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'\"~)]+(?!$))+/,
  text: rx(/^(?:[^a-zA-Z0-9](?=§emailProtocol§)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|§protocol§:\/\/|§wwwStart§|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=§emailProtocol§)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{|}~-]+@))))/, '', {
    protocol: /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,
    emailProtocol: '(?:mailto|xmpp):',
    wwwStart: '(?<![^\\s*_~(])www\\.',
  }),
  punctuation: /^((?![*_])[\s\p{P}\p{S}])/u,
  anyPunctuation: /\\([\p{P}\p{S}])/gu,
  anyPunctuationOutsideCode: /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu,
  blockSkip: rx(/§link§|§precode§§code§|§html§/, 'g', {
    link: /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/,
    precode: '(?<!`)()',
    code: /(?<b>`+)[^`]+\k<b>(?!`)/,
    html: /<(?! )[^<>]*?>/,
  }),
  reflinkSearch: rx(/§reflink§|§nolink§(?!\()/, 'g', {
    reflink: rx(/^!?\[(§label§)\]\[(§ref§)\]/, '', { label: LABEL_LONG, ref: REF_SHORT }),
    nolink: rx(/^!?\[(§ref§)\](?:\[\])?/, '', { ref: REF_SHORT }),
  }),
};

// ------------------------------------------------------------- inline lexer

// Scan a string for the last position where an emphasis / strikethrough
// closer could start: the last run of * or _ (or ~) that follows a
// non-blank character. The inline loop uses it to bound its search.
function scanClosers(src) {
  const lastEm = { '*': -1, '_': -1 };
  let lastDel = -1;
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    const prev = i === 0 ? '\n' : src[i - 1];
    let j = i + 1;
    while (j < n && src[j] === ch) j++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (ch === '~') lastDel = i;
      else lastEm[ch] = i;
    }
    i = j - 1;
  }
  return { maskedSrc: src, lastEm, lastDel };
}

// Shared "no closers" sentinel for inline jobs with no emphasis delimiters.
const NO_CLOSERS = { maskedSrc: null, lastEm: { '*': -1, '_': -1 }, lastDel: -1 };

// Mask a source the way the emphasis pass needs it: link-like spans and
// code spans are replaced by filler so emphasis delimiters inside them
// are invisible, and link reference definitions are hidden the same way.
function maskForEmphasis(lx, src) {
  let out = src;
  if (lx.links && src.includes('[')) {
    const re = I.reflinkSearch;
    const hide = (span) => {
      const open = span.lastIndexOf('[');
      if (!Object.hasOwn(lx.links, normLabel(span.slice(open + 1, -1)))) return span;
      if (open > 1 && span.charAt(0) !== '!') {
        const inner = span.slice(1, open - 1);
        if (linkInText(lx, inner)) return '[' + inner.replace(re, hide) + '][' + 'a'.repeat(span.length - open - 2) + ']';
      }
      return '[' + 'a'.repeat(span.length - 2) + ']';
    };
    out = out.replace(re, hide);
  }
  // The punctuation/code replace can only match a backtick or a backslash.
  if (src.includes('`') || src.includes('\\')) {
    out = out.replace(I.anyPunctuationOutsideCode, (whole, fences, punct) => {
      if (punct) return '+'.repeat(whole.length);
      if (fences) return fences + whole.slice(fences.length, -fences.length).replace(/`/g, '+') + fences;
      return whole;
    });
  }
  // The block-skip replace can only match a link, a code span or a tag.
  if (src.includes('[') || src.includes('`') || src.includes('<')) {
    out = out.replace(I.blockSkip, (whole, _a, pre) => {
      const keep = pre ? pre.length : 0;
      return whole.slice(0, keep) + '[' + 'a'.repeat(whole.length - keep - 2) + ']';
    });
  }
  return out;
}

// One lexer instance per parse() call. It owns the link table, the queue of
// inline jobs (lexed only after all blocks are known, so a reference
// defined later in the document still applies), and the small state the
// inline tokenizers share.
function makeLexer() {
  return {
    links: Object.create(null),
    inlineQueue: [],
    state: { inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true, top: true },
    maskStack: [],
  };
}

function queueInline(lx, src, tokens) {
  lx.inlineQueue.push({ src, tokens });
  return tokens;
}

function lastEmCloser(lx, src, delim) {
  const top = lx.maskStack.at(-1);
  if (top && top.maskedSrc === src) return top.lastEm[delim];
  return scanClosers(src).lastEm[delim];
}

function lastDelCloser(lx, src) {
  const top = lx.maskStack.at(-1);
  if (top && top.maskedSrc === src) return top.lastDel;
  return scanClosers(src).lastDel;
}

// Does this text contain a link (inline or reference) that resolves?
function linkInText(lx, src) {
  if (!src.includes('[')) return false;
  for (const m of src.matchAll(I.blockSkip)) {
    if (I.link.test(m[0]) && src.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of src.matchAll(I.reflinkSearch)) {
    const span = m[0];
    const open = span.lastIndexOf('[');
    if (!(span.charAt(0) === '!' || !Object.hasOwn(lx.links, normLabel(span.slice(open + 1, -1)))) &&
        !(open > 1 && linkInText(lx, span.slice(1, open - 1)))) return true;
  }
  return false;
}

// Build a link / image token from a matched span and a resolved target.
function makeLink(lx, match, target, raw, inLinkBefore, linkEmittedBefore, inRawBefore) {
  const href = target.href;
  const title = target.title || null;
  const text = match[1].replace(O.outputLinkReplace, '$1');
  const isImage = match[0].charAt(0) === '!';
  lx.state.inLink = true;
  lx.state.linkEmitted = false;
  const inner = inlineTokens(lx, text);
  const emittedInside = lx.state.linkEmitted;
  lx.state.linkEmitted = linkEmittedBefore;
  lx.state.inLink = inLinkBefore;
  if (!isImage) {
    if (emittedInside) { lx.state.inRawBlock = inRawBefore; return null; }
    lx.state.linkEmitted = true;
  }
  return { type: isImage ? 'image' : 'link', raw, href, title, text, tokens: inner };
}

const inlineTok = {
  escape(src) {
    const m = I.escape.exec(src);
    return m ? { type: 'escape', raw: m[0], text: m[1] } : null;
  },

  tag(lx, src) {
    const m = I.tag.exec(src);
    if (!m) return null;
    if (!lx.state.inLink && O.startATag.test(m[0])) lx.state.inLink = true;
    else if (lx.state.inLink && O.endATag.test(m[0])) lx.state.inLink = false;
    if (!lx.state.inRawBlock && O.startPreScriptTag.test(m[0])) lx.state.inRawBlock = true;
    else if (lx.state.inRawBlock && O.endPreScriptTag.test(m[0])) lx.state.inRawBlock = false;
    return { type: 'html', raw: m[0], inLink: lx.state.inLink, inRawBlock: lx.state.inRawBlock, block: false, text: m[0] };
  },

  link(lx, src) {
    if (lx.state.linkParenPossible === false) return null;
    const m = I.link.exec(src);
    if (!m) return null;
    const bang = m[0].charAt(0) === '!' ? 2 : 1;
    if (hasUnclosedTag(src, m[1], bang)) return null;
    let dest = m[2].trim();
    if (O.startAngleBracket.test(dest)) {
      if (!O.endAngleBracket.test(dest)) return null;
      const stripped = trimEndChars(dest.slice(0, -1), '\\');
      if ((dest.length - stripped.length) % 2 === 0) return null;
    } else {
      const close = closeParen(m[2], '()');
      if (close === -2) return null;
      if (close > -1) {
        const cut = (m[0].indexOf('!') === 0 ? 5 : 4) + m[1].length + close;
        m[2] = m[2].substring(0, close);
        m[0] = m[0].substring(0, cut).trim();
        m[3] = '';
      }
    }
    const strippedRaw = trimEndChars(m[0].slice(0, -1), '\\');
    if ((m[0].length - strippedRaw.length) % 2 === 0) return null;
    let href = m[2];
    let title = m[3] ? m[3].slice(1, -1) : '';
    href = href.trim();
    if (O.startAngleBracket.test(href)) href = href.slice(1, -1);
    return makeLink(lx, m, {
      href: href && href.replace(I.anyPunctuation, '$1'),
      title: title && title.replace(I.anyPunctuation, '$1'),
    }, m[0], lx.state.inLink, lx.state.linkEmitted, lx.state.inRawBlock);
  },

  reflink(lx, src) {
    let m = I.reflink.exec(src) || I.nolink.exec(src);
    if (!m) return null;
    const bang = m[0].charAt(0) === '!' ? 2 : 1;
    if (hasUnclosedTag(src, m[1], bang)) return null;
    const target = lx.links[normLabel(m[2] || m[1])];
    if (!target) {
      const ch = m[0].charAt(0);
      return { type: 'text', raw: ch, text: ch };
    }
    return makeLink(lx, m, target, m[0], lx.state.inLink, lx.state.linkEmitted, lx.state.inRawBlock);
  },

  emStrong(lx, src, masked, prevChar) {
    const m = I.emStrongLDelim.exec(src);
    if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
    const delim = m[0][0];
    const sameAsPrev = prevChar === delim;
    const totalLen = masked.length;
    const srcLen = src.length;
    const startI = totalLen - srcLen;
    let i = startI;
    for (; i > 0 && masked[i - 1] === delim;) i--;
    const beforeRun = (() => {
      if (i <= 0) return '';
      const c = masked.charCodeAt(i - 1);
      if (c >= 0xDC00 && c <= 0xDFFF && i >= 2) {
        const h = masked.charCodeAt(i - 2);
        if (h >= 0xD800 && h <= 0xDBFF) return masked.slice(i - 2, i);
      }
      return masked[i - 1];
    })();
    const beforeIsDelim = beforeRun === '*' || beforeRun === '_' || !!I.punctuation.exec(beforeRun);
    if (i < startI) prevChar = beforeRun;
    const prevIsPunct = i < startI ? beforeIsDelim : !!I.punctuation.exec(prevChar);
    if (m[4] && prevChar.match(O.unicodeAlphaNumeric)) return null;
    const punctAfter = m[1] || m[3] || '';
    if (!punctAfter || !prevChar || prevIsPunct) {
      const runLen = cpCount(m[0]) - 1;
      let g, run;
      let open = runLen;
      let extra = 0;
      const charsBefore = startI - i + runLen;
      const canIntraword = !!beforeRun.trim() && (!!punctAfter || (delim === '*' && !beforeIsDelim));
      if (delim !== '*' && delim !== '_') return null;
      const closerRe = delim === '*' ? I.emStrongRDelimAst : I.emStrongRDelimUnd;
      const last = lastEmCloser(lx, masked, delim);
      const limit = totalLen - srcLen + runLen;
      if (last < limit) return null;
      const rest = masked.slice(-1 * src.length + runLen);
      const stopAt = last - limit;
      let cm;
      for (closerRe.lastIndex = 0; (cm = closerRe.exec(rest)) !== null && !(cm.index > stopAt);) {
        g = cm[1] || cm[2] || cm[3] || cm[4] || cm[5] || cm[6];
        if (!g) continue;
        run = g.length;
        if (cm[3] || cm[4]) { open += run; continue; }
        if (cm[5] || cm[6] || canIntraword) {
          if (sameAsPrev && (cm[5] || cm[6])) break;
          if (charsBefore % 3 && !((charsBefore + run) % 3)) { extra += run; continue; }
        }
        if ((open -= run) > 0) continue;
        run = Math.min(run, run + open + extra);
        const firstCpLen = cm[0].codePointAt(0) > 0xFFFF ? 2 : 1;
        const whole = src.slice(0, runLen + cm.index + firstCpLen + run);
        if (Math.min(runLen, run) % 2) {
          const inner = whole.slice(1, -1);
          return { type: 'em', raw: whole, text: inner, tokens: inlineTokens(lx, inner) };
        }
        const inner = whole.slice(2, -2);
        return { type: 'strong', raw: whole, text: inner, tokens: inlineTokens(lx, inner) };
      }
    }
    return null;
  },

  codespan(src) {
    const m = I.code.exec(src);
    if (!m) return null;
    let text = m[2].replace(O.newLineCharGlobal, ' ');
    const hasNonSpace = O.nonSpaceChar.test(text);
    const wrapped = O.startingSpaceChar.test(text) && O.endingSpaceChar.test(text);
    if (hasNonSpace && wrapped) text = text.substring(1, text.length - 1);
    return { type: 'codespan', raw: m[0], text };
  },

  br(src) {
    const m = I.br.exec(src);
    return m ? { type: 'br', raw: m[0] } : null;
  },

  del(lx, src, masked, prevChar) {
    const m = I.delLDelim.exec(src);
    if (!m) return null;
    if (!(m[1] || '') || !prevChar || I.punctuation.exec(prevChar)) {
      const runLen = cpCount(m[0]) - 1;
      let g, run;
      let open = runLen;
      const last = lastDelCloser(lx, masked);
      const limit = masked.length - src.length + runLen;
      if (last < limit) return null;
      const rest = masked.slice(-1 * src.length + runLen);
      const stopAt = last - limit;
      let cm;
      for (I.delRDelim.lastIndex = 0; (cm = I.delRDelim.exec(rest)) !== null && !(cm.index > stopAt);) {
        g = cm[1] || cm[2] || cm[3] || cm[4] || cm[5] || cm[6];
        if (!g || (run = g.length) !== runLen) continue;
        if (cm[3] || cm[4]) { open += run; continue; }
        if ((open -= run) > 0) continue;
        run = Math.min(run, run + open);
        const firstCpLen = cm[0].codePointAt(0) > 0xFFFF ? 2 : 1;
        const whole = src.slice(0, runLen + cm.index + firstCpLen + run);
        const inner = whole.slice(runLen, -runLen);
        return { type: 'del', raw: whole, text: inner, tokens: inlineTokens(lx, inner) };
      }
    }
    return null;
  },

  autolink(src) {
    const m = I.autolink.exec(src);
    if (!m) return null;
    let text, href;
    if (m[2] === '@') { text = m[1]; href = 'mailto:' + text; }
    else { text = m[1]; href = text; }
    return { type: 'link', raw: m[0], text, href, autolink: true, tokens: [{ type: 'text', raw: text, text }] };
  },

  url(src) {
    const m = I.url.exec(src);
    if (!m) return null;
    let text, href;
    if (m[2] === '@') { text = m[0]; href = 'mailto:' + text; }
    else {
      let cur = m[0];
      let prev;
      do { prev = cur; cur = I._backpedal.exec(cur)?.[0] ?? ''; } while (cur !== prev);
      text = cur;
      href = m[1] === 'www.' ? 'http://' + cur : cur;
    }
    return { type: 'link', raw: text, text, href, autolink: true, tokens: [{ type: 'text', raw: text, text }] };
  },

  inlineText(lx, src) {
    const end = textEnd(src);
    if (end <= 0) return null;
    const raw = src.slice(0, end);
    const inRaw = lx.state.inRawBlock;
    return { type: 'text', raw, text: inRaw ? raw : decodeRefs(raw), escaped: inRaw };
  },
};

// The end index of the inline text token starting at src[0]: the same span
// the inline text rule matches, found by direct scans. The rule is: one
// leading character (a whole run of backticks or tildes, else one unit),
// then the text runs to the first stop — a hard delimiter char, a URL
// scheme or www. start, an email address start, two spaces + newline, or
// the end of the string. A leading non-alphanumeric before mailto:/xmpp:
// is a one-character token, so the URL rule can take the address.
const HARD_STOP = /[\\<\[!`*~_]/g;
const WS_CHAR = /\s/;
function textEnd(src) {
  const n = src.length;
  const c0 = src.charCodeAt(0);
  const alnum0 = (c0 >= 48 && c0 <= 57) || (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122);
  if (!alnum0 && (src.startsWith('mailto:', 1) || src.startsWith('xmpp:', 1))) return 1;
  let start = 1;
  if (src[0] === '`' || src[0] === '~') {
    while (start < n && src[start] === src[0]) start++;
  }
  let end = n;
  HARD_STOP.lastIndex = start;
  const hm = HARD_STOP.exec(src);
  if (hm && hm.index < end) end = hm.index;
  // www. stops the text only after whitespace, start, *, _, ~ or (.
  let w = src.indexOf('www.', start);
  while (w !== -1) {
    if (w === 0 || WS_CHAR.test(src[w - 1]) || src[w - 1] === '*' || src[w - 1] === '_' ||
        src[w - 1] === '~' || src[w - 1] === '(') {
      if (w < end) end = w;
      break;
    }
    w = src.indexOf('www.', w + 1);
  }
  // http://, https://, ftp:// (any case) stop the text at the scheme.
  let p = src.indexOf('://', start);
  while (p !== -1) {
    const tail = src.slice(Math.max(0, p - 5), p).toLowerCase();
    let q = -1;
    if (tail.endsWith('https')) q = p - 5;
    else if (tail.endsWith('http')) q = p - 4;
    else if (tail.endsWith('ftp')) q = p - 3;
    if (q >= start) {
      if (q < end) end = q;
      break;
    }
    p = src.indexOf('://', p + 1);
  }
  // Two or more spaces + newline: the text ends where the spaces begin.
  let nl = src.indexOf('\n', start);
  while (nl !== -1) {
    let s0 = nl;
    while (s0 > 0 && src[s0 - 1] === ' ') s0--;
    if (nl - s0 >= 2 && s0 >= start) {
      if (s0 < end) end = s0;
      break;
    }
    nl = src.indexOf('\n', nl + 1);
  }
  // An email address: the text ends where its local part begins, or one
  // character in when the address starts at the scan position.
  let at = src.indexOf('@', start);
  while (at !== -1) {
    let r = at;
    while (r > 0 && EMAIL_CHAR.test(src[r - 1])) r--;
    if (r < at) {
      if (r <= start) end = Math.min(end, start);
      else if (r < end) end = r;
      break;
    }
    at = src.indexOf('@', at + 1);
  }
  // mailto:/xmpp: after a non-alphanumeric character stops the text there.
  for (const scheme of ['mailto:', 'xmpp:']) {
    let m = src.indexOf(scheme, start + 1);
    while (m !== -1) {
      const q = m - 1;
      if (q >= start) {
        const cq = src.charCodeAt(q);
        const alnumQ = (cq >= 48 && cq <= 57) || (cq >= 65 && cq <= 90) || (cq >= 97 && cq <= 122);
        if (!alnumQ) {
          if (m < end) end = m;
          break;
        }
      }
      m = src.indexOf(scheme, m + 1);
    }
  }
  return end;
}
const EMAIL_CHAR = /[a-zA-Z0-9.!#$%&'*+\/=?_`{|}~-]/;

// The link() guard: the link text must not contain a "<" that starts a tag
// or autolink reaching past the end of the text.
function hasUnclosedTag(full, text, bang) {
  if (!text.includes('<')) return false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '`') {
      const code = I.code.exec(text.slice(i));
      if (code) { i += code[0].length - 1; continue; }
    }
    if (text[i] !== '<') continue;
    const rest = full.slice(bang + i);
    const tag = I.tag.exec(rest) || I.autolink.exec(rest);
    if (tag) {
      if (tag[0].length > text.length - i) return true;
      i += tag[0].length - 1;
    }
  }
  return false;
}

// The inline loop. `masked` is the emphasis-masked view of the same text.
// Tokenizers are dispatched on the first character: only the ones that can
// match at this character run, in their original order, so a plain-text
// chunk pays for the URL check and the text match only.
function inlineLoop(lx, src, masked, out) {
  let fresh = false;
  let prev = '';
  let guard = Infinity;
  for (; src;) {
    if (src.length < guard) guard = src.length;
    else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    if (!fresh) prev = '';
    fresh = false;
    let tok = null;
    const c = src[0];
    if (c === '\\') {
      tok = inlineTok.escape(src) || inlineTok.br(src);
    } else if (c === '<') {
      tok = inlineTok.tag(lx, src) || inlineTok.autolink(src);
    } else if (c === '[' || c === '!') {
      tok = inlineTok.link(lx, src) || inlineTok.reflink(lx, src);
      if (tok) {
        src = src.substring(tok.raw.length);
        const last = out.at(-1);
        if (tok.type === 'text' && last?.type === 'text') { last.raw += tok.raw; last.text += tok.text; }
        else out.push(tok);
        continue;
      }
    } else if (c === '*') {
      tok = inlineTok.emStrong(lx, src, masked, prev);
    } else if (c === '_') {
      tok = inlineTok.emStrong(lx, src, masked, prev) ||
        (!lx.state.inLink ? inlineTok.url(src) : null);
    } else if (c === '`') {
      tok = inlineTok.codespan(src);
    } else if (c === '~') {
      tok = inlineTok.del(lx, src, masked, prev);
    } else if (c === ' ') {
      tok = inlineTok.br(src);
    } else if (c === '.' || c === '+' || c === '-' || (c >= '0' && c <= '9') ||
        (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      if (!lx.state.inLink) tok = inlineTok.url(src);
    }
    if (tok) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if ((tok = inlineTok.inlineText(lx, src))) {
      src = src.substring(tok.raw.length);
      if (tok.raw.slice(-1) !== '_') prev = tok.raw.slice(-1);
      fresh = true;
      const last = out.at(-1);
      if (last?.type === 'text') { last.raw += tok.raw; last.text += tok.text; }
      else out.push(tok);
      continue;
    }
    if (src) throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  return out;
}

// Anything matching here can start an inline construct other than plain
// text, so a source without a match is one text token, end to end:
// backslash, tag/autolink open, link open, image bang, code span,
// emphasis, strikethrough, an underscore that starts a word, a URL
// scheme, www., an email address, or a hard break (two spaces + newline).
const PLAIN_TRIGGER = /[\\<\[!`*~]|(?:^|[^\w])_|:\/\/|www\.|@| {2,}\n/;

function inlineTokens(lx, src, out = []) {
  const saved = lx.state.linkParenPossible;
  lx.state.linkParenPossible = saved && src.includes(')');
  try {
    // Fast path: plain text. No escape, tag, link, emphasis, code span,
    // autolink, URL or hard break can start anywhere in this source, so
    // the whole inline pass is a single text token.
    if (src && !PLAIN_TRIGGER.test(src)) {
      const inRaw = lx.state.inRawBlock;
      out.push({ type: 'text', raw: src, text: inRaw ? src : decodeRefs(src), escaped: inRaw });
      return out;
    }
    const needsMask = src.includes('*') || src.includes('_') || src.includes('~');
    const masked = needsMask ? maskForEmphasis(lx, src) : src;
    lx.maskStack.push(needsMask ? scanClosers(masked) : NO_CLOSERS);
    try {
      return inlineLoop(lx, src, masked, out);
    } finally {
      lx.maskStack.pop();
    }
  } finally {
    lx.state.linkParenPossible = saved;
  }
}

// -------------------------------------------------------------- block lexer

// Block tokenizers. Each takes the remaining source and returns a token or
// null; `lx` is the lexer instance (links, inline queue, state).
const blockTok = {
  space(src) {
    const m = B.newline.exec(src);
    return m && m[0].length > 0 ? { type: 'space', raw: m[0] } : null;
  },

  code(src) {
    const m = B.code.exec(src);
    if (!m) return null;
    const raw = dropBlankTail(m[0]);
    const text = raw.replace(O.codeRemoveIndent, '');
    return { type: 'code', raw, codeBlockStyle: 'indented', text };
  },

  fences(lx, src) {
    const m = B.fences.exec(src);
    if (!m) return null;
    const raw = m[0];
    const text = fenceDedent(raw, m[3] || '');
    const lang = m[2] ? m[2].trim().replace(I.anyPunctuation, '$1') : m[2];
    return { type: 'code', raw, lang, text };
  },

  heading(lx, src) {
    const m = B.heading.exec(src);
    if (!m) return null;
    let text = m[2].trim();
    if (O.endingHash.test(text)) {
      const stripped = trimEndChars(text, '#');
      if (!stripped || O.endingSpaceTabChar.test(stripped)) text = stripped.trim();
    }
    return { type: 'heading', raw: trimEndChars(m[0], '\n'), depth: m[1].length, text, tokens: queueInline(lx, text, []) };
  },

  hr(src) {
    const m = B.hr.exec(src);
    return m ? { type: 'hr', raw: trimEndChars(m[0], '\n') } : null;
  },

  blockquote(lx, src) {
    const m = B.blockquote.exec(src);
    if (!m) return null;
    const lines = trimEndChars(m[0], '\n').split('\n');
    let raw = '';
    let text = '';
    const tokens = [];
    let rest = lines;
    while (rest.length > 0) {
      let seenMarker = false;
      const chunk = [];
      let p;
      for (p = 0; p < rest.length; p++) {
        if (O.blockquoteStart.test(rest[p])) { chunk.push(rest[p]); seenMarker = true; }
        else if (!seenMarker) chunk.push(rest[p]);
        else break;
      }
      rest = rest.slice(p);
      const joined = chunk.join('\n');
      const cleaned = joined
        .replace(O.blockquoteMarkerWhitespace, (whole, marker, ws) => marker + expandTabs(ws, marker.length))
        .replace(O.blockquoteSetextReplace, '\n    $1')
        .replace(O.blockquoteSetextReplace2, '');
      raw = raw ? raw + '\n' + joined : joined;
      text = text ? text + '\n' + cleaned : cleaned;
      const savedTop = lx.state.top;
      lx.state.top = true;
      blockTokens(lx, cleaned, tokens, true);
      lx.state.top = savedTop;
      if (rest.length === 0) break;
      const last = tokens.at(-1);
      if (last?.type === 'code' || last?.type === 'heading' || last?.type === 'hr' || last?.type === 'html' || last?.type === 'table') break;
      if (last?.type === 'blockquote') {
        const prev = last;
        const joinedRest = rest.join('\n');
        const again = prev.raw + '\n' + joinedRest.replace(O.blockquoteSetextReplace2, '');
        const reparsed = blockTok.blockquote(lx, again);
        tokens[tokens.length - 1] = reparsed;
        const leftover = again.substring(reparsed.raw.length).replace(/^\n/, '');
        const leftLines = leftover ? leftover.split('\n').length : 0;
        const extra = leftLines ? rest.slice(0, -leftLines) : rest;
        if (extra.length > 0) {
          raw += '\n' + extra.join('\n');
          text = text.substring(0, text.length - prev.text.length) + reparsed.text;
        } else {
          text = text.substring(0, text.length - prev.text.length) + reparsed.text;
        }
        rest = rest.slice(extra.length);
        if (rest.length > 0 && O.blockquoteStart.test(rest[0])) continue;
        break;
      } else if (last?.type === 'list') {
        const prev = last;
        const joinedRest = prev.raw + '\n' + rest.join('\n');
        const reparsed = blockTok.list(lx, joinedRest);
        tokens[tokens.length - 1] = reparsed;
        const extraLines = reparsed.raw.length > prev.raw.length
          ? joinedRest.slice(prev.raw.length + 1, reparsed.raw.length).split('\n').length : 0;
        if (extraLines > 0) {
          const extra = rest.slice(0, extraLines);
          raw += '\n' + extra.join('\n');
          text += '\n' + extra.join('\n');
        }
        rest = rest.slice(extraLines);
        continue;
      }
    }
    return { type: 'blockquote', raw, tokens, text };
  },

  list(lx, src) {
    const first = B.list.exec(src);
    if (!first) return null;
    const whole = src;
    let bullet = first[1].trim();
    const ordered = bullet.length > 1;
    const list = { type: 'list', raw: '', ordered, start: ordered ? +bullet.slice(0, -1) : '', loose: false, items: [] };
    bullet = ordered ? `\\d{1,9}\\${bullet.slice(-1)}` : `\\${bullet}`;
    const itemRe = O.listItemRegex(bullet);
    let hadBlank = false;
    let rest = src;
    for (; rest;) {
      let emptyItem = false;
      let itemText = '';
      const itemMatch = itemRe.exec(rest);
      if (!itemMatch || B.hr.test(rest)) break;
      const itemStart = whole.length - rest.length;
      rest = rest.substring(itemMatch[0].length);
      const nl0 = itemMatch[2].indexOf('\n');
      const firstLine = nl0 === -1 ? itemMatch[2] : itemMatch[2].slice(0, nl0);
      const bulletLen = itemMatch[1].length;
      let line = firstLine.includes('\t')
        ? firstLine.replace(O.leadingSpaceTab, (ws) => expandTabs(ws, bulletLen))
        : firstLine;
      const nl1 = rest.indexOf('\n');
      const nextLine = nl1 === -1 ? rest : rest.slice(0, nl1);
      let isEmpty = !line.trim();
      let indent = 0;
      if (isEmpty) {
        indent = bulletLen + 1;
      } else {
        indent = line.search(O.nonSpaceChar);
        if (indent > 4) indent = 1;
        itemText = line.slice(indent);
        indent += bulletLen;
      }
      if (isEmpty && O.blankLine.test(nextLine)) {
        rest = rest.substring(nextLine.length + 1);
        emptyItem = true;
      }
      if (!emptyItem) {
        const breakAt = O.listBreakRegex(indent);
        const hrAt = O.hrRegex(indent);
        const fenceAt = O.fencesBeginRegex(indent);
        const headingAt = O.headingBeginRegex(indent);
        const htmlAt = O.htmlBeginRegex(indent);
        for (; rest;) {
          const nl = rest.indexOf('\n');
          const curLine = nl === -1 ? rest : rest.slice(0, nl);
          const expanded = curLine.includes('\t')
            ? curLine.replace(O.leadingSpaceTab, (ws) => expandTabs(ws))
            : curLine;
          if (breakAt.test(curLine)) break;
          if (expanded.search(O.nonSpaceChar) >= indent || !curLine.trim()) {
            itemText += '\n' + expanded.slice(indent);
          } else {
            if (isEmpty || (line.includes('\t') ? line.replace(O.tabCharGlobal, '    ') : line).search(O.nonSpaceChar) >= 4 ||
                fenceAt.test(line) || headingAt.test(line) || htmlAt.test(line) || hrAt.test(line)) break;
            const setext = /^ {0,3}(?:=+|-+) *$/.test(curLine) && B.lheading.test(`${line}\n${curLine}`)
              ? `    ${expanded.replace(/^ {0,3}/, '')}` : curLine;
            itemText += '\n' + setext;
          }
          isEmpty = !curLine.trim();
          rest = nl === -1 ? '' : rest.slice(nl + 1);
          line = expanded.slice(indent);
        }
      }
      const itemRaw = whole.slice(itemStart, whole.length - rest.length);
      if (!list.loose) {
        if (hadBlank) list.loose = true;
        else if (O.doubleBlankLine.test(itemRaw)) hadBlank = true;
      }
      list.items.push({
        type: 'list_item', raw: itemRaw,
        task: O.listIsTask.test(itemText),
        loose: false, text: itemText, tokens: [],
      });
    }
    const lastItem = list.items.at(-1);
    if (!lastItem) return null;
    lastItem.raw = lastItem.raw.trimEnd();
    lastItem.text = lastItem.text.trimEnd();
    list.raw = whole.slice(0, whole.length - rest.length).trimEnd();
    for (const item of list.items) {
      lx.state.top = false;
      item.tokens = blockTokens(lx, item.text, []);
      if (!list.loose) {
        const spaces = item.tokens.filter((t) => t.type === 'space');
        if (spaces.length > 0 && spaces.some((t) => O.anyLine.test(t.raw))) list.loose = true;
      }
    }
    for (const item of list.items) {
      const firstTok = item.tokens[0];
      if (item.task && (firstTok?.type === 'text' || firstTok?.type === 'paragraph')) {
        item.text = item.text.replace(O.listReplaceTask, '');
        firstTok.raw = firstTok.raw.replace(O.listReplaceTask, '');
        firstTok.text = firstTok.text.replace(O.listReplaceTask, '');
        for (let q = lx.inlineQueue.length - 1; q >= 0; q--) {
          if (O.listIsTask.test(lx.inlineQueue[q].src)) {
            lx.inlineQueue[q].src = lx.inlineQueue[q].src.replace(O.listReplaceTask, '');
            break;
          }
        }
        const box = O.listTaskCheckbox.exec(item.raw);
        if (box) {
          const check = { type: 'checkbox', raw: box[0] + ' ', checked: box[0] !== '[ ]' };
          item.checked = check.checked;
          if (list.loose) {
            if (item.tokens[0] && ['paragraph', 'text'].includes(item.tokens[0].type) && 'tokens' in item.tokens[0]) {
              item.tokens[0].raw = check.raw + item.tokens[0].raw;
              item.tokens[0].text = check.raw + item.tokens[0].text;
              item.tokens[0].tokens.unshift(check);
            } else {
              item.tokens.unshift({ type: 'paragraph', raw: check.raw, text: check.raw, tokens: [check] });
            }
          } else {
            item.tokens.unshift(check);
          }
        }
      } else if (item.task) item.task = false;
    }
    if (list.loose) {
      for (const item of list.items) {
        item.loose = true;
        for (const t of item.tokens) if (t.type === 'text') t.type = 'paragraph';
      }
    }
    return list;
  },

  html(lx, src) {
    const m = B.html.exec(src);
    if (!m) return null;
    const raw = dropBlankTail(m[0]);
    return { type: 'html', block: true, raw, pre: m[1] === 'pre' || m[1] === 'script' || m[1] === 'style', text: raw };
  },

  def(lx, src) {
    const m = B.def.exec(src);
    if (!m) return null;
    if (!O.startAngleBracket.test(m[2]) && closeParen(m[2], '()') !== -1) return null;
    const tag = normLabel(m[1]);
    const href = m[2] ? m[2].replace(O.hrefBrackets, '$1').replace(I.anyPunctuation, '$1') : '';
    const title = m[3] ? m[3].substring(1, m[3].length - 1).replace(I.anyPunctuation, '$1') : m[3];
    return { type: 'def', tag, raw: trimEndChars(m[0], '\n'), href, title };
  },

  table(lx, src) {
    const m = B.table.exec(src);
    if (!m || !O.tableDelimiter.test(m[2])) return null;
    const headerCells = splitTableRow(m[1]);
    const aligns = m[2].replace(O.tableAlignChars, '').split('|');
    const bodyLines = m[3]?.trim() ? m[3].replace(O.tableRowBlankLine, '').split('\n') : [];
    const out = { type: 'table', raw: trimEndChars(m[0], '\n'), header: [], align: [], rows: [] };
    if (headerCells.length !== aligns.length) return null;
    for (const cell of aligns) {
      if (O.tableAlignRight.test(cell)) out.align.push('right');
      else if (O.tableAlignCenter.test(cell)) out.align.push('center');
      else if (O.tableAlignLeft.test(cell)) out.align.push('left');
      else out.align.push(null);
    }
    for (let i = 0; i < headerCells.length; i++) {
      out.header.push({ text: headerCells[i], tokens: queueInline(lx, headerCells[i], []), header: true, align: out.align[i] });
    }
    for (const line of bodyLines) {
      out.rows.push(splitTableRow(line, out.header.length).map((cell, i) => ({
        text: cell, tokens: queueInline(lx, cell, []), header: false, align: out.align[i],
      })));
    }
    return out;
  },

  lheading(lx, src) {
    const m = B.lheading.exec(src);
    if (!m) return null;
    const text = m[1].trim();
    return { type: 'heading', raw: trimEndChars(m[0], '\n'), depth: m[2].charAt(0) === '=' ? 1 : 2, text, tokens: queueInline(lx, text, []) };
  },

  paragraph(lx, src) {
    const m = B.paragraph.exec(src);
    if (!m) return null;
    const text = m[1].charAt(m[1].length - 1) === '\n' ? m[1].slice(0, -1) : m[1];
    return { type: 'paragraph', raw: m[0], text, tokens: queueInline(lx, text, []) };
  },

  text(lx, src) {
    const m = B.text.exec(src);
    if (!m) return null;
    return { type: 'text', raw: m[0], text: m[0], tokens: queueInline(lx, m[0], []) };
  },
};

// Split the source into block tokens. `nested` is true when lexing the
// inside of a blockquote or list item: the first paragraph may merge into a
// paragraph token already in `out` (lazy continuation lines).
function blockTokens(lx, src, out = [], nested = false) {
  let guard = Infinity;
  for (; src;) {
    if (src.length < guard) guard = src.length;
    else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    let tok;
    if ((tok = blockTok.space(src))) {
      src = src.substring(tok.raw.length);
      const prev = out.at(-1);
      if (tok.raw.length === 1 && prev !== undefined) prev.raw += '\n';
      else out.push(tok);
      continue;
    }
    if ((tok = blockTok.code(src))) {
      src = src.substring(tok.raw.length);
      const prev = out.at(-1);
      if (prev?.type === 'paragraph' || prev?.type === 'text') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.text;
        lx.inlineQueue.at(-1).src = prev.text;
      } else out.push(tok);
      continue;
    }
    if ((tok = blockTok.fences(lx, src))) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if ((tok = blockTok.heading(lx, src))) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if ((tok = blockTok.hr(src))) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if ((tok = blockTok.blockquote(lx, src))) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if ((tok = blockTok.list(lx, src))) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if ((tok = blockTok.html(lx, src))) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if ((tok = blockTok.def(lx, src))) {
      src = src.substring(tok.raw.length);
      const prev = out.at(-1);
      if (prev?.type === 'paragraph' || prev?.type === 'text') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.raw;
        lx.inlineQueue.at(-1).src = prev.text;
      } else {
        if (!lx.links[tok.tag]) lx.links[tok.tag] = { href: tok.href, title: tok.title };
        out.push(tok);
      }
      continue;
    }
    if ((tok = blockTok.table(lx, src))) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if ((tok = blockTok.lheading(lx, src))) { src = src.substring(tok.raw.length); out.push(tok); continue; }
    if (lx.state.top && (tok = blockTok.paragraph(lx, src))) {
      const prev = out.at(-1);
      if (nested && prev?.type === 'paragraph') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.text;
        lx.inlineQueue.pop();
        lx.inlineQueue.at(-1).src = prev.text;
      } else out.push(tok);
      nested = false;
      src = src.substring(tok.raw.length);
      continue;
    }
    if ((tok = blockTok.text(lx, src))) {
      src = src.substring(tok.raw.length);
      const prev = out.at(-1);
      if (prev?.type === 'text') {
        prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
        prev.text += '\n' + tok.text;
        lx.inlineQueue.pop();
        lx.inlineQueue.at(-1).src = prev.text;
      } else out.push(tok);
      continue;
    }
    if (src) throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  lx.state.top = true;
  return out;
}

// Lex a whole document: block pass, then the queued inline passes.
function lex(lx, src) {
  if (src.includes('\r')) src = src.replace(/\r\n|\r/g, '\n');
  const tokens = blockTokens(lx, src, []);
  for (let i = 0; i < lx.inlineQueue.length; i++) {
    const job = lx.inlineQueue[i];
    lx.state.inRawBlock = false;
    inlineTokens(lx, job.src, job.tokens);
  }
  lx.inlineQueue = [];
  return tokens;
}

// ----------------------------------------------------------------- rendering

// The HTML renderer: one small function per token type, mirroring what
// marked emits. `inline` renders inline tokens with the HTML renderer,
// `plain` renders them with the text renderer (image alt text).
function renderTokens(tokens) {
  let out = '';
  for (const tok of tokens) {
    switch (tok.type) {
      case 'space': break;
      case 'hr': out += '<hr>\n'; break;
      case 'heading': out += `<h${tok.depth}>${renderInline(tok.tokens)}</h${tok.depth}>\n`; break;
      case 'code': {
        const lang = (tok.lang || '').match(O.notSpaceStart)?.[0];
        const body = tok.text ? tok.text.replace(O.endingNewline, '') + '\n' : '';
        const escaped = escHtml(body, true);
        out += lang
          ? `<pre><code class="language-${escHtml(lang)}">${escaped}</code></pre>\n`
          : `<pre><code>${escaped}</code></pre>\n`;
        break;
      }
      case 'table': {
        let head = '';
        for (const cell of tok.header) head += renderTableCell(cell);
        let body = '';
        for (const row of tok.rows) {
          let cells = '';
          for (const cell of row) cells += renderTableCell(cell);
          body += `<tr>\n${cells}</tr>\n`;
        }
        if (body) body = `<tbody>${body}</tbody>`;
        out += `<table>\n<thead>\n<tr>\n${head}</tr>\n</thead>\n${body}</table>\n`;
        break;
      }
      case 'blockquote': out += `<blockquote>\n${renderTokens(tok.tokens)}</blockquote>\n`; break;
      case 'list': {
        let items = '';
        for (const item of tok.items) items += `<li>${renderTokens(item.tokens)}</li>\n`;
        const tag = tok.ordered ? 'ol' : 'ul';
        const start = tok.ordered && tok.start !== 1 ? ` start="${tok.start}"` : '';
        out += `<${tag}${start}>\n${items}</${tag}>\n`;
        break;
      }
      case 'checkbox': out += `<input ${tok.checked ? 'checked="" ' : ''}disabled="" type="checkbox"> `; break;
      case 'html': out += tok.text; break;
      case 'def': break;
      case 'paragraph': out += `<p>${renderInline(tok.tokens)}</p>\n`; break;
      case 'text': out += renderTextToken(tok); break;
      default: throw new Error(`Token with "${tok.type}" type was not found.`);
    }
  }
  return out;
}

function renderTableCell(cell) {
  const tag = cell.header ? 'th' : 'td';
  const open = cell.align ? `<${tag} align="${cell.align}">` : `<${tag}>`;
  return open + renderInline(cell.tokens) + `</${tag}>\n`;
}

function renderTextToken(tok) {
  if ('tokens' in tok && tok.tokens) return renderInline(tok.tokens);
  if ('escaped' in tok && tok.escaped) return tok.text;
  return escHtml(tok.text);
}

function renderInline(tokens, plain = false) {
  let out = '';
  for (const tok of tokens) {
    switch (tok.type) {
      case 'escape': out += plain ? tok.text : escHtml(tok.text); break;
      case 'html': out += tok.text; break;
      case 'link': out += renderLink(tok, plain); break;
      case 'image': out += plain ? (tok.tokens ? renderInline(tok.tokens, true) : tok.text) : renderImage(tok); break;
      case 'checkbox': out += plain ? tok.raw : `<input ${tok.checked ? 'checked="" ' : ''}disabled="" type="checkbox"> `; break;
      case 'strong': out += plain ? renderInline(tok.tokens, true) : `<strong>${renderInline(tok.tokens)}</strong>`; break;
      case 'em': out += plain ? renderInline(tok.tokens, true) : `<em>${renderInline(tok.tokens)}</em>`; break;
      case 'codespan': out += plain ? tok.text : `<code>${escHtml(tok.text, true)}</code>`; break;
      case 'br': out += plain ? '' : '<br>'; break;
      case 'del': out += plain ? renderInline(tok.tokens, true) : `<del>${renderInline(tok.tokens)}</del>`; break;
      case 'text': out += plain ? tok.text : renderTextToken(tok); break;
      default: throw new Error(`Token with "${tok.type}" type was not found.`);
    }
  }
  return out;
}

function renderLink(tok, plain) {
  const label = tok.autolink
    ? (plain ? tok.text : escHtml(tok.text, true))
    : renderInline(tok.tokens, plain);
  if (plain) return label;
  const clean = cleanHref(tok.href);
  if (clean === null) return label;
  let open = `<a href="${escHtml(clean, tok.autolink)}"`;
  if (tok.title) open += ` title="${escHtml(tok.title)}"`;
  return open + '>' + label + '</a>';
}

function renderImage(tok) {
  const alt = tok.tokens ? renderInline(tok.tokens, true) : tok.text;
  const clean = cleanHref(tok.href);
  if (clean === null) return escHtml(alt);
  let tag = `<img src="${escHtml(clean)}" alt="${escHtml(alt)}"`;
  if (tok.title) tag += ` title="${escHtml(tok.title)}"`;
  return tag + '>';
}

// --------------------------------------------------------------------- entry

/** The HTML marked 18.1.3 renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  const lx = makeLexer();
  const tokens = lex(lx, markdown);
  return renderTokens(tokens);
}
