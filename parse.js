// A fast, dependency-free reimplementation of marked 18.1.3's default
// rendering (GFM on, breaks off, pedantic off). parse(markdown) returns
// exactly the HTML marked.parse(markdown) returns with those options.
//
// Design: two phases per call. The block pass walks the source once and
// builds a small tree of block nodes while collecting link reference
// definitions (a definition may sit after the paragraph that uses it, so
// inline parsing must wait until the whole document's blocks are known).
// The render pass then walks the tree and runs the inline parser on each
// text. Inline rendering writes strings straight into an output array —
// there are no token objects anywhere on the hot path.
//
// Speed comes from: plain-text fast paths in the inline scanner, first
// character dispatch, a manual text scanner instead of the big inlineText
// regex, and avoiding repeated substring copies in the block loop.
'use strict';

// ---------------------------------------------------------------------------
// Small regex builder: start from a pattern string and substitute named
// pieces, dropping a leading ^ of a substituted piece (it would be an
// anchor in the middle of the new pattern).
// ---------------------------------------------------------------------------

const CARET = /(^|[^\[])\^/g;

function edit(source, flags) {
  let src = typeof source === 'string' ? source : source.source;
  const api = {
    replace(name, val) {
      let v = typeof val === 'string' ? val : val.source;
      v = v.replace(CARET, '$1');
      src = src.replace(name, v);
      return api;
    },
    regex() {
      return new RegExp(src, flags);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Shared ("other") patterns.
// ---------------------------------------------------------------------------

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
  listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
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
  numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,
  numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  escapeTest: /[&<>"']/,
  escapeReplace: /[&<>"']/g,
  escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
  escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  percentDecode: /%25/g,
  findPipe: /\|/g,
  splitPipe: / \|/,
  slashPipe: /\\\|/g,
  carriageReturn: /\r\n|\r/g,
  spaceLine: /^ +$/gm,
  notSpaceStart: /^\S*/,
  endingNewline: /\n$/,
  listItemRegex: (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`),
  nextBulletRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`)),
  hrRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`)),
  fencesBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:\`\`\`|~~~)`)),
  headingBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}#{1,6}(?:\\s|$)`)),
  htmlBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:</?(?:${TAG})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i')),
  blockquoteBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}>`)),
  // One test for every line that can end a list item: a fence, a heading,
  // an html block, a blockquote, a new bullet or a thematic break.
  listBreakRegex: cachedIndentRegex((indent) => new RegExp(
    `^ {0,${indent}}(?:(?:\`\`\`|~~~)|#{1,6}(?:\\s|$)|(?:</?(?:${TAG})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)|>|(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))|(?:(?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$))`, 'i')),
  // The same, without the blockquote and bullet alternatives, for the
  // lazy-continuation check against the previous line.
  listBreakLineRegex: cachedIndentRegex((indent) => new RegExp(
    `^ {0,${indent}}(?:(?:\`\`\`|~~~)|#{1,6}(?:\\s|$)|(?:</?(?:${TAG})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)|(?:(?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$))`, 'i')),
};

function cachedIndentRegex(create) {
  const cache = [];
  return (indent) => {
    const idx = Math.max(0, Math.min(3, indent - 1));
    let re = cache[idx];
    if (!re) {
      re = create(idx);
      cache[idx] = re;
    }
    return re;
  };
}

const TAG = 'address|article|aside|base|basefont|blockquote|body|caption'
  + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
  + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
  + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
  + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
  + '|tr|track|ul';
const COMMENT = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;

// ---------------------------------------------------------------------------
// Block grammar (GFM).
// ---------------------------------------------------------------------------

const BLOCK_NEWLINE = /^(?:[ \t]*(?:\n|$))+/;
const BLOCK_CODE = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const BLOCK_FENCES = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const BLOCK_HR = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const BLOCK_HEADING = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const BULLET = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
const BLOCK_TEXT = /^[^\n]+/;

const LHEADING_CORE = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
const BLOCK_LHEADING = edit(LHEADING_CORE)
  .replace(/bull/g, BULLET)
  .replace(/blockCode/g, /(?: {4}| {0,3}\t)/)
  .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/)
  .replace(/blockquote/g, / {0,3}>/)
  .replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/)
  .replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/)
  .replace(/html/g, / {0,3}<[^\n>]+>\n/)
  .replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/)
  .regex();

const BLOCK_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const BLOCK_DEF = edit(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
  .replace('label', BLOCK_LABEL)
  .replace('title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/)
  .regex();

const BLOCK_LIST = edit(/^(bull)([ \t][^\n]*?)?(?:\n|$)/)
  .replace(/bull/g, BULLET)
  .regex();

const BLOCK_HTML = edit(
  '^ {0,3}(?:'
  + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)'
  + '|comment[^\\n]*(\\n+|$)'
  + '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)'
  + '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)'
  + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)'
  + '|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + ')', 'i')
  .replace('comment', COMMENT)
  .replace('tag', TAG)
  .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
  .regex();

const PARAGRAPH_CORE = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
const BLOCK_TABLE = edit(
  '^ *([^\\n ].*)\\n'
  + ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)'
  + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)')
  .replace('hr', BLOCK_HR)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('blockquote', ' {0,3}>')
  .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', TAG)
  .regex();

const BLOCK_PARAGRAPH = edit(PARAGRAPH_CORE)
  .replace('hr', BLOCK_HR)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '')
  .replace('table', BLOCK_TABLE)
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', TAG)
  .regex();

function makeBlockquoteParagraph() {
  return edit(PARAGRAPH_CORE)
    .replace('hr', BLOCK_HR)
    .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .replace('|lheading', '')
    .replace('|table', '')
    .replace('blockquote', ' {0,3}>')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
    .replace('list', ' {0,3}(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|\\n|$)')
    .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
    .replace('tag', TAG)
    .regex();
}
const BLOCKQUOTE_PARAGRAPH = makeBlockquoteParagraph();
const BLOCK_BLOCKQUOTE = edit(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/).replace('paragraph', BLOCKQUOTE_PARAGRAPH).regex();
const LHEADING_GUARD = /\n {0,3}[=-]/;

// ---------------------------------------------------------------------------
// Inline grammar (GFM).
// ---------------------------------------------------------------------------

const INLINE_ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const INLINE_CODE = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const INLINE_BR = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;

// Unicode punctuation classes used by the emphasis delimiters.
const PUNCT = /[\p{P}\p{S}]/u;
const PUNCT_OR_SPACE = /[\s\p{P}\p{S}]/u;
const NOT_PUNCT_OR_SPACE = /[^\s\p{P}\p{S}]/u;
// GFM: a tilde is not punctuation for emphasis purposes (strikethrough).
const PUNCT_GFM = /(?!~)[\p{P}\p{S}]/u;
const PUNCT_OR_SPACE_GFM = /(?!~)[\s\p{P}\p{S}]/u;
const NOT_PUNCT_OR_SPACE_GFM = /(?:[^\s\p{P}\p{S}]|~)/u;

const INLINE_PUNCTUATION = edit(/^((?![*_])punctSpace)/, 'u')
  .replace(/punctSpace/g, PUNCT_OR_SPACE).regex();

const BLOCK_SKIP = edit(/link|precode-code|html/, 'g')
  .replace('link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/)
  .replace('precode-', '(?<!`)()')
  .replace('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .replace('html', /<(?! )[^<>]*?>/)
  .regex();

const EM_STRONG_L_DELIM_CORE = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
const EM_STRONG_L_DELIM = edit(EM_STRONG_L_DELIM_CORE, 'u')
  .replace(/punct/g, PUNCT_GFM)
  .regex();

const EM_STRONG_R_DELIM_AST_CORE =
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)' // skip orphan inside strong
  + '|[^*]+(?=[^*])' // consume to delim
  + '|(?!\\*)punct(\\*+)(?=[\\s]|$)' // (1) right-delim only
  + '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)' // (2) right-delim only
  + '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)' // (3) left-delim only
  + '|[\\s](\\*+)(?!\\*)(?=punct)' // (4) left-delim only
  + '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)' // (5) either
  + '|notPunctSpace(\\*+)(?=notPunctSpace)'; // (6) either
const EM_STRONG_R_DELIM_AST = edit(EM_STRONG_R_DELIM_AST_CORE, 'gu')
  .replace(/notPunctSpace/g, NOT_PUNCT_OR_SPACE_GFM)
  .replace(/punctSpace/g, PUNCT_OR_SPACE_GFM)
  .replace(/punct/g, PUNCT_GFM)
  .regex();

const EM_STRONG_R_DELIM_UND = edit(
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)' // skip orphan inside strong
  + '|[^_]+(?=[^_])' // consume to delim
  + '|(?!_)punct(_+)(?=[\\s]|$)' // (1) right-delim only
  + '|notPunctSpace(_+)(?!_)(?=punctSpace|$)' // (2) right-delim only
  + '|(?!_)punctSpace(_+)(?=notPunctSpace)' // (3) left-delim only
  + '|[\\s](_+)(?!_)(?=punct)' // (4) left-delim only
  + '|(?!_)punct(_+)(?!_)(?=punct)', 'gu') // (5) either
  .replace(/notPunctSpace/g, NOT_PUNCT_OR_SPACE)
  .replace(/punctSpace/g, PUNCT_OR_SPACE)
  .replace(/punct/g, PUNCT)
  .regex();

const DEL_L_DELIM = edit(/^~~?(?:((?!~)punct)|[^\s~])/, 'u')
  .replace(/punct/g, PUNCT)
  .regex();

const DEL_R_DELIM_CORE =
  '^[^~]+(?=[^~])' // consume to delim
  + '|(?!~)punct(~~?)(?=[\\s]|$)' // (1) right-delim only
  + '|notPunctSpace(~~?)(?!~)(?=punctSpace|$)' // (2) right-delim only
  + '|(?!~)punctSpace(~~?)(?=notPunctSpace)' // (3) left-delim only
  + '|[\\s](~~?)(?!~)(?=punct)' // (4) left-delim only
  + '|(?!~)punct(~~?)(?!~)(?=punct)' // (5) either
  + '|notPunctSpace(~~?)(?=notPunctSpace)'; // (6) either
const DEL_R_DELIM = edit(DEL_R_DELIM_CORE, 'gu')
  .replace(/notPunctSpace/g, NOT_PUNCT_OR_SPACE)
  .replace(/punctSpace/g, PUNCT_OR_SPACE)
  .replace(/punct/g, PUNCT)
  .regex();

const ANY_PUNCTUATION = edit(/\\(punct)/, 'gu')
  .replace(/punct/g, PUNCT)
  .regex();

const ANY_PUNCTUATION_OUTSIDE_CODE = edit(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, 'gu')
  .replace(/punct/g, PUNCT)
  .regex();

const INLINE_COMMENT = edit(COMMENT).replace('(?:-->|$)', '-->').regex();
const INLINE_TAG = edit(
  '^comment'
  + '|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>'
  + '|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>'
  + '|^<\\?[\\s\\S]*?\\?>'
  + '|^<![a-zA-Z]+\\s[\\s\\S]*?>'
  + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>')
  .replace('comment', INLINE_COMMENT)
  .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
  .regex();

const INLINE_AUTOLINK = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
  .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
  .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/)
  .regex();

const INLINE_LABEL_BRACKETS = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const INLINE_LABEL = edit(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/)
  .replace('brackets', INLINE_LABEL_BRACKETS)
  .regex();

const INLINE_LINK = edit(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/)
  .replace('label', INLINE_LABEL)
  .replace('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/)
  .replace('title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/)
  .regex();

const INLINE_REFLINK = edit(/^!?\[(label)\]\[(ref)\]/)
  .replace('label', INLINE_LABEL)
  .replace('ref', BLOCK_LABEL)
  .regex();

const INLINE_NOLINK = edit(/^!?\[(ref)\](?:\[\])?/)
  .replace('ref', BLOCK_LABEL)
  .regex();

const BOUNDED_BLOCK_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
const BOUNDED_INLINE_LABEL = edit(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/)
  .replace('brackets', INLINE_LABEL_BRACKETS)
  .regex();

const REFLINK_SEARCH = edit('reflink|nolink(?!\\()', 'g')
  .replace('reflink', edit(/^!?\[(label)\]\[(ref)\]/)
    .replace('label', BOUNDED_INLINE_LABEL)
    .replace('ref', BOUNDED_BLOCK_LABEL)
    .regex())
  .replace('nolink', edit(/^!?\[(ref)\](?:\[\])?/)
    .replace('ref', BOUNDED_BLOCK_LABEL)
    .regex())
  .regex();

const EXTENDED_EMAIL = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const EXTENDED_EMAIL_PROTOCOL = edit(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/)
  .replace(/email/g, EXTENDED_EMAIL)
  .regex();

const INLINE_URL = edit(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
  .replace('emailProtocol', EXTENDED_EMAIL_PROTOCOL)
  .replace('protocol', /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/)
  .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/)
  .regex();
const URL_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;

// The GFM inline text pattern, kept as the reference for the manual text
// scanner and as a fallback: it matches one chunk of plain text, stopping
// just before the next place another inline rule could act.
const INLINE_TEXT = edit(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/)
  .replace('protocol', /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/)
  .replace(/emailProtocol/g, /(?:mailto|xmpp):/)
  .replace('wwwStart', '(?<![^\\s*_~(])www\\.')
  .regex();

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escape &, <, >, ", ' — every & is escaped (used for code spans, code
// blocks, autolink text).
function escapeEncode(s) {
  if (!O.escapeTest.test(s)) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const rep = ESCAPE_MAP[s[i]];
    if (rep !== undefined) {
      out += s.slice(start, i) + rep;
      start = i + 1;
    }
  }
  return out + s.slice(start);
}

function isWordCharCode(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

// Does an & at position i of s start something that looks like a character
// reference (numeric or named)? Used to decide whether a bare & is escaped.
function startsValidRef(s, i) {
  let j = i + 1;
  if (s[j] === '#') {
    j++;
    if (s[j] === 'x' || s[j] === 'X') {
      j++;
      const start = j;
      while (j < s.length && j - start < 6) {
        const c = s.charCodeAt(j);
        const hex = (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
        if (!hex) break;
        j++;
      }
      return j > start && s[j] === ';';
    }
    const start = j;
    while (j < s.length && j - start < 7) {
      const c = s.charCodeAt(j);
      if (c < 48 || c > 57) break;
      j++;
    }
    return j > start && s[j] === ';';
  }
  const start = j;
  while (j < s.length && isWordCharCode(s.charCodeAt(j))) j++;
  return j > start && s[j] === ';';
}

// Decode a numeric character reference starting at s[i] (s[i] === '&').
// Returns [decodedString, endIndex] or null when there is none.
function decodeNumericRefAt(s, i) {
  if (s[i + 1] !== '#') return null;
  let j = i + 2;
  let hex = false;
  if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
  const start = j;
  const maxLen = hex ? 6 : 7;
  while (j < s.length && j - start < maxLen) {
    const c = s.charCodeAt(j);
    const ok = hex
      ? (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
      : (c >= 48 && c <= 57);
    if (!ok) break;
    j++;
  }
  if (j === start || s[j] !== ';') return null;
  const code = parseInt(s.slice(start, j), hex ? 16 : 10);
  let ch;
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    ch = '\uFFFD';
  } else if (code === 38) {
    ch = '&amp;';
  } else {
    ch = String.fromCodePoint(code);
    const ent = ESCAPE_MAP[ch];
    if (ent !== undefined) ch = ent;
  }
  return [ch, j + 1];
}

// Decode numeric character references and escape the rest, in one pass:
// exactly what decodeNumericCharacterReferences followed by
// escapeHtmlEntities(text) (no-encode form) does.
function escapeText(s) {
  if (!O.escapeTest.test(s)) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') {
      const dec = decodeNumericRefAt(s, i);
      if (dec) {
        out += s.slice(start, i) + dec[0];
        i = dec[1] - 1;
        start = dec[1];
      } else if (!startsValidRef(s, i)) {
        out += s.slice(start, i) + '&amp;';
        start = i + 1;
      }
    } else {
      const rep = ESCAPE_MAP[c];
      if (rep !== undefined) {
        out += s.slice(start, i) + rep;
        start = i + 1;
      }
    }
  }
  return out + s.slice(start);
}

function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(O.percentDecode, '%');
  } catch {
    return null;
  }
  return href;
}

function splitCells(tableRow, count) {
  const row = tableRow.replace(O.findPipe, (match, offset, str) => {
    let escaped = false;
    let curr = offset;
    while (--curr >= 0 && str[curr] === '\\') escaped = !escaped;
    if (escaped) return '|';
    return ' |';
  });
  const cells = row.split(O.splitPipe);
  let i = 0;
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells.at(-1)?.trim()) cells.pop();
  if (count) {
    if (cells.length > count) {
      cells.splice(count);
    } else {
      while (cells.length < count) cells.push('');
    }
  }
  for (; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(O.slashPipe, '|');
  }
  return cells;
}

// Remove trailing 'c's (or, with invert, trailing non-'c's).
function rtrim(str, c, invert) {
  const l = str.length;
  if (l === 0) return '';
  let suffLen = 0;
  while (suffLen < l) {
    const currChar = str.charAt(l - suffLen - 1);
    if (currChar === c && !invert) suffLen++;
    else if (currChar !== c && invert) suffLen++;
    else break;
  }
  return str.slice(0, l - suffLen);
}

function trimTrailingBlankLines(str) {
  const lines = str.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && O.blankLine.test(lines[end])) end--;
  if (lines.length - end <= 2) return str;
  return lines.slice(0, end + 1).join('\n');
}

// Case-fold a link label the way CommonMark asks (via upper case, so that
// ẞ meets SS), collapsing inner whitespace runs to one space.
function normalizeLabel(label) {
  return label.trim().replace(O.multipleSpaceGlobal, ' ').toLowerCase().toUpperCase().toLowerCase();
}

function findClosingBracket(str, b) {
  if (str.indexOf(b[0]) === -1 && str.indexOf(b[1]) === -1) return -1;
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      i++;
    } else if (str[i] === b[0]) {
      level++;
    } else if (str[i] === b[1]) {
      level--;
      if (level < 0) return i;
    }
  }
  if (level > 0) return -2;
  return -1;
}

function expandTabs(line, indent = 0) {
  let col = indent;
  let expanded = '';
  for (const char of line) {
    if (char === '\t') {
      const added = 4 - (col % 4);
      expanded += ' '.repeat(added);
      col += added;
    } else {
      expanded += char;
      col++;
    }
  }
  return expanded;
}

// True when s holds only whitespace — the same test as s.trim() === '',
// without allocating the trimmed copy.
const BLANK_RE = /^\s*$/;
function isBlankLine(s) {
  return BLANK_RE.test(s);
}

function indentCodeCompensation(raw, text) {
  const m = raw.match(O.indentCodeCompensation);
  if (m === null) return text;
  const indentToCode = m[1];
  return text
    .split('\n')
    .map((node) => {
      const matchIndentInNode = node.match(O.beginningSpace);
      if (matchIndentInNode === null) return node;
      const indentInNode = matchIndentInNode[0];
      return node.slice(Math.min(indentInNode.length, indentToCode.length));
    })
    .join('\n');
}

// One scan of a masked inline source for the last run of each delimiter
// that could close emphasis, strong or strikethrough. A run can close only
// when it is not preceded by ASCII whitespace or the start of the string.
function scanLastClosers(src) {
  let ast = -1;
  let und = -1;
  let del = -1;
  const len = src.length;
  for (let i = 0; i < len; i++) {
    const ch = src[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    const prev = i === 0 ? '\n' : src[i - 1];
    let j = i + 1;
    while (j < len && src[j] === ch) j++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (ch === '~') del = i;
      else if (ch === '*') ast = i;
      else und = i;
    }
    i = j - 1;
  }
  return { ast, und, del };
}

// Is the label's closing bracket inside an inline tag or autolink that
// runs past the label? If so the link must not match.
function isLabelEndInsideToken(src, label, labelStart) {
  if (!label.includes('<')) return false;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === '\\') {
      i++;
      continue;
    }
    if (label[i] === '`') {
      const code = INLINE_CODE.exec(label.slice(i));
      if (code) {
        i += code[0].length - 1;
        continue;
      }
    }
    if (label[i] !== '<') continue;
    const tokenSrc = src.slice(labelStart + i);
    const token = INLINE_TAG.exec(tokenSrc) || INLINE_AUTOLINK.exec(tokenSrc);
    if (!token) continue;
    if (token[0].length > label.length - i) return true;
    i += token[0].length - 1;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Inline parsing. State shared by one top-level parse() call lives in ctx;
// nested runs (emphasis, link labels) share it, exactly like marked's
// Lexer state. Rendering writes strings straight into `out` arrays.
// ---------------------------------------------------------------------------

function makeCtx(links) {
  return {
    links,
    inLink: false,
    inRawBlock: false,
    linkEmitted: false,
    linkParenPossible: true,
  };
}

// Does this link text hold a link already? An image does not count: an
// image may hold a link, a link may not.
function linkInText(ctx, text) {
  if (!text.includes('[')) return false;
  for (const match of text.matchAll(BLOCK_SKIP)) {
    if (INLINE_LINK.test(match[0]) && text.charAt(match.index - 1) !== '!') return true;
  }
  for (const match of text.matchAll(REFLINK_SEARCH)) {
    const match0 = match[0];
    const refStart = match0.lastIndexOf('[');
    if (match0.charAt(0) === '!' || !Object.hasOwn(ctx.links, normalizeLabel(match0.slice(refStart + 1, -1)))) continue;
    if (refStart > 1 && linkInText(ctx, match0.slice(1, refStart - 1))) continue;
    return true;
  }
  return false;
}

// Mask links, code, html and escapes so emStrong and del do not see their
// delimiters inside them. Every mask keeps the length it replaces.
function maskSrc(ctx, src) {
  let masked = src;
  if (ctx.links && src.includes('[')) {
    const maskReflink = (match0) => {
      const refStart = match0.lastIndexOf('[');
      if (!Object.hasOwn(ctx.links, normalizeLabel(match0.slice(refStart + 1, -1)))) return match0;
      if (refStart > 1 && match0.charAt(0) !== '!') {
        const text = match0.slice(1, refStart - 1);
        if (linkInText(ctx, text)) {
          return '[' + text.replace(REFLINK_SEARCH, maskReflink)
            + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(match0.length - 2) + ']';
    };
    masked = masked.replace(REFLINK_SEARCH, maskReflink);
  }
  masked = masked.replace(ANY_PUNCTUATION_OUTSIDE_CODE, (match0, code, punct) => {
    if (punct) return '+'.repeat(match0.length);
    if (code) return code + match0.slice(code.length, -code.length).replace(/`/g, '+') + code;
    return match0;
  });
  masked = masked.replace(BLOCK_SKIP, (match0, _link, context) => {
    const offset = context ? context.length : 0;
    return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
  });
  return masked;
}

// Render the label of a link or image. Links render their label as HTML;
// images render it as plain text (their alt attribute). Returns the
// rendered label, or null when the link must be abandoned (a link may not
// contain another link).
function renderLinkLabel(ctx, label, plainLabel, isImage) {
  const text = label.replace(O.outputLinkReplace, '$1');
  const outerInLink = ctx.inLink;
  const outerLinkEmitted = ctx.linkEmitted;
  const outerInRawBlock = ctx.inRawBlock;
  ctx.inLink = true;
  ctx.linkEmitted = false;
  const parts = [];
  inlineRun(ctx, text, parts, plainLabel);
  const textHasLink = ctx.linkEmitted;
  ctx.linkEmitted = outerLinkEmitted;
  ctx.inLink = outerInLink;
  if (!isImage) {
    if (textHasLink) {
      ctx.inRawBlock = outerInRawBlock;
      return null;
    }
    ctx.linkEmitted = true;
  }
  return { text, parts: parts.join(''), isImage };
}

// Escape a string the way escapeHtmlEntities does without encoding:
// <, > and quotes are escaped, and & only when it does not start a
// character reference. No numeric references are decoded here.
function escapeNoEncode(s) {
  if (!O.escapeTestNoEncode.test(s)) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') {
      if (!startsValidRef(s, i)) {
        out += s.slice(start, i) + '&amp;';
        start = i + 1;
      }
    } else {
      const rep = ESCAPE_MAP[c];
      if (rep !== undefined) {
        out += s.slice(start, i) + rep;
        start = i + 1;
      }
    }
  }
  return out + s.slice(start);
}

// Decode numeric character references only (no escaping). Used for plain
// text tokens rendered as image alt text.
function decodeNumericRefs(s) {
  if (!O.numericCharacterReference.test(s)) return s;
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '&') {
      const dec = decodeNumericRefAt(s, i);
      if (dec) {
        // Decoding must not re-escape: a decoded '&' stays '&amp;' so it
        // cannot join its neighbours into a new reference.
        out += s.slice(start, i) + dec[0];
        i = dec[1] - 1;
        start = dec[1];
      }
    }
  }
  return out + s.slice(start);
}

function renderLinkHtml(rendered, href, title) {
  const cleanHref = cleanUrl(href);
  if (rendered.isImage) {
    // parts already holds the label rendered as plain text.
    const alt = rendered.parts;
    if (cleanHref === null) return escapeNoEncode(alt);
    let out = `<img src="${escapeNoEncode(cleanHref)}" alt="${escapeNoEncode(alt)}"`;
    if (title) out += ` title="${escapeNoEncode(title)}"`;
    return out + '>';
  }
  const parsedText = rendered.autolink ? escapeEncode(rendered.text) : rendered.parts;
  if (cleanHref === null) return parsedText;
  const hrefOut = rendered.autolink ? escapeEncode(cleanHref) : escapeNoEncode(cleanHref);
  let out = '<a href="' + hrefOut + '"';
  if (title) out += ' title="' + escapeNoEncode(title) + '"';
  return out + '>' + parsedText + '</a>';
}

function tryEscape(src) {
  const cap = INLINE_ESCAPE.exec(src);
  return cap ? cap[1] : null;
}

function tryTag(ctx, src) {
  const cap = INLINE_TAG.exec(src);
  if (!cap) return null;
  if (!ctx.inLink && O.startATag.test(cap[0])) ctx.inLink = true;
  else if (ctx.inLink && O.endATag.test(cap[0])) ctx.inLink = false;
  if (!ctx.inRawBlock && O.startPreScriptTag.test(cap[0])) ctx.inRawBlock = true;
  else if (ctx.inRawBlock && O.endPreScriptTag.test(cap[0])) ctx.inRawBlock = false;
  return cap[0];
}

function tryLink(ctx, src, plain = false) {
  if (ctx.linkParenPossible === false) return null;
  const cap = INLINE_LINK.exec(src);
  if (!cap) return null;
  const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
  if (isLabelEndInsideToken(src, cap[1], labelStart)) return null;
  const trimmedUrl = cap[2].trim();
  if (O.startAngleBracket.test(trimmedUrl)) {
    if (!O.endAngleBracket.test(trimmedUrl)) return null;
    const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
    if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) return null;
  } else {
    const lastParenIndex = findClosingBracket(cap[2], '()');
    if (lastParenIndex === -2) return null;
    if (lastParenIndex > -1) {
      const start = cap[0].indexOf('!') === 0 ? 5 : 4;
      const linkLen = start + cap[1].length + lastParenIndex;
      cap[2] = cap[2].substring(0, lastParenIndex);
      cap[0] = cap[0].substring(0, linkLen).trim();
      cap[3] = '';
    }
  }
  // The ')' that ends the match is the link closer only when it is not escaped.
  const unescaped = rtrim(cap[0].slice(0, -1), '\\');
  if ((cap[0].length - unescaped.length) % 2 === 0) return null;
  let href = cap[2];
  let title = cap[3] ? cap[3].slice(1, -1) : '';
  href = href.trim();
  if (O.startAngleBracket.test(href)) href = href.slice(1, -1);
  const isImage = cap[0].charAt(0) === '!';
  const rendered = renderLinkLabel(ctx, cap[1], plain || isImage, isImage);
  if (!rendered) return null;
  if (plain) return { html: rendered.parts, len: cap[0].length };
  const html = renderLinkHtml(rendered,
    href ? href.replace(ANY_PUNCTUATION, '$1') : href,
    title ? title.replace(ANY_PUNCTUATION, '$1') : title);
  if (html === null) return null;
  return { html, len: cap[0].length };
}

function tryReflink(ctx, src, plain = false) {
  let cap = INLINE_REFLINK.exec(src) || INLINE_NOLINK.exec(src);
  if (!cap) return null;
  const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
  if (isLabelEndInsideToken(src, cap[1], labelStart)) return null;
  const link = ctx.links[normalizeLabel(cap[2] || cap[1])];
  if (!link) return { html: cap[0].charAt(0), len: 1 };
  const isImage = cap[0].charAt(0) === '!';
  const rendered = renderLinkLabel(ctx, cap[1], plain || isImage, isImage);
  if (!rendered) return null;
  if (plain) return { html: rendered.parts, len: cap[0].length };
  const html = renderLinkHtml(rendered, link.href, link.title);
  if (html === null) return null;
  return { html, len: cap[0].length };
}

function tryCodespan(src) {
  const cap = INLINE_CODE.exec(src);
  if (!cap) return null;
  let text = cap[2].replace(O.newLineCharGlobal, ' ');
  const hasNonSpaceChars = O.nonSpaceChar.test(text);
  const hasSpaceCharsOnBothEnds = O.startingSpaceChar.test(text) && O.endingSpaceChar.test(text);
  if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) text = text.substring(1, text.length - 1);
  return { html: `<code>${escapeEncode(text)}</code>`, text, len: cap[0].length };
}

function tryBr(src) {
  const cap = INLINE_BR.exec(src);
  return cap ? { html: '<br>', len: cap[0].length } : null;
}

function tryAutolink(src) {
  const cap = INLINE_AUTOLINK.exec(src);
  if (!cap) return null;
  let text;
  let href;
  if (cap[2] === '@') {
    text = cap[1];
    href = 'mailto:' + text;
  } else {
    text = cap[1];
    href = text;
  }
  const cleanHref = cleanUrl(href);
  if (cleanHref === null) return { html: escapeEncode(text), text, len: cap[0].length };
  return { html: `<a href="${escapeEncode(cleanHref)}">${escapeEncode(text)}</a>`, text, len: cap[0].length };
}

function tryUrl(ctx, src) {
  const cap = INLINE_URL.exec(src);
  if (!cap) return null;
  let text;
  let href;
  if (cap[2] === '@') {
    text = cap[0];
    href = 'mailto:' + text;
  } else {
    let prevCapZero;
    do {
      prevCapZero = cap[0];
      cap[0] = URL_BACKPEDAL.exec(cap[0])?.[0] ?? '';
    } while (prevCapZero !== cap[0]);
    text = cap[0];
    href = cap[1] === 'www.' ? 'http://' + cap[0] : cap[0];
  }
  const cleanHref = cleanUrl(href);
  if (cleanHref === null) return { html: escapeEncode(text), text, len: cap[0].length };
  return { html: `<a href="${escapeEncode(cleanHref)}">${escapeEncode(text)}</a>`, text, len: cap[0].length };
}

// ---------------------------------------------------------------------------
// Emphasis / strong / strikethrough. The closer search works on the masked
// source (links, code spans, html and escapes flattened), exactly like
// marked's, with a pre-scanned last-possible-closer index to bail out early.
// ---------------------------------------------------------------------------

const PUNCT_RE = /^[\p{P}\p{S}]/u;

// Number of Unicode code points in s (a surrogate pair counts as one).
function codePointLength(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

// Length in UTF-16 code units of the first code point of s (1 or 2).
function firstCodePointLength(s) {
  if (s.length === 0) return 0;
  const c = s.charCodeAt(0);
  if (c >= 0xd800 && c <= 0xdbff && s.length > 1) {
    const d = s.charCodeAt(1);
    if (d >= 0xdc00 && d <= 0xdfff) return 2;
  }
  return 1;
}

// Last code point of a string of at most two UTF-16 code units.
function lastCodePointOfPair(tail) {
  if (tail.length === 0) return '';
  if (tail.length === 2) {
    const c = tail.charCodeAt(0);
    const d = tail.charCodeAt(1);
    if (c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) return tail;
  }
  return tail[tail.length - 1];
}

function tryEmStrong(ctx, src, masked, closers, prevChar, plain = false) {
  const match = EM_STRONG_L_DELIM.exec(src);
  if (!match) return null;
  if (!match[1] && !match[2] && !match[3] && !match[4]) return null;

  const delimChar = match[0][0];
  const midRun = prevChar === delimChar;

  const srcStart = masked.length - src.length;
  let runStart = srcStart;
  while (runStart > 0 && masked[runStart - 1] === delimChar) runStart--;
  const runPrevChar = lastCodePointOfPair(masked.slice(Math.max(0, runStart - 2), runStart));
  const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || !!INLINE_PUNCTUATION.exec(runPrevChar);
  if (runStart < srcStart) prevChar = runPrevChar;
  const prevPunct = runStart < srcStart ? runPrevPunct : !!INLINE_PUNCTUATION.exec(prevChar);

  if (match[4] && prevChar.match(O.unicodeAlphaNumeric)) return null;

  const nextChar = match[1] || match[3] || '';
  if (!nextChar || !prevChar || prevPunct) {
    const lLength = codePointLength(match[0]) - 1;
    let rDelim;
    let rLength;
    let delimTotal = lLength;
    let midDelimTotal = 0;

    const runLength = srcStart - runStart + lLength;
    const openerCanClose = !!runPrevChar.trim()
      && (!!nextChar || (delimChar === '*' && !runPrevPunct));
    if (delimChar !== '*' && delimChar !== '_') return null;
    const endReg = delimChar === '*' ? EM_STRONG_R_DELIM_AST : EM_STRONG_R_DELIM_UND;
    const lastCloser = delimChar === '*' ? closers.ast : closers.und;
    const windowStart = masked.length - src.length + lLength;
    if (lastCloser < windowStart) return null;
    const windowMasked = masked.slice(-1 * src.length + lLength);
    const lastCloserInWindow = lastCloser - windowStart;
    endReg.lastIndex = 0;

    let m;
    while ((m = endReg.exec(windowMasked)) !== null) {
      if (m.index > lastCloserInWindow) break;
      rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!rDelim) continue;
      rLength = codePointLength(rDelim);

      if (m[3] || m[4]) {
        delimTotal += rLength;
        continue;
      } else if (m[5] || m[6] || openerCanClose) {
        if (midRun && (m[5] || m[6])) break;
        if (runLength % 3 && !((runLength + rLength) % 3)) {
          midDelimTotal += rLength;
          continue;
        }
      }

      delimTotal -= rLength;
      if (delimTotal > 0) continue;

      rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
      const lastCharLength = firstCodePointLength(m[0]);
      const raw = src.slice(0, lLength + m.index + lastCharLength + rLength);

      if (Math.min(lLength, rLength) % 2) {
        const text = raw.slice(1, -1);
        const parts = [];
        inlineRun(ctx, text, parts, plain);
        const inner = parts.join('');
        return { html: plain ? inner : `<em>${inner}</em>`, len: raw.length };
      }
      const text = raw.slice(2, -2);
      const parts = [];
      inlineRun(ctx, text, parts, plain);
      const inner = parts.join('');
      return { html: plain ? inner : `<strong>${inner}</strong>`, len: raw.length };
    }
  }
  return null;
}

function tryDel(ctx, src, masked, closers, prevChar, plain = false) {
  const match = DEL_L_DELIM.exec(src);
  if (!match) return null;
  const nextChar = match[1] || '';
  if (!nextChar || !prevChar || INLINE_PUNCTUATION.exec(prevChar)) {
    const lLength = codePointLength(match[0]) - 1;
    let rDelim;
    let rLength;
    let delimTotal = lLength;
    const endReg = DEL_R_DELIM;
    const windowStart = masked.length - src.length + lLength;
    if (closers.del < windowStart) return null;
    const windowMasked = masked.slice(-1 * src.length + lLength);
    const lastCloserInWindow = closers.del - windowStart;
    endReg.lastIndex = 0;

    let m;
    while ((m = endReg.exec(windowMasked)) !== null) {
      if (m.index > lastCloserInWindow) break;
      rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!rDelim) continue;
      rLength = codePointLength(rDelim);
      if (rLength !== lLength) continue;
      if (m[3] || m[4]) {
        delimTotal += rLength;
        continue;
      }
      delimTotal -= rLength;
      if (delimTotal > 0) continue;
      rLength = Math.min(rLength, rLength + delimTotal);
      const lastCharLength = firstCodePointLength(m[0]);
      const raw = src.slice(0, lLength + m.index + lastCharLength + rLength);
      const text = raw.slice(lLength, -lLength);
      const parts = [];
      inlineRun(ctx, text, parts, plain);
      const inner = parts.join('');
      return { html: plain ? inner : `<del>${inner}</del>`, len: raw.length };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Manual text scanner. Returns the length of the plain-text chunk at the
// start of s — the same span marked's inlineText regex matches. Candidates
// for the stop position, the earliest of which wins:
//   * a delimiter char (\ < ! [ ` * ~ _)
//   * a protocol://, a www. after a valid predecessor, an email-like run
//   * a mailto:/xmpp: after a non-alphanumeric char
//   * two or more spaces followed by a newline (hard break)
//   * the end of the string
// ---------------------------------------------------------------------------

const SPECIAL_RE = /[\\<!\[`*~_]/g;

// Characters that may appear in the local part of an extended autolink
// email address (the same class the email lookahead uses).
function isEmailCharCode(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    || c === 46 || c === 33 || c === 35 || c === 36 || c === 37 || c === 38
    || c === 39 || c === 42 || c === 43 || c === 47 || c === 61 || c === 63
    || c === 94 || c === 95 || c === 96 || c === 123 || c === 124
    || c === 125 || c === 126 || c === 45;
}

function isAlnumCode(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

// True when c may precede a www. autolink: whitespace (the full JS \s
// set, including NBSP and other Unicode spaces, as in marked's
// (?<![^\s*_~(]) lookbehind), '*', '_', '~' or '('.
const WS_RE = /\s/;
function isWsOrWwwPrev(c) {
  return c === '*' || c === '_' || c === '~' || c === '(' || WS_RE.test(c);
}

function scanTextLen(s) {
  const n = s.length;
  // First group: a backtick run, a tilde run, or a single character.
  let firstLen;
  const c0 = s[0];
  if (c0 === '`') {
    firstLen = 1;
    while (firstLen < n && s[firstLen] === '`') firstLen++;
  } else if (c0 === '~') {
    firstLen = 1;
    while (firstLen < n && s[firstLen] === '~') firstLen++;
  } else {
    firstLen = 1;
  }
  // A lone non-alphanumeric char before mailto:/xmpp: is its own chunk.
  if (firstLen === 1 && !isAlnumCode(s.charCodeAt(0))) {
    if (s.startsWith('mailto:', 1) || s.startsWith('xmpp:', 1)) return 1;
  }

  let stop = n;

  // Delimiter characters.
  SPECIAL_RE.lastIndex = firstLen;
  let m = SPECIAL_RE.exec(s);
  if (m) stop = m.index;

  // Protocol:// — only when '://' occurs at all. The protocol starts
  // three (ftp), four (http) or five (https) characters before the
  // slashes. The stop is the protocol start, which can lie before the
  // current stop even when the '://' itself lies after it.
  let p = s.indexOf('://', firstLen);
  while (p !== -1) {
    let j = -1;
    if (p - 4 >= firstLen && s.slice(p - 4, p).toLowerCase() === 'http') j = p - 4;
    else if (p - 3 >= firstLen && s.slice(p - 3, p).toLowerCase() === 'ftp') j = p - 3;
    else if (p - 5 >= firstLen && s.slice(p - 5, p).toLowerCase() === 'https') j = p - 5;
    if (j !== -1) {
      if (j < stop) stop = j;
      break; // later '://' occurrences can only start further right
    }
    p = s.indexOf('://', p + 1);
  }

  // www. with a valid predecessor — only when 'www.' occurs at all.
  if (s.indexOf('www.', firstLen) !== -1) {
    let idx = s.indexOf('www.', firstLen);
    while (idx !== -1 && idx < stop) {
      if (isWsOrWwwPrev(s[idx - 1])) { stop = idx; break; }
      idx = s.indexOf('www.', idx + 1);
    }
  }

  // Email-like run — only when '@' occurs at all. For each '@', walk back
  // over the email characters before it; the run's start (clamped to the
  // first unconsumed position) is where the text stops. The '@' itself
  // can lie after the current stop while the run still starts before it.
  let at = s.indexOf('@', firstLen);
  while (at !== -1) {
    let runStart = at;
    while (runStart > 0 && isEmailCharCode(s.charCodeAt(runStart - 1))) runStart--;
    if (runStart < firstLen) runStart = firstLen;
    if (runStart < at) {
      if (runStart < stop) stop = runStart;
      break; // the run start only moves right for later '@'s
    }
    at = s.indexOf('@', at + 1);
  }

  // mailto:/xmpp: after a non-alphanumeric character.
  if (s.indexOf('mailto:', firstLen) !== -1 || s.indexOf('xmpp:', firstLen) !== -1) {
    for (const proto of ['mailto:', 'xmpp:']) {
      let p = s.indexOf(proto, firstLen + 1);
      while (p !== -1 && p < stop) {
        if (p - 1 >= firstLen && !isAlnumCode(s.charCodeAt(p - 1))) { stop = p; break; }
        p = s.indexOf(proto, p + 1);
      }
    }
  }

  // Two or more spaces followed by a newline — only when '  \n' occurs.
  // The run starts where the spaces before that occurrence begin. When
  // the run starts at or before the first unconsumed position, the
  // text stops there: the characters from firstLen on are two or more
  // spaces followed by a newline.
  const hb = s.indexOf('  \n', firstLen);
  if (hb !== -1) {
    let k = hb;
    while (k > 0 && s[k - 1] === ' ') k--;
    if (k <= firstLen) {
      if (firstLen < stop) stop = firstLen;
    } else if (k > firstLen && s[k - 1] !== ' ' && k < stop) {
      stop = k;
    }
  }

  return stop;
}

// Fast-path test: does this inline source contain anything any inline rule
// could act on? If not, the whole run is one escaped text chunk.
const PLAIN_CHECK_RE = /[\\<\[`*_~@!]/;
function plainInlineFastPath(s) {
  return !PLAIN_CHECK_RE.test(s)
    && s.indexOf('  \n') === -1
    && s.indexOf('www.') === -1
    && s.indexOf('://') === -1
    && s.indexOf('mailto:') === -1
    && s.indexOf('xmpp:') === -1;
}

// The inline loop. `plain` renders as plain text (image alt text):
// emphasis and links contribute their text, code spans their content,
// html its raw text, hard breaks nothing, and text is decoded but not escaped.
function inlineRun(ctx, src, out, plain = false) {
  if (src === '') return;
  if (!plain && plainInlineFastPath(src)) {
    out.push(ctx.inRawBlock ? src : escapeText(src));
    return;
  }
  if (plain && plainInlineFastPath(src)) {
    out.push(ctx.inRawBlock ? src : decodeNumericRefs(src));
    return;
  }

  // Masked source + closer hints, built lazily on the first emphasis or
  // strikethrough attempt in this run (many runs never need them).
  let masked = null;
  let closers = null;
  const ensureMask = () => {
    if (masked === null) {
      masked = maskSrc(ctx, src);
      closers = scanLastClosers(masked);
    }
  };

  const prevLinkParenPossible = ctx.linkParenPossible;
  ctx.linkParenPossible = prevLinkParenPossible && src.includes(')');

  let s = src;
  let prevChar = '';
  let keepPrevChar = false;
  while (s) {
    if (!keepPrevChar) prevChar = '';
    keepPrevChar = false;
    const ch = s[0];
    let consumed = 0;

    if (ch === '\\') {
      const esc = tryEscape(s);
      if (esc !== null) {
        out.push(plain ? esc : escapeText(esc));
        consumed = 2;
      } else {
        const br = tryBr(s);
        if (br) {
          if (!plain) out.push(br.html);
          consumed = br.len;
        }
      }
    } else if (ch === '<') {
      const tag = tryTag(ctx, s);
      if (tag !== null) {
        out.push(tag);
        consumed = tag.length;
      } else {
        const link = tryAutolink(s);
        if (link) {
          out.push(plain ? link.text : link.html);
          consumed = link.len;
        }
      }
    } else if (ch === '[' || (ch === '!' && s[1] === '[')) {
      const link = tryLink(ctx, s, plain);
      if (link) {
        out.push(link.html);
        consumed = link.len;
      } else {
        const ref = tryReflink(ctx, s, plain);
        if (ref) {
          out.push(ref.html);
          consumed = ref.len;
        }
      }
    } else if (ch === '*' || ch === '_') {
      ensureMask();
      const em = tryEmStrong(ctx, s, masked, closers, prevChar, plain);
      if (em) {
        out.push(em.html);
        consumed = em.len;
      } else if (ch === '_' && !ctx.inLink) {
        // An email address may start with '_' — in marked's order the url
        // rule runs after emphasis, so try it when emphasis fails.
        const url = tryUrl(ctx, s);
        if (url) {
          out.push(plain ? url.text : url.html);
          consumed = url.len;
        }
      }
    } else if (ch === '`') {
      const code = tryCodespan(s);
      if (code) {
        out.push(plain ? code.text : code.html);
        consumed = code.len;
      }
    } else if (ch === ' ' || ch === '\t') {
      const br = tryBr(s);
      if (br) {
        if (!plain) out.push(br.html);
        consumed = br.len;
      }
    } else if (ch === '~') {
      ensureMask();
      const del = tryDel(ctx, s, masked, closers, prevChar, plain);
      if (del) {
        out.push(del.html);
        consumed = del.len;
      }
    } else if (/[A-Za-z0-9._+\-]/.test(ch)) {
      if (!ctx.inLink) {
        const url = tryUrl(ctx, s);
        if (url) {
          out.push(plain ? url.text : url.html);
          consumed = url.len;
        }
      }
    }

    if (consumed > 0) {
      s = s.substring(consumed);
      continue;
    }

    // Plain text chunk.
    const len = scanTextLen(s);
    const chunk = s.slice(0, len);
    if (plain) {
      out.push(ctx.inRawBlock ? chunk : decodeNumericRefs(chunk));
    } else {
      out.push(ctx.inRawBlock ? chunk : escapeText(chunk));
    }
    if (chunk.slice(-1) !== '_') prevChar = chunk.slice(-1);
    keepPrevChar = true;
    s = s.substring(len);
  }

  ctx.linkParenPossible = prevLinkParenPossible;
}

// ---------------------------------------------------------------------------
// Block parsing. Builds a small tree of block nodes and collects link
// reference definitions into ctx.links. Rendering happens in a second pass
// (renderBlocks), so a definition may sit after the paragraph that uses it.
// ---------------------------------------------------------------------------

function blockTokens(src, nodes, ctx, top, lastParagraphClipped = false) {
  let srcLength = Infinity;
  while (src) {
    if (src.length < srcLength) {
      srcLength = src.length;
    } else {
      throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    }

    let cap;
    let node = null;

    // newline / blank lines
    if ((cap = BLOCK_NEWLINE.exec(src))) {
      src = src.substring(cap[0].length);
      const lastNode = nodes.at(-1);
      if (cap[0].length === 1 && lastNode !== undefined) {
        lastNode.raw += '\n';
      } else {
        nodes.push({ t: 'space', raw: cap[0] });
      }
      continue;
    }

    // indented code
    if ((cap = BLOCK_CODE.exec(src))) {
      const raw = trimTrailingBlankLines(cap[0]);
      const text = raw.replace(O.codeRemoveIndent, '');
      src = src.substring(cap[0].length);
      const lastNode = nodes.at(-1);
      if (lastNode?.t === 'paragraph' || lastNode?.t === 'text') {
        lastNode.raw += (lastNode.raw.endsWith('\n') ? '' : '\n') + raw;
        lastNode.text += '\n' + text;
      } else {
        nodes.push({ t: 'code', raw, text });
      }
      continue;
    }

    // fences
    if ((cap = BLOCK_FENCES.exec(src))) {
      const raw = cap[0];
      const text = indentCodeCompensation(raw, cap[3] || '');
      const lang = cap[2] ? cap[2].trim().replace(ANY_PUNCTUATION, '$1') : cap[2];
      src = src.substring(raw.length);
      nodes.push({ t: 'code', raw, text, lang });
      continue;
    }

    // heading
    if ((cap = BLOCK_HEADING.exec(src))) {
      let text = cap[2].trim();
      if (O.endingHash.test(text)) {
        const trimmed = rtrim(text, '#');
        if (!trimmed || O.endingSpaceTabChar.test(trimmed)) text = trimmed.trim();
      }
      src = src.substring(cap[0].length);
      nodes.push({ t: 'heading', raw: rtrim(cap[0], '\n'), depth: cap[1].length, text });
      continue;
    }

    // hr
    if ((cap = BLOCK_HR.exec(src))) {
      src = src.substring(cap[0].length);
      nodes.push({ t: 'hr', raw: rtrim(cap[0], '\n') });
      continue;
    }

    // blockquote
    if ((node = parseBlockquote(src, ctx))) {
      src = src.substring(node.raw.length);
      nodes.push(node);
      continue;
    }

    // list
    if ((node = parseList(src, ctx))) {
      src = src.substring(node.raw.length);
      nodes.push(node);
      continue;
    }

    // html block
    if ((cap = BLOCK_HTML.exec(src))) {
      const raw = trimTrailingBlankLines(cap[0]);
      src = src.substring(cap[0].length);
      nodes.push({ t: 'html', raw, text: raw });
      continue;
    }

    // link reference definition
    if ((cap = BLOCK_DEF.exec(src))) {
      if (!O.startAngleBracket.test(cap[2]) && findClosingBracket(cap[2], '()') !== -1) {
        // not a definition after all; fall through to the next rules
      } else {
        const tag = normalizeLabel(cap[1]);
        const href = cap[2] ? cap[2].replace(O.hrefBrackets, '$1').replace(ANY_PUNCTUATION, '$1') : '';
        const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(ANY_PUNCTUATION, '$1') : cap[3];
        const raw = rtrim(cap[0], '\n');
        src = src.substring(cap[0].length);
        const lastNode = nodes.at(-1);
        if (lastNode?.t === 'paragraph' || lastNode?.t === 'text') {
          lastNode.raw += (lastNode.raw.endsWith('\n') ? '' : '\n') + raw;
          lastNode.text += '\n' + raw;
        } else {
          // The first definition of a label wins, but a later one still
          // consumes its text.
          if (!ctx.links[tag]) ctx.links[tag] = { href, title };
          nodes.push({ t: 'def', raw });
        }
        continue;
      }
    }

    // table (gfm) — only when the second line can be a delimiter row
    // (it must hold a dash and a pipe or a colon).
    if ((node = parseTable(src))) {
      src = src.substring(node.raw.length);
      nodes.push(node);
      continue;
    }

    // setext heading — only when some later line can be an underline
    // (a newline, up to three spaces, then = or -).
    if (LHEADING_GUARD.test(src) && (cap = BLOCK_LHEADING.exec(src))) {
      const text = cap[1].trim();
      src = src.substring(cap[0].length);
      nodes.push({
        t: 'heading',
        raw: rtrim(cap[0], '\n'),
        depth: cap[2].charAt(0) === '=' ? 1 : 2,
        text,
      });
      continue;
    }

    // top-level paragraph
    if (top && (cap = BLOCK_PARAGRAPH.exec(src))) {
      const text = cap[1].charAt(cap[1].length - 1) === '\n' ? cap[1].slice(0, -1) : cap[1];
      src = src.substring(cap[0].length);
      const lastNode = nodes.at(-1);
      if (lastParagraphClipped && lastNode?.t === 'paragraph') {
        lastNode.raw += (lastNode.raw.endsWith('\n') ? '' : '\n') + cap[0];
        lastNode.text += '\n' + text;
      } else {
        nodes.push({ t: 'paragraph', raw: cap[0], text });
      }
      lastParagraphClipped = false;
      continue;
    }

    // text
    if ((cap = BLOCK_TEXT.exec(src))) {
      src = src.substring(cap[0].length);
      const lastNode = nodes.at(-1);
      if (lastNode?.t === 'text') {
        lastNode.raw += (lastNode.raw.endsWith('\n') ? '' : '\n') + cap[0];
        lastNode.text += '\n' + cap[0];
      } else {
        nodes.push({ t: 'text', raw: cap[0], text: cap[0] });
      }
      continue;
    }

    if (src) throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  return nodes;
}

function parseBlockquote(src, ctx) {
  const cap = BLOCK_BLOCKQUOTE.exec(src);
  if (!cap) return null;
  let lines = rtrim(cap[0], '\n').split('\n');
  let raw = '';
  let text = '';
  const nodes = [];

  while (lines.length > 0) {
    let inBlockquote = false;
    const currentLines = [];
    let i;
    for (i = 0; i < lines.length; i++) {
      if (O.blockquoteStart.test(lines[i])) {
        currentLines.push(lines[i]);
        inBlockquote = true;
      } else if (!inBlockquote) {
        currentLines.push(lines[i]);
      } else {
        break;
      }
    }
    lines = lines.slice(i);

    const currentRaw = currentLines.join('\n');
    const currentText = currentRaw
      .replace(
        O.blockquoteMarkerWhitespace,
        (_, marker, whitespace) => marker + expandTabs(whitespace, marker.length),
      )
      .replace(O.blockquoteSetextReplace, '\n    $1')
      .replace(O.blockquoteSetextReplace2, '');
    raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
    text = text ? `${text}\n${currentText}` : currentText;

    blockTokens(currentText, nodes, ctx, true, true);

    if (lines.length === 0) break;
    const lastNode = nodes.at(-1);

    if (lastNode?.t === 'code' || lastNode?.t === 'heading' || lastNode?.t === 'hr'
      || lastNode?.t === 'html' || lastNode?.t === 'table') {
      break;
    } else if (lastNode?.t === 'blockquote') {
      const oldNode = lastNode;
      const continuation = lines.join('\n');
      const newText = oldNode.raw + '\n' + continuation.replace(O.blockquoteSetextReplace2, '');
      const newNode = parseBlockquote(newText, ctx);
      nodes[nodes.length - 1] = newNode;
      const leftover = newText.substring(newNode.raw.length).replace(/^\n/, '');
      const leftoverCount = leftover ? leftover.split('\n').length : 0;
      const consumed = leftoverCount ? lines.slice(0, -leftoverCount) : lines;
      if (consumed.length > 0) raw = `${raw}\n${consumed.join('\n')}`;
      text = text.substring(0, text.length - oldNode.text.length) + newNode.text;
      lines = lines.slice(consumed.length);
      if (lines.length > 0 && O.blockquoteStart.test(lines[0])) continue;
      break;
    } else if (lastNode?.t === 'list') {
      const oldNode = lastNode;
      const newText = oldNode.raw + '\n' + lines.join('\n');
      const newNode = parseList(newText, ctx);
      nodes[nodes.length - 1] = newNode;
      const consumedCount = newNode.raw.length > oldNode.raw.length
        ? newText.slice(oldNode.raw.length + 1, newNode.raw.length).split('\n').length
        : 0;
      if (consumedCount > 0) {
        const consumed = lines.slice(0, consumedCount).join('\n');
        raw = `${raw}\n${consumed}`;
        text = `${text}\n${consumed}`;
      }
      lines = lines.slice(consumedCount);
      continue;
    }
  }

  return { t: 'blockquote', raw, text, nodes };
}

function parseList(src, ctx) {
  let cap = BLOCK_LIST.exec(src);
  if (!cap) return null;
  const listSrc = src;
  let rest = src;
  const taken = () => listSrc.length - rest.length;
  let bull = cap[1].trim();
  const isordered = bull.length > 1;

  const list = {
    t: 'list',
    raw: '',
    ordered: isordered,
    start: isordered ? +bull.slice(0, -1) : '',
    loose: false,
    items: [],
  };

  bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
  const itemRegex = O.listItemRegex(bull);
  let endsWithBlankLine = false;

  while (rest) {
    let endEarly = false;
    let itemContents = '';
    if (!(cap = itemRegex.exec(rest))) break;
    if (BLOCK_HR.test(rest)) break;

    const itemStart = taken();
    rest = rest.substring(cap[0].length);

    const firstNl = cap[2].indexOf('\n');
    const firstLine = firstNl === -1 ? cap[2] : cap[2].slice(0, firstNl);
    const bulletIndent = cap[1].length;
    let line = firstLine.includes('\t')
      ? firstLine.replace(O.leadingSpaceTab, (ws) => expandTabs(ws, bulletIndent))
      : firstLine;
    const restNl = rest.indexOf('\n');
    let nextLine = restNl === -1 ? rest : rest.slice(0, restNl);
    let blankLine = isBlankLine(line);

    let indent = 0;
    if (blankLine) {
      indent = bulletIndent + 1;
    } else {
      indent = line.search(O.nonSpaceChar);
      indent = indent > 4 ? 1 : indent;
      itemContents = line.slice(indent);
      indent += bulletIndent;
    }

    if (blankLine && O.blankLine.test(nextLine)) {
      rest = rest.substring(nextLine.length + 1);
      endEarly = true;
    }

    if (!endEarly) {
      const listBreak = O.listBreakRegex(indent);
      const listBreakLine = O.listBreakLineRegex(indent);

      while (rest) {
        const nl = rest.indexOf('\n');
        const rawLine = nl === -1 ? rest : rest.slice(0, nl);
        nextLine = rawLine;
        const nextLineWithoutTabs = nextLine.includes('\t')
          ? nextLine.replace(O.leadingSpaceTab, (ws) => expandTabs(ws))
          : nextLine;

        // End list item at a fence, heading, html block, blockquote, new
        // bullet or thematic break.
        if (listBreak.test(nextLine)) break;

        if (nextLineWithoutTabs.search(O.nonSpaceChar) >= indent || isBlankLine(nextLine)) {
          itemContents += '\n' + nextLineWithoutTabs.slice(indent);
        } else {
          if (blankLine) break;
          const lineNoTabs = line.includes('\t') ? line.replace(O.tabCharGlobal, '    ') : line;
          if (lineNoTabs.search(O.nonSpaceChar) >= 4) break;
          if (listBreakLine.test(line)) break;

          // A lazy continuation can look like a setext underline after
          // list indentation is removed. Keep it in the paragraph.
          const setextContinuation = /^ {0,3}(?:=+|-+) *$/.test(nextLine)
            && BLOCK_LHEADING.test(`${line}\n${nextLine}`);
          const continuation = setextContinuation
            ? `    ${nextLineWithoutTabs.replace(/^ {0,3}/, '')}`
            : nextLine;
          itemContents += '\n' + continuation;
        }

        blankLine = isBlankLine(nextLine);
        rest = nl === -1 ? '' : rest.slice(nl + 1);
        line = nextLineWithoutTabs.slice(indent);
      }
    }

    const raw = listSrc.slice(itemStart, taken());

    if (!list.loose) {
      if (endsWithBlankLine) {
        list.loose = true;
      } else if (O.doubleBlankLine.test(raw)) {
        endsWithBlankLine = true;
      }
    }

    list.items.push({
      t: 'list_item',
      raw,
      task: O.listIsTask.test(itemContents),
      loose: false,
      text: itemContents,
      nodes: [],
    });
  }

  const lastItem = list.items.at(-1);
  if (lastItem) {
    lastItem.raw = lastItem.raw.trimEnd();
    lastItem.text = lastItem.text.trimEnd();
  } else {
    return null;
  }
  list.raw = listSrc.slice(0, taken()).trimEnd();

  // First pass: tokenize items and finalize list.loose from spacers.
  for (const item of list.items) {
    blockTokens(item.text, item.nodes, ctx, false);
    if (!list.loose) {
      const spacers = item.nodes.filter((n) => n.t === 'space');
      const hasMultipleLineBreaks = spacers.length > 0 && spacers.some((n) => O.anyLine.test(n.raw));
      list.loose = hasMultipleLineBreaks;
    }
  }

  // Second pass: place task checkboxes using the final list.loose.
  for (const item of list.items) {
    const itemNode = item.nodes[0];
    if (item.task && (itemNode?.t === 'text' || itemNode?.t === 'paragraph')) {
      item.text = item.text.replace(O.listReplaceTask, '');
      itemNode.raw = itemNode.raw.replace(O.listReplaceTask, '');
      itemNode.text = itemNode.text.replace(O.listReplaceTask, '');
      const taskRaw = O.listTaskCheckbox.exec(item.raw);
      if (taskRaw) {
        const checkbox = {
          t: 'checkbox',
          raw: taskRaw[0] + ' ',
          checked: taskRaw[0] !== '[ ]',
        };
        item.checked = checkbox.checked;
        if (list.loose) {
          if (itemNode && (itemNode.t === 'paragraph' || itemNode.t === 'text')) {
            // The checkbox renders before the paragraph's inline content;
            // its marker was already stripped from the text, so the text
            // must NOT gain the marker back here.
            itemNode.raw = checkbox.raw + itemNode.raw;
            itemNode.checkbox = checkbox;
          } else {
            item.nodes.unshift({
              t: 'paragraph',
              raw: checkbox.raw,
              text: '',
              checkbox,
            });
          }
        } else {
          item.nodes.unshift(checkbox);
        }
      }
    } else if (item.task) {
      item.task = false;
    }
  }

  if (list.loose) {
    for (const item of list.items) {
      item.loose = true;
      for (const node of item.nodes) {
        if (node.t === 'text') node.t = 'paragraph';
      }
    }
  }

  return list;
}

function parseTable(src) {
  // Cheap necessary check: the delimiter row is the second line and must
  // hold a dash and a pipe or a colon.
  const firstNl = src.indexOf('\n');
  if (firstNl === -1) return null;
  const secondNl = src.indexOf('\n', firstNl + 1);
  const secondLine = secondNl === -1 ? src.slice(firstNl + 1) : src.slice(firstNl + 1, secondNl);
  if (secondLine.indexOf('-') === -1) return null;
  if (secondLine.indexOf('|') === -1 && secondLine.indexOf(':') === -1) return null;
  const cap = BLOCK_TABLE.exec(src);
  if (!cap) return null;
  if (!O.tableDelimiter.test(cap[2])) return null;

  const headers = splitCells(cap[1]);
  const aligns = cap[2].replace(O.tableAlignChars, '').split('|');
  const rows = cap[3]?.trim() ? cap[3].replace(O.tableRowBlankLine, '').split('\n') : [];

  if (headers.length !== aligns.length) return null;

  const align = [];
  for (const a of aligns) {
    if (O.tableAlignRight.test(a)) align.push('right');
    else if (O.tableAlignCenter.test(a)) align.push('center');
    else if (O.tableAlignLeft.test(a)) align.push('left');
    else align.push(null);
  }

  const header = headers.map((h, i) => ({ text: h, align: align[i] }));
  const rowsOut = rows.map((row) =>
    splitCells(row, header.length).map((cell, i) => ({ text: cell, align: align[i] })));

  return { t: 'table', raw: rtrim(cap[0], '\n'), header, rows: rowsOut };
}

// ---------------------------------------------------------------------------
// Rendering. One top-level inline render per block node, with inRawBlock
// reset before it, mirroring marked's inline queue processing.
// ---------------------------------------------------------------------------

function renderInline(ctx, text, out) {
  ctx.inRawBlock = false;
  inlineRun(ctx, text, out, false);
}

function checkboxHtml(checkbox) {
  return '<input ' + (checkbox.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
}

function renderBlocks(nodes, ctx, out) {
  for (const node of nodes) {
    switch (node.t) {
      case 'space':
      case 'def':
        break;
      case 'code': {
        const langString = (node.lang || '').match(O.notSpaceStart)?.[0];
        const code = node.text ? node.text.replace(O.endingNewline, '') + '\n' : '';
        if (!langString) {
          out.push('<pre><code>' + escapeEncode(code) + '</code></pre>\n');
        } else {
          out.push('<pre><code class="language-' + escapeNoEncode(langString) + '">'
            + escapeEncode(code) + '</code></pre>\n');
        }
        break;
      }
      case 'heading':
        out.push(`<h${node.depth}>`);
        renderInline(ctx, node.text, out);
        out.push(`</h${node.depth}>\n`);
        break;
      case 'hr':
        out.push('<hr>\n');
        break;
      case 'blockquote':
        out.push('<blockquote>\n');
        renderBlocks(node.nodes, ctx, out);
        out.push('</blockquote>\n');
        break;
      case 'list': {
        const type = node.ordered ? 'ol' : 'ul';
        const startAttr = (node.ordered && node.start !== 1) ? (' start="' + node.start + '"') : '';
        out.push('<' + type + startAttr + '>\n');
        for (const item of node.items) {
          out.push('<li>');
          renderBlocks(item.nodes, ctx, out);
          out.push('</li>\n');
        }
        out.push('</' + type + '>\n');
        break;
      }
      case 'checkbox':
        out.push(checkboxHtml(node));
        break;
      case 'html':
        out.push(node.text);
        break;
      case 'paragraph':
        out.push('<p>');
        if (node.checkbox) out.push(checkboxHtml(node.checkbox));
        renderInline(ctx, node.text, out);
        out.push('</p>\n');
        break;
      case 'text':
        if (node.checkbox) out.push(checkboxHtml(node.checkbox));
        renderInline(ctx, node.text, out);
        break;
      case 'table': {
        out.push('<table>\n<thead>\n<tr>\n');
        for (const cell of node.header) {
          out.push(cell.align ? `<th align="${cell.align}">` : '<th>');
          renderInline(ctx, cell.text, out);
          out.push('</th>\n');
        }
        out.push('</tr>\n</thead>\n');
        if (node.rows.length > 0) {
          out.push('<tbody>');
          for (const row of node.rows) {
            out.push('<tr>\n');
            for (const cell of row) {
              out.push(cell.align ? `<td align="${cell.align}">` : '<td>');
              renderInline(ctx, cell.text, out);
              out.push('</td>\n');
            }
            out.push('</tr>\n');
          }
          out.push('</tbody>');
        }
        out.push('</table>\n');
        break;
      }
      default:
        throw new Error('Token with "' + node.t + '" type was not found.');
    }
  }
}

export function parse(markdown) {
  const src = markdown.replace(O.carriageReturn, '\n');
  const ctx = makeCtx(Object.create(null));
  const nodes = [];
  blockTokens(src, nodes, ctx, true);
  const out = [];
  renderBlocks(nodes, ctx, out);
  return out.join('');
}
