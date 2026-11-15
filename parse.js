// Fast drop-in for marked 18.1.3 (default options: GFM on, breaks off,
// pedantic off, async off). Returns, for every string, exactly the HTML
// marked.parse renders with those options.
//
// This file is an original reimplementation written for this competition.
// It follows the same parsing algorithm as marked 18.1.3 (MIT, Copyright
// (c) 2018-2026 MarkedJS; Copyright (c) 2011-2018 Christopher Jeffrey) so
// its output matches marked code unit for code unit, but the code below is
// structured and written by hand for speed: the block and inline loops
// dispatch on the next character instead of trying every rule's regex at
// every position, the emphasis mask is built lazily, and helpers avoid
// repeated work. Only the GFM rule set is needed here because the entry
// always runs with marked's defaults.
//
// No caching across calls: parse() is stateless per invocation; the only
// shared state is read-only regexes and tables built into this source.

/* ------------------------------------------------------------------ */
/* Regex builder (same construction marked's rules use: a pattern     */
/* with placeholder words is expanded by string substitution).        */
/* ------------------------------------------------------------------ */

const RE_CARET = /(^|[^\[])\^/g;
function editRegex(source, flags) {
  let src = typeof source === 'string' ? source : source.source;
  const obj = {
    replace(name, val) {
      let v = typeof val === 'string' ? val : val.source;
      v = v.replace(RE_CARET, '$1');
      src = src.replace(name, v);
      return obj;
    },
    getRegex() { return new RegExp(src, flags); },
  };
  return obj;
}
const SUPPORTS_LOOKBEHIND = (() => { try { return !!new RegExp('(?<=1)(?<!1)'); } catch { return false; } })();

/* ------------------------------------------------------------------ */
/* Regexes: the GFM block grammar                                     */
/* ------------------------------------------------------------------ */

const RE_NEWLINE = /^(?:[ \t]*(?:\n|$))+/;
const RE_BLOCK_CODE = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const RE_FENCES = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const RE_HR = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const RE_HEADING = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const RE_BULLET = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
const RE_TAG_NAMES = 'address|article|aside|base|basefont|blockquote|body|caption'
  + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
  + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
  + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
  + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
  + '|tr|track|ul';
const LHEADING_CORE = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
const RE_LHEADING = editRegex(LHEADING_CORE)
  .replace(/bull/g, RE_BULLET)
  .replace(/blockCode/g, /(?: {4}| {0,3}\t)/)
  .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/)
  .replace(/blockquote/g, / {0,3}>/)
  .replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/)
  .replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/)
  .replace(/html/g, / {0,3}<[^\n>]+>\n/)
  .replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/)
  .getRegex();
const PARAGRAPH_CORE = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
const RE_TABLE = editRegex(
  '^ *([^\\n ].*)\\n'
  + ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)'
  + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)')
  .replace('hr', RE_HR)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('blockquote', ' {0,3}>')
  .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', RE_TAG_NAMES)
  .getRegex();
const RE_PARAGRAPH = editRegex(PARAGRAPH_CORE)
  .replace('hr', RE_HR)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '')
  .replace('table', RE_TABLE)
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', RE_TAG_NAMES)
  .getRegex();
const RE_BLOCKQUOTE_PARAGRAPH = editRegex(PARAGRAPH_CORE)
  .replace('hr', RE_HR)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '')
  .replace('|table', '')
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', / {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/)
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', RE_TAG_NAMES)
  .getRegex();
const RE_BLOCK_TEXT = /^[^\n]+/;
const RE_BLOCK_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const RE_DEF = editRegex(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
  .replace('label', RE_BLOCK_LABEL)
  .replace('title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/)
  .getRegex();
const RE_LIST = editRegex(/^(bull)([ \t][^\n]*?)?(?:\n|$)/)
  .replace(/bull/g, RE_BULLET)
  .getRegex();
const RE_COMMENT = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const RE_HTML = editRegex(
  '^ {0,3}(?:'
  + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)'
  + '|comment[^\\n]*(\\n+|$)'
  + '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)'
  + '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)'
  + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)'
  + '|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)'
  + '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)'
  + '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)'
  + ')', 'i')
  .replace('comment', RE_COMMENT)
  .replace('tag', RE_TAG_NAMES)
  .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
  .getRegex();
const RE_BLOCKQUOTE = editRegex(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/)
  .replace('paragraph', RE_BLOCKQUOTE_PARAGRAPH)
  .getRegex();

/* ------------------------------------------------------------------ */
/* Regexes: the GFM inline grammar                                    */
/* ------------------------------------------------------------------ */

const RE_ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const RE_INLINE_CODE = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const RE_BR = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const RE_PUNCT = /[\p{P}\p{S}]/u;
const RE_PUNCT_OR_SPACE = /[\s\p{P}\p{S}]/u;
const RE_NOT_PUNCT_OR_SPACE = /[^\s\p{P}\p{S}]/u;
const RE_PUNCT_GFM = /(?!~)[\p{P}\p{S}]/u;
const RE_PUNCT_OR_SPACE_GFM = /(?!~)[\s\p{P}\p{S}]/u;
const RE_NOT_PUNCT_OR_SPACE_GFM = /(?:[^\s\p{P}\p{S}]|~)/u;
const RE_PUNCTUATION = editRegex(/^((?![*_])punctSpace)/, 'u')
  .replace(/punctSpace/g, RE_PUNCT_OR_SPACE).getRegex();
const RE_BLOCK_SKIP = editRegex(/link|precode-code|html/, 'g')
  .replace('link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/)
  .replace('precode-', SUPPORTS_LOOKBEHIND ? '(?<!`)()' : '(^^|[^`])')
  .replace('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .replace('html', /<(?! )[^<>]*?>/)
  .getRegex();
const EM_STRONG_LDELIM_CORE = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
const RE_EM_STRONG_LDELIM = editRegex(EM_STRONG_LDELIM_CORE, 'u')
  .replace(/punct/g, RE_PUNCT_GFM)
  .getRegex();
const EM_STRONG_RDELIM_AST_CORE =
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)' // Skip orphan inside strong
  + '|[^*]+(?=[^*])' // Consume to delim
  + '|(?!\\*)punct(\\*+)(?=[\\s]|$)' // (1) #*** can only be a Right Delimiter
  + '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)' // (2) a***#, a*** can only be a Right Delimiter
  + '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)' // (3) #***a, ***a can only be Left Delimiter
  + '|[\\s](\\*+)(?!\\*)(?=punct)' // (4) ***# can only be Left Delimiter
  + '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)' // (5) #***# can be either Left or Right Delimiter
  + '|notPunctSpace(\\*+)(?=notPunctSpace)'; // (6) a***a can be either Left or Right Delimiter
const RE_EM_STRONG_RDELIM_AST = editRegex(EM_STRONG_RDELIM_AST_CORE, 'gu')
  .replace(/notPunctSpace/g, RE_NOT_PUNCT_OR_SPACE_GFM)
  .replace(/punctSpace/g, RE_PUNCT_OR_SPACE_GFM)
  .replace(/punct/g, RE_PUNCT_GFM)
  .getRegex();
const RE_EM_STRONG_RDELIM_UND = editRegex(
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)' // Skip orphan inside strong
  + '|[^_]+(?=[^_])' // Consume to delim
  + '|(?!_)punct(_+)(?=[\\s]|$)' // (1) #___ can only be a Right Delimiter
  + '|notPunctSpace(_+)(?!_)(?=punctSpace|$)' // (2) a___#, a___ can only be a Right Delimiter
  + '|(?!_)punctSpace(_+)(?=notPunctSpace)' // (3) #___a, ___a can only be Left Delimiter
  + '|[\\s](_+)(?!_)(?=punct)' // (4) ___# can only be Left Delimiter
  + '|(?!_)punct(_+)(?!_)(?=punct)', 'gu') // (5) #___# can be either Left or Right Delimiter
  .replace(/notPunctSpace/g, RE_NOT_PUNCT_OR_SPACE)
  .replace(/punctSpace/g, RE_PUNCT_OR_SPACE)
  .replace(/punct/g, RE_PUNCT)
  .getRegex();
const RE_DEL_LDELIM = editRegex(/^~~?(?:((?!~)punct)|[^\s~])/, 'u')
  .replace(/punct/g, RE_PUNCT)
  .getRegex();
const DEL_RDELIM_CORE =
  '^[^~]+(?=[^~])' // Consume to delim
  + '|(?!~)punct(~~?)(?=[\\s]|$)' // (1) #~~ can only be a Right Delimiter
  + '|notPunctSpace(~~?)(?!~)(?=punctSpace|$)' // (2) a~~#, a~~ can only be a Right Delimiter
  + '|(?!~)punctSpace(~~?)(?=notPunctSpace)' // (3) #~~a, ~~a can only be Left Delimiter
  + '|[\\s](~~?)(?!~)(?=punct)' // (4) ~~# can only be Left Delimiter
  + '|(?!~)punct(~~?)(?!~)(?=punct)' // (5) #~~# can be either Left or Right Delimiter
  + '|notPunctSpace(~~?)(?=notPunctSpace)'; // (6) a~~a can be either Left or Right Delimiter
const RE_DEL_RDELIM = editRegex(DEL_RDELIM_CORE, 'gu')
  .replace(/notPunctSpace/g, RE_NOT_PUNCT_OR_SPACE)
  .replace(/punctSpace/g, RE_PUNCT_OR_SPACE)
  .replace(/punct/g, RE_PUNCT)
  .getRegex();
const RE_ANY_PUNCT = editRegex(/\\(punct)/, 'gu')
  .replace(/punct/g, RE_PUNCT)
  .getRegex();
const RE_ANY_PUNCT_OUTSIDE_CODE = editRegex(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, 'gu')
  .replace(/punct/g, RE_PUNCT)
  .getRegex();
const RE_AUTOLINK = editRegex(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
  .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
  .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/)
  .getRegex();
const RE_INLINE_COMMENT = editRegex(RE_COMMENT).replace('(?:-->|$)', '-->').getRegex();
const RE_TAG = editRegex(
  '^comment'
  + '|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>' // self-closing tag
  + '|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>' // open tag
  + '|^<\\?[\\s\\S]*?\\?>' // processing instruction, e.g. <?php ?>
  + '|^<![a-zA-Z]+\\s[\\s\\S]*?>' // declaration, e.g. <!DOCTYPE html>
  + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>') // CDATA section
  .replace('comment', RE_INLINE_COMMENT)
  .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
  .getRegex();
const RE_INLINE_LABEL_BRACKETS = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const RE_INLINE_LABEL = editRegex(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/)
  .replace('brackets', RE_INLINE_LABEL_BRACKETS)
  .getRegex();
const RE_LINK = editRegex(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/)
  .replace('label', RE_INLINE_LABEL)
  .replace('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/)
  .replace('title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/)
  .getRegex();
const RE_REFLINK = editRegex(/^!?\[(label)\]\[(ref)\]/)
  .replace('label', RE_INLINE_LABEL)
  .replace('ref', RE_BLOCK_LABEL)
  .getRegex();
const RE_NOLINK = editRegex(/^!?\[(ref)\](?:\[\])?/)
  .replace('ref', RE_BLOCK_LABEL)
  .getRegex();
const RE_BOUNDED_BLOCK_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
const RE_BOUNDED_INLINE_LABEL = editRegex(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/)
  .replace('brackets', RE_INLINE_LABEL_BRACKETS)
  .getRegex();
const RE_REFLINK_SEARCH = editRegex('reflink|nolink(?!\\()', 'g')
  .replace('reflink', editRegex(/^!?\[(label)\]\[(ref)\]/)
    .replace('label', RE_BOUNDED_INLINE_LABEL)
    .replace('ref', RE_BOUNDED_BLOCK_LABEL)
    .getRegex())
  .replace('nolink', editRegex(/^!?\[(ref)\](?:\[\])?/)
    .replace('ref', RE_BOUNDED_BLOCK_LABEL)
    .getRegex())
  .getRegex();
const RE_CASE_INSENSITIVE_PROTOCOL = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
const RE_EXTENDED_EMAIL = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const RE_EXTENDED_EMAIL_PROTOCOL = editRegex(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/)
  .replace(/email/g, RE_EXTENDED_EMAIL)
  .getRegex();
const RE_URL = editRegex(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
  .replace('emailProtocol', RE_EXTENDED_EMAIL_PROTOCOL)
  .replace('protocol', RE_CASE_INSENSITIVE_PROTOCOL)
  .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/)
  .getRegex();
const RE_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const RE_INLINE_TEXT = editRegex(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/)
  .replace('protocol', RE_CASE_INSENSITIVE_PROTOCOL)
  .replace(/emailProtocol/g, /(?:mailto|xmpp):/)
  .replace('wwwStart', SUPPORTS_LOOKBEHIND ? '(?<![^\\s*_~(])www\\.' : 'www\\.')
  .getRegex();
const RE_DEL = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;

/* ------------------------------------------------------------------ */
/* Small shared regexes                                               */
/* ------------------------------------------------------------------ */

const RE_CODE_REMOVE_INDENT = /^(?: {0,3}\t| {1,4})/gm;
const RE_OUTPUT_LINK_REPLACE = /\\([\[\]])/g;
const RE_INDENT_CODE_COMP = /^(\s+)(?:```)/;
const RE_BEGINNING_SPACE = /^\s+/;
const RE_ENDING_HASH = /#$/;
const RE_STARTING_SPACE = /^ /;
const RE_ENDING_SPACE = / $/;
const RE_ENDING_SPACE_TAB = /[ \t]$/;
const RE_NON_SPACE = /[^ ]/;
const RE_NEWLINE_GLOBAL = /\n/g;
const RE_TAB_GLOBAL = /\t/g;
const RE_LEADING_SPACE_TAB = /^[ \t]+/;
const RE_MULTI_SPACE = /\s+/g;
const RE_BLANK_LINE = /^[ \t]*$/;
const RE_DOUBLE_BLANK = /\n[ \t]*\n[ \t]*$/;
const RE_BQ_START = /^ {0,3}>/;
const RE_BQ_SETEXT = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const RE_BQ_SETEXT2 = /^ {0,3}>[ \t]?/gm;
const RE_BQ_MARKER_WS = /^( {0,3}>)([ \t]+)/gm;
const RE_LIST_NESTING = /^ {1,4}(?=( {4})*[^ ])/g;
const RE_LIST_IS_TASK = /^\[[ xX]\][ \t]+\S/;
const RE_LIST_REPLACE_TASK = /^\[[ xX]\][ \t]+/;
const RE_LIST_CHECKBOX = /\[[ xX]\]/;
const RE_ANY_LINE = /\n.*\n/;
const RE_HREF_BRACKETS = /^<(.*)>$/;
const RE_TABLE_DELIM = /[:|]/;
const RE_TABLE_ALIGN_CHARS = /^\||\| *$/g;
const RE_TABLE_ROW_BLANK = /\n[ \t]*$/;
const RE_TABLE_ALIGN_RIGHT = /^ *-+: *$/;
const RE_TABLE_ALIGN_CENTER = /^ *:-+: *$/;
const RE_TABLE_ALIGN_LEFT = /^ *:-+ *$/;
const RE_START_A_TAG = /^<a /i;
const RE_END_A_TAG = /^<\/a>/i;
const RE_START_PRE_TAG = /^<(pre|code|kbd|script)(\s|>)/i;
const RE_END_PRE_TAG = /^<\/(pre|code|kbd|script)(\s|>)/i;
const RE_START_ANGLE = /^</;
const RE_END_ANGLE = />$/;
const RE_UNICODE_ALNUM = /[\p{L}\p{N}]/u;
const RE_NUM_REF = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const RE_NUM_REF_OR_AMP = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const RE_ESCAPE_TEST = /[&<>"']/;
const RE_ESCAPE_REPLACE = /[&<>"']/g;
const RE_ESCAPE_TEST_NO_ENCODE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
const RE_ESCAPE_REPLACE_NO_ENCODE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const RE_PERCENT_DECODE = /%25/g;
const RE_FIND_PIPE = /\|/g;
const RE_SPLIT_PIPE = / \|/;
const RE_SLASH_PIPE = /\\\|/g;
const RE_CARRIAGE = /\r\n|\r/g;
const RE_SPACE_LINE = /^ +$/gm;
const RE_NOT_SPACE_START = /^\S*/;
const RE_ENDING_NEWLINE = /\n$/;
const RE_SETEXT_LINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const RE_URL_GUARD = /^(?:www\.|[A-Za-z0-9._+-]+@|[a-zA-Z][a-zA-Z0-9+.-]{1,31}:)/;

/* Cached indent-dependent regexes (at most 4 variants each). */
function cachedIndentRegex(create) {
  const cache = [];
  return (indent) => {
    const idx = Math.max(0, Math.min(3, indent - 1));
    let re = cache[idx];
    if (!re) { re = create(idx); cache[idx] = re; }
    return re;
  };
}
const listItemRegex = (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\\n]*)?(?:\\n|$))`);
const nextBulletRegex = cachedIndentRegex((i) => new RegExp(`^ {0,${i}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`));
const hrRegex = cachedIndentRegex((i) => new RegExp(`^ {0,${i}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`));
const fencesBeginRegex = cachedIndentRegex((i) => new RegExp(`^ {0,${i}}(?:\`\`\`|~~~)`));
const headingBeginRegex = cachedIndentRegex((i) => new RegExp(`^ {0,${i}}#{1,6}(?:\\s|$)`));
const htmlBeginRegex = cachedIndentRegex((i) => new RegExp(`^ {0,${i}}(?:</?(?:${RE_TAG_NAMES})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'));
const blockquoteBeginRegex = cachedIndentRegex((i) => new RegExp(`^ {0,${i}}>`));

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(html, encode) {
  if (encode) {
    if (RE_ESCAPE_TEST.test(html)) return html.replace(RE_ESCAPE_REPLACE, (ch) => ESCAPE_MAP[ch]);
  } else if (RE_ESCAPE_TEST_NO_ENCODE.test(html)) {
    return html.replace(RE_ESCAPE_REPLACE_NO_ENCODE, (ch) => ESCAPE_MAP[ch]);
  }
  return html;
}

// Numeric character references outside code stand for the character they
// name. Zero, out-of-range and surrogate values become U+FFFD.
function decodeNumericRefs(text) {
  if (text.indexOf('&') === -1) return text;
  if (!RE_NUM_REF.test(text)) return text;
  return text.replace(RE_NUM_REF_OR_AMP, (ref, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const code = dec === undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}

function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(RE_PERCENT_DECODE, '%');
  } catch {
    return null;
  }
  return href;
}

// Split a table row on unescaped pipes. Escaped pipes stay literal.
function splitCells(row, count) {
  const withSpaces = row.replace(RE_FIND_PIPE, (match, offset, str) => {
    let escaped = false;
    let curr = offset;
    while (--curr >= 0 && str[curr] === '\\') escaped = !escaped;
    return escaped ? '|' : ' |';
  });
  const cells = withSpaces.split(RE_SPLIT_PIPE);
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells.at(-1)?.trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(RE_SLASH_PIPE, '|');
  }
  return cells;
}

// Remove trailing 'c's (or, with invert, trailing non-'c's). Equivalent to
// str.replace(/c*$/, '') without the backtracking hazard.
function rtrim(str, c, invert) {
  const l = str.length;
  if (l === 0) return '';
  let suffLen = 0;
  while (suffLen < l) {
    const curr = str.charAt(l - suffLen - 1);
    if (curr === c && !invert) suffLen++;
    else if (curr !== c && invert) suffLen++;
    else break;
  }
  return str.slice(0, l - suffLen);
}

function trimTrailingBlankLines(str) {
  const lines = str.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && RE_BLANK_LINE.test(lines[end])) end--;
  if (lines.length - end <= 2) return str;
  return lines.slice(0, end + 1).join('\n');
}

// Case-fold a link label the way CommonMark asks: trim, collapse inner
// whitespace runs to one space, round-trip through upper case so that e.g.
// 'ẞ' meets 'SS'.
function normalizeLabel(label) {
  return label.trim().replace(RE_MULTI_SPACE, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Index of the bracket that closes the first unmatched opener of pair b,
// -1 when balanced without a closer, -2 when more openers than closers.
function findClosingBracket(str, b) {
  if (str.indexOf(b[0]) === -1 && str.indexOf(b[1]) === -1) return -1;
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') i++;
    else if (str[i] === b[0]) level++;
    else if (str[i] === b[1]) {
      level--;
      if (level < 0) return i;
    }
  }
  if (level > 0) return -2;
  return -1;
}

function expandTabs(line, indent = 0) {
  let col = indent;
  let out = '';
  for (const ch of line) {
    if (ch === '\t') {
      const added = 4 - (col % 4);
      out += ' '.repeat(added);
      col += added;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

// Number of Unicode code points in `s`, without spreading it into an
// array the way [...s].length does.
function codePointLength(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xDC00 && d <= 0xDFFF) { n--; i++; }
    }
  }
  return n;
}

// Last Unicode code point of `s` (one or two code units).
function lastCodePoint(s) {
  if (!s) return '';
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xDC00 && last <= 0xDFFF && s.length >= 2) {
    const prev = s.charCodeAt(s.length - 2);
    if (prev >= 0xD800 && prev <= 0xDBFF) return s.slice(-2);
  }
  return s.slice(-1);
}

// Length in code units of the first Unicode code point of `s`.
function firstCodePointLength(s) {
  const c0 = s.charCodeAt(0);
  if (c0 >= 0xD800 && c0 <= 0xDBFF && s.length > 1) {
    const c1 = s.charCodeAt(1);
    if (c1 >= 0xDC00 && c1 <= 0xDFFF) return 2;
  }
  return 1;
}

// One scan of a masked inline source for the last delimiter runs that can
// close emphasis/strong (* or _) and strikethrough (~). A run can close
// only when not preceded by ASCII whitespace or the start of the string.
function scanCloserHints(src) {
  const lastEm = { '*': -1, _: -1 };
  let lastDel = -1;
  const len = src.length;
  for (let i = 0; i < len; i++) {
    const ch = src[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    const prev = i === 0 ? '\n' : src[i - 1];
    let j = i + 1;
    while (j < len && src[j] === ch) j++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (ch === '~') lastDel = i;
      else lastEm[ch] = i;
    }
    i = j - 1;
  }
  return { lastEm, lastDel };
}

function indentCodeCompensation(raw, text) {
  const m = raw.match(RE_INDENT_CODE_COMP);
  if (m === null) return text;
  const indentToCode = m[1];
  return text.split('\n').map((node) => {
    const mm = node.match(RE_BEGINNING_SPACE);
    if (mm === null) return node;
    return node.slice(Math.min(mm[0].length, indentToCode.length));
  }).join('\n');
}

// Is the label's closing bracket inside a code span, autolink or tag that
// started inside the label? Then the bracket does not end the label.
function isLabelEndInsideToken(src, label, labelStart) {
  if (!label.includes('<')) return false;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === '\\') { i++; continue; }
    if (label[i] === '`') {
      const code = RE_INLINE_CODE.exec(label.slice(i));
      if (code) { i += code[0].length - 1; continue; }
    }
    if (label[i] !== '<') continue;
    const tokenSrc = src.slice(labelStart + i);
    const token = RE_TAG.exec(tokenSrc) || RE_AUTOLINK.exec(tokenSrc);
    if (!token) continue;
    if (token[0].length > label.length - i) return true;
    i += token[0].length - 1;
  }
  return false;
}

// Build a link/image token from a regex match, lexing its label text with
// the inline lexer. Returns undefined when the label already holds a link
// (links may not nest), so the caller falls through to plain text.
function outputLink(cap, link, raw, lexer) {
  const href = link.href;
  const title = link.title || null;
  const text = cap[1].replace(RE_OUTPUT_LINK_REPLACE, '$1');
  const isImage = cap[0].charAt(0) === '!';
  const outerInLink = lexer.state.inLink;
  const outerLinkEmitted = lexer.state.linkEmitted;
  const outerInRawBlock = lexer.state.inRawBlock;
  lexer.state.inLink = true;
  lexer.state.linkEmitted = false;
  const tokens = lexer.inlineTokens(text);
  const textHasLink = lexer.state.linkEmitted;
  lexer.state.linkEmitted = outerLinkEmitted;
  lexer.state.inLink = outerInLink;
  if (!isImage) {
    if (textHasLink) {
      lexer.state.inRawBlock = outerInRawBlock;
      return undefined;
    }
    lexer.state.linkEmitted = true;
  }
  return { type: isImage ? 'image' : 'link', raw, href, title, text, tokens };
}

// First non-space character within a 0-3 space indent, or null when the
// indent is deeper or a tab comes first (then only code/paragraph/table
// can start here).
function firstMarkerChar(src) {
  let i = 0;
  while (i < 3 && src[i] === ' ') i++;
  const ch = src[i];
  if (ch === '\t' || ch === undefined) return null;
  if (i === 3 && src[3] === ' ') return null;
  return ch;
}

// Can the line starting at src be blank (only spaces/tabs then newline)?
function startsBlankLine(src) {
  let i = 0;
  while (src[i] === ' ' || src[i] === '\t') i++;
  return src[i] === '\n' || i === src.length;
}

// Can src start an indented code block (4 spaces or <=3 spaces + tab)?
function startsIndentedCode(src) {
  if (src[0] === '\t') return true;
  if (src.startsWith('    ')) return true;
  let i = 0;
  while (i < 3 && src[i] === ' ') i++;
  return src[i] === '\t';
}

// Necessary condition for a table: the second line holds a delimiter row
// (a '-' plus a '|' or ':').
function tableMayFollow(src) {
  const nl = src.indexOf('\n');
  if (nl === -1) return false;
  const nl2 = src.indexOf('\n', nl + 1);
  const line2 = nl2 === -1 ? src.slice(nl + 1) : src.slice(nl + 1, nl2);
  return line2.includes('-') && (line2.includes('|') || line2.includes(':'));
}

// Necessary condition for a setext heading: some line before the next
// blank line consists only of = or - (plus <=3 spaces and trailing space).
function lheadingMayFollow(src) {
  let pos = src.indexOf('\n');
  if (pos === -1) return false;
  pos++;
  while (pos < src.length) {
    const end = src.indexOf('\n', pos);
    const line = end === -1 ? src.slice(pos) : src.slice(pos, end);
    if (RE_BLANK_LINE.test(line)) return false;
    if (RE_SETEXT_LINE.test(line)) return true;
    if (end === -1) return false;
    pos = end + 1;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Lexer: block tokenization, then inline tokenization (deferred)     */
/* ------------------------------------------------------------------ */

class Lexer {
  constructor() {
    this.tokens = [];
    this.tokens.links = Object.create(null);
    this.inlineQueue = [];
    this.state = {
      inLink: false,
      inRawBlock: false,
      linkEmitted: false,
      linkParenPossible: true,
      top: true,
    };
  }

  lex(src) {
    if (src.includes('\r')) src = src.replace(RE_CARRIAGE, '\n');
    this.blockTokens(src, this.tokens);
    for (let i = 0; i < this.inlineQueue.length; i++) {
      const next = this.inlineQueue[i];
      // An inline <pre>, <code>, <kbd> or <script> left open ends with the
      // block holding it; carried over, it would stop every later block's
      // text from being escaped.
      this.state.inRawBlock = false;
      this.inlineTokens(next.src, next.tokens);
    }
    this.inlineQueue = [];
    return this.tokens;
  }

  blockTokens(src, tokens, lastParagraphClipped = false) {
    let srcLength = Infinity;
    while (src) {
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
      }

      let token;

      // Blank lines (possibly indented) are spaces.
      if (startsBlankLine(src)) {
        token = spaceToken(src);
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (token.raw.length === 1 && lastToken !== undefined) {
          lastToken.raw += '\n';
        } else {
          tokens.push(token);
        }
        continue;
      }

      const marker = firstMarkerChar(src);

      // Indented code (4 spaces or a tab) cannot interrupt a paragraph:
      // when it follows one it is merged into it instead.
      if ((marker === null || src[0] === ' ' || src[0] === '\t') && startsIndentedCode(src)) {
        token = codeToken(src);
        if (token) {
          src = src.substring(token.raw.length);
          const lastToken = tokens.at(-1);
          if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
            lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
            lastToken.text += '\n' + token.text;
            this.inlineQueue.at(-1).src = lastToken.text;
          } else {
            tokens.push(token);
          }
          continue;
        }
      }

      if (marker === '#') {
        if ((token = headingToken(src, this))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (marker === '>') {
        if ((token = blockquoteToken(src, this))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (marker === '`' || marker === '~') {
        if ((token = fencesToken(src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (marker === '-' || marker === '*' || marker === '_') {
        if ((token = hrToken(src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        if ((token = listToken(src, this))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (marker === '<') {
        if ((token = htmlToken(src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (marker === '[') {
        if ((token = defToken(src))) {
          src = src.substring(token.raw.length);
          const lastToken = tokens.at(-1);
          if (lastToken?.type === 'paragraph' || lastToken?.type === 'text') {
            lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
            lastToken.text += '\n' + token.raw;
            this.inlineQueue.at(-1).src = lastToken.text;
          } else {
            if (!this.tokens.links[token.tag]) {
              this.tokens.links[token.tag] = { href: token.href, title: token.title };
            }
            tokens.push(token);
          }
          continue;
        }
      } else if (marker !== null && marker >= '0' && marker <= '9') {
        if ((token = listToken(src, this))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (marker === '+') {
        if ((token = listToken(src, this))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      // Table: header line plus a delimiter row.
      if (tableMayFollow(src)) {
        token = tableToken(src, this);
        if (token) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      // Setext heading.
      if (lheadingMayFollow(src)) {
        token = lheadingToken(src, this);
        if (token) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      }

      // Top-level paragraph.
      if (this.state.top && (token = paragraphToken(src, this))) {
        const lastToken = tokens.at(-1);
        if (lastParagraphClipped && lastToken?.type === 'paragraph') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1).src = lastToken.text;
        } else {
          tokens.push(token);
        }
        lastParagraphClipped = false;
        src = src.substring(token.raw.length);
        continue;
      }

      // Plain text (inside blockquotes and list items, mostly).
      if ((token = textToken(src, this))) {
        src = src.substring(token.raw.length);
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'text') {
          lastToken.raw += (lastToken.raw.endsWith('\n') ? '' : '\n') + token.raw;
          lastToken.text += '\n' + token.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1).src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      if (src) {
        throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
      }
    }

    this.state.top = true;
    return tokens;
  }

  inline(src, tokens = []) {
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }

  // Does this link text hold a link already? An image does not count: an
  // image may hold a link, a link may not.
  linkInText(text) {
    if (!text.includes('[')) return false;
    RE_REFLINK_SEARCH.lastIndex = 0;
    for (const match of text.matchAll(RE_BLOCK_SKIP)) {
      if (RE_LINK.test(match[0]) && text.charAt(match.index - 1) !== '!') return true;
    }
    RE_REFLINK_SEARCH.lastIndex = 0;
    for (const match of text.matchAll(RE_REFLINK_SEARCH)) {
      const match0 = match[0];
      const refStart = match0.lastIndexOf('[');
      if (match0.charAt(0) === '!' || !Object.hasOwn(this.tokens.links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
        continue;
      }
      if (refStart > 1 && this.linkInText(match0.slice(1, refStart - 1))) continue;
      return true;
    }
    return false;
  }

  inlineTokens(src, tokens = []) {
    // One paren scan per inline run, shared with link(): without a ')'
    // ahead the link regex cannot match, and skipping it avoids its
    // quadratic backtracking over unterminated-link inputs. A nested run
    // receives a substring of the outer run, so if the outer had no ')'
    // neither does this substring.
    const prevLinkParenPossible = this.state.linkParenPossible;
    this.state.linkParenPossible = prevLinkParenPossible && src.includes(')');
    // The mask (and its closer hints) are built lazily: only the
    // emphasis/strikethrough rules read them, so runs without a delimiter
    // attempt skip the three global replaces entirely.
    const run = { src, masked: null, hints: null };
    try {
      return this.tokenizeInlines(src, tokens, run);
    } finally {
      this.state.linkParenPossible = prevLinkParenPossible;
    }
  }

  // Mask links, code, html and escapes so emStrong and del do not see
  // their delimiters inside them. Every mask keeps the length it replaces.
  maskSrc(src) {
    let maskedSrc = src;
    if (this.tokens.links && src.includes('[')) {
      const maskReflink = (match0) => {
        const refStart = match0.lastIndexOf('[');
        if (!Object.hasOwn(this.tokens.links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
          return match0;
        }
        if (refStart > 1 && match0.charAt(0) !== '!') {
          const text = match0.slice(1, refStart - 1);
          if (this.linkInText(text)) {
            return '[' + text.replace(RE_REFLINK_SEARCH, maskReflink)
              + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
          }
        }
        return '[' + 'a'.repeat(match0.length - 2) + ']';
      };
      maskedSrc = maskedSrc.replace(RE_REFLINK_SEARCH, maskReflink);
    }
    // The punctuation mask can only change something where a backslash or
    // a backtick occurs; the block-skip mask only where '[', '`' or '<'
    // occurs. Both replaces are no-ops otherwise, so skip the scan.
    if (src.includes('\\') || src.includes('`')) {
      maskedSrc = maskedSrc.replace(RE_ANY_PUNCT_OUTSIDE_CODE, (match0, code, punct) => {
        if (punct) return '+'.repeat(match0.length);
        if (code) return code + match0.slice(code.length, -code.length).replace(/`/g, '+') + code;
        return match0;
      });
    }
    if (src.includes('[') || src.includes('`') || src.includes('<')) {
      maskedSrc = maskedSrc.replace(RE_BLOCK_SKIP, (match0, _link, context) => {
        const offset = context ? context.length : 0;
        return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
      });
    }
    return maskedSrc;
  }

  ensureMask(run) {
    if (run.masked === null) {
      run.masked = this.maskSrc(run.src);
      run.hints = scanCloserHints(run.masked);
    }
    return run.masked;
  }

  tokenizeInlines(src, tokens, run) {
    let keepPrevChar = false;
    let prevChar = '';
    let srcLength = Infinity;
    while (src) {
      if (src.length < srcLength) {
        srcLength = src.length;
      } else {
        throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
      }

      if (!keepPrevChar) prevChar = '';
      keepPrevChar = false;

      let token;
      const c = src[0];

      if (c === '\\') {
        if ((token = escapeToken(src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        if ((token = brToken(src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (c === '<') {
        if ((token = tagToken(src, this))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        if ((token = autolinkToken(src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (c === '[' || c === '!') {
        if ((token = linkToken(src, this))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        if ((token = reflinkToken(src, this.tokens.links, this))) {
          src = src.substring(token.raw.length);
          const lastToken = tokens.at(-1);
          if (token.type === 'text' && lastToken?.type === 'text') {
            lastToken.raw += token.raw;
            lastToken.text += token.text;
          } else {
            tokens.push(token);
          }
          continue;
        }
      } else if (c === '*' || c === '_') {
        if ((token = emStrongToken(src, this, run, prevChar))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
        // An email autolink may start with '_' (e.g. _foo@bar.com).
        if (!this.state.inLink && RE_URL_GUARD.test(src)) {
          if ((token = urlToken(src))) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        }
      } else if (c === '.' || c === '+' || c === '-') {
        // An email autolink may start with '.', '+' or '-' (e.g. -a@b.co).
        if (!this.state.inLink && RE_URL_GUARD.test(src)) {
          if ((token = urlToken(src))) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        }
      } else if (c === '`') {
        if ((token = codespanToken(src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (c === '~') {
        if ((token = delToken(src, this, run, prevChar))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if (c === ' ') {
        if ((token = brToken(src))) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          continue;
        }
      } else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
        if (!this.state.inLink && RE_URL_GUARD.test(src)) {
          if ((token = urlToken(src))) {
            src = src.substring(token.raw.length);
            tokens.push(token);
            continue;
          }
        }
      }

      // Plain text up to the next construct.
      if ((token = inlineTextToken(src, this))) {
        src = src.substring(token.raw.length);
        if (token.raw.slice(-1) !== '_') prevChar = token.raw.slice(-1);
        keepPrevChar = true;
        const lastToken = tokens.at(-1);
        if (lastToken?.type === 'text') {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }

      if (src) {
        throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
      }
    }
    return tokens;
  }
}

/* ------------------------------------------------------------------ */
/* Block tokenizers                                                   */
/* ------------------------------------------------------------------ */

function spaceToken(src) {
  const cap = RE_NEWLINE.exec(src);
  if (cap && cap[0].length > 0) return { type: 'space', raw: cap[0] };
  return undefined;
}

function codeToken(src) {
  const cap = RE_BLOCK_CODE.exec(src);
  if (!cap) return undefined;
  const raw = trimTrailingBlankLines(cap[0]);
  return { type: 'code', raw, codeBlockStyle: 'indented', text: raw.replace(RE_CODE_REMOVE_INDENT, '') };
}

function fencesToken(src) {
  const cap = RE_FENCES.exec(src);
  if (!cap) return undefined;
  return {
    type: 'code',
    raw: cap[0],
    lang: cap[2] ? cap[2].trim().replace(RE_ANY_PUNCT, '$1') : cap[2],
    text: indentCodeCompensation(cap[0], cap[3] || ''),
  };
}

function headingToken(src, lexer) {
  const cap = RE_HEADING.exec(src);
  if (!cap) return undefined;
  let text = cap[2].trim();
  if (RE_ENDING_HASH.test(text)) {
    const trimmed = rtrim(text, '#');
    if (!trimmed || RE_ENDING_SPACE_TAB.test(trimmed)) text = trimmed.trim();
  }
  return { type: 'heading', raw: rtrim(cap[0], '\n'), depth: cap[1].length, text, tokens: lexer.inline(text) };
}

function hrToken(src) {
  const cap = RE_HR.exec(src);
  if (!cap) return undefined;
  return { type: 'hr', raw: rtrim(cap[0], '\n') };
}

function blockquoteToken(src, lexer) {
  const cap = RE_BLOCKQUOTE.exec(src);
  if (!cap) return undefined;
  let lines = rtrim(cap[0], '\n').split('\n');
  let raw = '';
  let text = '';
  const tokens = [];
  while (lines.length > 0) {
    let inBlockquote = false;
    const currentLines = [];
    let i;
    for (i = 0; i < lines.length; i++) {
      if (RE_BQ_START.test(lines[i])) {
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
      .replace(RE_BQ_MARKER_WS, (_, marker, whitespace) => marker + expandTabs(whitespace, marker.length))
      .replace(RE_BQ_SETEXT, '\n    $1')
      .replace(RE_BQ_SETEXT2, '');
    raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
    text = text ? `${text}\n${currentText}` : currentText;
    const top = lexer.state.top;
    lexer.state.top = true;
    lexer.blockTokens(currentText, tokens, true);
    lexer.state.top = top;
    if (lines.length === 0) break;
    const lastToken = tokens.at(-1);
    if (lastToken?.type === 'code' || lastToken?.type === 'heading' || lastToken?.type === 'hr' || lastToken?.type === 'html' || lastToken?.type === 'table') {
      break;
    } else if (lastToken?.type === 'blockquote') {
      const oldToken = lastToken;
      const continuation = lines.join('\n');
      const newText = oldToken.raw + '\n' + continuation.replace(RE_BQ_SETEXT2, '');
      const newToken = blockquoteToken(newText, lexer);
      tokens[tokens.length - 1] = newToken;
      const leftover = newText.substring(newToken.raw.length).replace(/^\n/, '');
      const leftoverCount = leftover ? leftover.split('\n').length : 0;
      const consumed = leftoverCount ? lines.slice(0, -leftoverCount) : lines;
      if (consumed.length > 0) raw = `${raw}\n${consumed.join('\n')}`;
      text = text.substring(0, text.length - oldToken.text.length) + newToken.text;
      lines = lines.slice(consumed.length);
      if (lines.length > 0 && RE_BQ_START.test(lines[0])) continue;
      break;
    } else if (lastToken?.type === 'list') {
      const oldToken = lastToken;
      const newText = oldToken.raw + '\n' + lines.join('\n');
      const newToken = listToken(newText, lexer);
      tokens[tokens.length - 1] = newToken;
      const consumedCount = newToken.raw.length > oldToken.raw.length
        ? newText.slice(oldToken.raw.length + 1, newToken.raw.length).split('\n').length
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
  return { type: 'blockquote', raw, tokens, text };
}

// First line of a string (up to the next newline), without allocating a
// split array the way src.split('\n', 1)[0] does.
function firstLineOf(s) {
  const nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}

// First non-space character of `line` within a 0-`indent` space indent,
// or '' when the indent is deeper, a tab comes first, or the line is empty.
// One scan classifies a line for every block-start test that needs it.
function lineFirstChar(line, indent) {
  let i = 0;
  while (i < indent && line[i] === ' ') i++;
  if (i === indent && line[i] === ' ' && indent > 0) return '';
  const ch = line[i];
  if (ch === undefined || ch === '\t') return '';
  return ch;
}

// Expand leading tabs of `line` the way marked does for list items, but
// only when a tab is actually in the leading whitespace (the common case
// has none, and the replace would allocate for nothing).
function expandLeadingTabs(line) {
  let i = 0;
  let hasTab = false;
  while (line[i] === ' ' || line[i] === '\t') {
    if (line[i] === '\t') { hasTab = true; break; }
    i++;
  }
  return hasTab ? line.replace(RE_LEADING_SPACE_TAB, (ws) => expandTabs(ws)) : line;
}

function listToken(src, lexer) {
  let cap = RE_LIST.exec(src);
  if (!cap) return undefined;
  const listSrc = src;
  const taken = () => listSrc.length - src.length;
  let bull = cap[1].trim();
  const isordered = bull.length > 1;
  const list = {
    type: 'list',
    raw: '',
    ordered: isordered,
    start: isordered ? +bull.slice(0, -1) : '',
    loose: false,
    items: [],
  };
  bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
  const itemRegex = listItemRegex(bull);
  let endsWithBlankLine = false;
  while (src) {
    let endEarly = false;
    let itemContents = '';
    if (!(cap = itemRegex.exec(src))) break;
    if (RE_HR.test(src)) break;
    const itemStart = taken();
    src = src.substring(cap[0].length);
    const firstLine = firstLineOf(cap[2]);
    const bulletIndent = cap[1].length;
    let line = firstLine.replace(RE_LEADING_SPACE_TAB, (ws) => expandTabs(ws, bulletIndent));
    const nextLine = firstLineOf(src);
    let blankLine = !line.trim();
    let indent = 0;
    if (blankLine) {
      indent = bulletIndent + 1;
    } else {
      indent = line.search(RE_NON_SPACE);
      indent = indent > 4 ? 1 : indent;
      itemContents = line.slice(indent);
      indent += bulletIndent;
    }
    if (blankLine && RE_BLANK_LINE.test(nextLine)) {
      src = src.substring(nextLine.length + 1);
      endEarly = true;
    }
    if (!endEarly) {
      const nextBulletRe = nextBulletRegex(indent);
      const hrRe = hrRegex(indent);
      const fencesBeginRe = fencesBeginRegex(indent);
      const headingBeginRe = headingBeginRegex(indent);
      const htmlBeginRe = htmlBeginRegex(indent);
      const blockquoteBeginRe = blockquoteBeginRegex(indent);
      const parts = [itemContents];
      while (src) {
        const rawLine = firstLineOf(src);
        const nextLine = rawLine;
        const nextLineWithoutTabs = expandLeadingTabs(nextLine);
        const first = lineFirstChar(nextLine, indent);
        if ((first === '`' || first === '~') && fencesBeginRe.test(nextLine)) break;
        if (first === '#' && headingBeginRe.test(nextLine)) break;
        if (first === '<' && htmlBeginRe.test(nextLine)) break;
        if (first === '>' && blockquoteBeginRe.test(nextLine)) break;
        if ((first === '*' || first === '+' || first === '-' || (first >= '0' && first <= '9')) && nextBulletRe.test(nextLine)) break;
        if ((first === '-' || first === '*' || first === '_') && hrRe.test(nextLine)) break;
        // First non-space position of the dedented line (a tab counts,
        // as it does for /[^ ]/), and whether the line is blank, found
        // in one pass without a regex or a trim allocation. A non-ASCII
        // character falls back to trim(), which knows Unicode whitespace.
        let firstNonSpace = -1;
        let hasNonWs = false;
        let exotic = false;
        for (let k = 0; k < nextLineWithoutTabs.length; k++) {
          const ch = nextLineWithoutTabs[k];
          if (ch !== ' ' && firstNonSpace === -1) firstNonSpace = k;
          if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') continue;
          if (ch.charCodeAt(0) > 127) { exotic = true; break; }
          hasNonWs = true;
          break;
        }
        const lineIsBlank = exotic ? !nextLine.trim() : !hasNonWs;
        if (firstNonSpace >= indent || firstNonSpace === -1 || lineIsBlank) {
          parts.push(nextLineWithoutTabs.slice(indent));
        } else {
          if (blankLine) break;
          // Is the current line indented code (first non-space at or
          // past column 4, counting each tab as four spaces)? A line of
          // pure whitespace has no first non-space character, so it is
          // not indented code.
          let col = 0;
          let foundNonWs = false;
          for (let k = 0; k < line.length; k++) {
            const ch = line[k];
            if (ch === ' ') col += 1;
            else if (ch === '\t') col += 4;
            else { foundNonWs = true; break; }
          }
          if (foundNonWs && col >= 4) break;
          const lineFirst = lineFirstChar(line, indent);
          if ((lineFirst === '`' || lineFirst === '~') && fencesBeginRe.test(line)) break;
          if (lineFirst === '#' && headingBeginRe.test(line)) break;
          if (lineFirst === '<' && htmlBeginRe.test(line)) break;
          if ((lineFirst === '-' || lineFirst === '*' || lineFirst === '_') && hrRe.test(line)) break;
          // A lazy continuation can look like a setext underline after
          // list indentation is removed. Keep it in the paragraph.
          const setextContinuation = /^ {0,3}(?:=+|-+) *$/.test(nextLine)
            && RE_LHEADING.test(`${line}\n${nextLine}`);
          parts.push(setextContinuation
            ? `    ${nextLineWithoutTabs.replace(/^ {0,3}/, '')}`
            : nextLine);
        }
        blankLine = lineIsBlank;
        src = src.substring(rawLine.length + 1);
        line = nextLineWithoutTabs.slice(indent);
      }
      itemContents = parts.join('\n');
    }
    const raw = listSrc.slice(itemStart, taken());
    if (!list.loose) {
      if (endsWithBlankLine) list.loose = true;
      else if (RE_DOUBLE_BLANK.test(raw)) endsWithBlankLine = true;
    }
    list.items.push({
      type: 'list_item',
      raw,
      task: RE_LIST_IS_TASK.test(itemContents),
      loose: false,
      text: itemContents,
      tokens: [],
    });
  }
  const lastItem = list.items.at(-1);
  if (lastItem) {
    lastItem.raw = lastItem.raw.trimEnd();
    lastItem.text = lastItem.text.trimEnd();
  } else {
    return undefined;
  }
  list.raw = listSrc.slice(0, taken()).trimEnd();
  for (const item of list.items) {
    lexer.state.top = false;
    item.tokens = lexer.blockTokens(item.text, []);
    if (!list.loose) {
      const spacers = item.tokens.filter((t) => t.type === 'space');
      const hasMultipleLineBreaks = spacers.length > 0 && spacers.some((t) => RE_ANY_LINE.test(t.raw));
      list.loose = hasMultipleLineBreaks;
    }
  }
  for (const item of list.items) {
    const itemToken = item.tokens[0];
    if (item.task && (itemToken?.type === 'text' || itemToken?.type === 'paragraph')) {
      item.text = item.text.replace(RE_LIST_REPLACE_TASK, '');
      itemToken.raw = itemToken.raw.replace(RE_LIST_REPLACE_TASK, '');
      itemToken.text = itemToken.text.replace(RE_LIST_REPLACE_TASK, '');
      for (let i = lexer.inlineQueue.length - 1; i >= 0; i--) {
        if (RE_LIST_IS_TASK.test(lexer.inlineQueue[i].src)) {
          lexer.inlineQueue[i].src = lexer.inlineQueue[i].src.replace(RE_LIST_REPLACE_TASK, '');
          break;
        }
      }
      const taskRaw = RE_LIST_CHECKBOX.exec(item.raw);
      if (taskRaw) {
        const checkboxToken = { type: 'checkbox', raw: taskRaw[0] + ' ', checked: taskRaw[0] !== '[ ]' };
        item.checked = checkboxToken.checked;
        if (list.loose) {
          if (item.tokens[0] && ['paragraph', 'text'].includes(item.tokens[0].type) && 'tokens' in item.tokens[0] && item.tokens[0].tokens) {
            item.tokens[0].raw = checkboxToken.raw + item.tokens[0].raw;
            item.tokens[0].text = checkboxToken.raw + item.tokens[0].text;
            item.tokens[0].tokens.unshift(checkboxToken);
          } else {
            item.tokens.unshift({ type: 'paragraph', raw: checkboxToken.raw, text: checkboxToken.raw, tokens: [checkboxToken] });
          }
        } else {
          item.tokens.unshift(checkboxToken);
        }
      }
    } else if (item.task) {
      item.task = false;
    }
  }
  if (list.loose) {
    for (const item of list.items) {
      item.loose = true;
      for (const token of item.tokens) {
        if (token.type === 'text') token.type = 'paragraph';
      }
    }
  }
  return list;
}

function htmlToken(src) {
  const cap = RE_HTML.exec(src);
  if (!cap) return undefined;
  const raw = trimTrailingBlankLines(cap[0]);
  return {
    type: 'html',
    block: true,
    raw,
    pre: cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style',
    text: raw,
  };
}

function defToken(src) {
  const cap = RE_DEF.exec(src);
  if (!cap) return undefined;
  // Outside angle brackets a link destination holds only balanced parens.
  if (!RE_START_ANGLE.test(cap[2]) && findClosingBracket(cap[2], '()') !== -1) return undefined;
  const tag = normalizeLabel(cap[1]);
  const href = cap[2] ? cap[2].replace(RE_HREF_BRACKETS, '$1').replace(RE_ANY_PUNCT, '$1') : '';
  const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(RE_ANY_PUNCT, '$1') : cap[3];
  return { type: 'def', tag, raw: rtrim(cap[0], '\n'), href, title };
}

function tableToken(src, lexer) {
  const cap = RE_TABLE.exec(src);
  if (!cap) return undefined;
  if (!RE_TABLE_DELIM.test(cap[2])) return undefined;
  const headers = splitCells(cap[1]);
  const aligns = cap[2].replace(RE_TABLE_ALIGN_CHARS, '').split('|');
  const rows = cap[3]?.trim() ? cap[3].replace(RE_TABLE_ROW_BLANK, '').split('\n') : [];
  const item = { type: 'table', raw: rtrim(cap[0], '\n'), header: [], align: [], rows: [] };
  if (headers.length !== aligns.length) return undefined;
  for (const align of aligns) {
    if (RE_TABLE_ALIGN_RIGHT.test(align)) item.align.push('right');
    else if (RE_TABLE_ALIGN_CENTER.test(align)) item.align.push('center');
    else if (RE_TABLE_ALIGN_LEFT.test(align)) item.align.push('left');
    else item.align.push(null);
  }
  for (let i = 0; i < headers.length; i++) {
    item.header.push({ text: headers[i], tokens: lexer.inline(headers[i]), header: true, align: item.align[i] });
  }
  for (const row of rows) {
    item.rows.push(splitCells(row, item.header.length).map((cell, i) => ({
      text: cell,
      tokens: lexer.inline(cell),
      header: false,
      align: item.align[i],
    })));
  }
  return item;
}

function lheadingToken(src, lexer) {
  const cap = RE_LHEADING.exec(src);
  if (!cap) return undefined;
  const text = cap[1].trim();
  return {
    type: 'heading',
    raw: rtrim(cap[0], '\n'),
    depth: cap[2].charAt(0) === '=' ? 1 : 2,
    text,
    tokens: lexer.inline(text),
  };
}

function paragraphToken(src, lexer) {
  const cap = RE_PARAGRAPH.exec(src);
  if (!cap) return undefined;
  const text = cap[1].charAt(cap[1].length - 1) === '\n' ? cap[1].slice(0, -1) : cap[1];
  return { type: 'paragraph', raw: cap[0], text, tokens: lexer.inline(text) };
}

function textToken(src, lexer) {
  const cap = RE_BLOCK_TEXT.exec(src);
  if (!cap) return undefined;
  return { type: 'text', raw: cap[0], text: cap[0], tokens: lexer.inline(cap[0]) };
}

/* ------------------------------------------------------------------ */
/* Inline tokenizers                                                  */
/* ------------------------------------------------------------------ */

function escapeToken(src) {
  const cap = RE_ESCAPE.exec(src);
  if (!cap) return undefined;
  return { type: 'escape', raw: cap[0], text: cap[1] };
}

function tagToken(src, lexer) {
  const cap = RE_TAG.exec(src);
  if (!cap) return undefined;
  if (!lexer.state.inLink && RE_START_A_TAG.test(cap[0])) lexer.state.inLink = true;
  else if (lexer.state.inLink && RE_END_A_TAG.test(cap[0])) lexer.state.inLink = false;
  if (!lexer.state.inRawBlock && RE_START_PRE_TAG.test(cap[0])) lexer.state.inRawBlock = true;
  else if (lexer.state.inRawBlock && RE_END_PRE_TAG.test(cap[0])) lexer.state.inRawBlock = false;
  return { type: 'html', raw: cap[0], inLink: lexer.state.inLink, inRawBlock: lexer.state.inRawBlock, block: false, text: cap[0] };
}

function linkToken(src, lexer) {
  // The link regex backtracks quadratically over unterminated-link inputs
  // like '[a](b'.repeat(n): inlineTokens anchors one paren scan per run
  // in state.linkParenPossible; when it is false the regex cannot match.
  if (lexer.state.linkParenPossible === false) return undefined;
  const cap = RE_LINK.exec(src);
  if (!cap) return undefined;
  const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
  if (isLabelEndInsideToken(src, cap[1], labelStart)) return undefined;
  const trimmedUrl = cap[2].trim();
  if (RE_START_ANGLE.test(trimmedUrl)) {
    if (!RE_END_ANGLE.test(trimmedUrl)) return undefined;
    // The ending angle bracket cannot be escaped.
    const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
    if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) return undefined;
  } else {
    const lastParenIndex = findClosingBracket(cap[2], '()');
    if (lastParenIndex === -2) return undefined;
    if (lastParenIndex > -1) {
      const start = cap[0].indexOf('!') === 0 ? 5 : 4;
      const linkLen = start + cap[1].length + lastParenIndex;
      cap[2] = cap[2].substring(0, lastParenIndex);
      cap[0] = cap[0].substring(0, linkLen).trim();
      cap[3] = '';
    }
  }
  // The ')' that ends the match is the link closer only when it is not
  // escaped. `[foo](/url\)` has no closer; that paren is destination text.
  const unescaped = rtrim(cap[0].slice(0, -1), '\\');
  if ((cap[0].length - unescaped.length) % 2 === 0) return undefined;
  let href = cap[2];
  const title = cap[3] ? cap[3].slice(1, -1) : '';
  href = href.trim();
  if (RE_START_ANGLE.test(href)) href = href.slice(1, -1);
  return outputLink(cap, {
    href: href ? href.replace(RE_ANY_PUNCT, '$1') : href,
    title: title ? title.replace(RE_ANY_PUNCT, '$1') : title,
  }, cap[0], lexer);
}

function reflinkToken(src, links, lexer) {
  let cap;
  if ((cap = RE_REFLINK.exec(src)) || (cap = RE_NOLINK.exec(src))) {
    const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
    if (isLabelEndInsideToken(src, cap[1], labelStart)) return undefined;
    const link = links[normalizeLabel(cap[2] || cap[1])];
    if (!link) {
      const text = cap[0].charAt(0);
      return { type: 'text', raw: text, text };
    }
    return outputLink(cap, link, cap[0], lexer);
  }
  return undefined;
}

function emStrongToken(src, lexer, run, prevChar = '') {
  let match = RE_EM_STRONG_LDELIM.exec(src);
  if (!match) return undefined;
  if (!match[1] && !match[2] && !match[3] && !match[4]) return undefined;
  const delimChar = match[0][0];
  // A mid-run opener (for example the second star of an unmatched `**`)
  // must only pair with a delimiter that can only close, otherwise it
  // steals the opener of a later span.
  const midRun = prevChar === delimChar;
  const maskedFull = lexer.ensureMask(run);
  // The start of this delimiter run may already be behind src, either
  // taken as text after the whole run failed to match or used to close an
  // earlier span. Flanking and rules 9-10 are about the whole run, so
  // find its start.
  const srcStart = maskedFull.length - src.length;
  let runStart = srcStart;
  while (runStart > 0 && maskedFull[runStart - 1] === delimChar) runStart--;
  const runPrevChar = lastCodePoint(maskedFull.slice(Math.max(0, runStart - 2), runStart));
  const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || !!RE_PUNCTUATION.exec(runPrevChar);
  if (runStart < srcStart) prevChar = runPrevChar;
  const prevPunct = runStart < srcStart ? runPrevPunct : !!RE_PUNCTUATION.exec(prevChar);
  // _ can't be between two alphanumerics.
  if (match[4] && prevChar.match(RE_UNICODE_ALNUM)) return undefined;
  const nextChar = match[1] || match[3] || '';
  if (!nextChar || !prevChar || prevPunct) {
    const lLength = codePointLength(match[0]) - 1;
    let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;
    // Rules 9-10 count the whole run, and also apply when the opener could
    // close as well (`a*b**`, where `*` is both left- and right-flanking).
    const runLength = srcStart - runStart + lLength;
    const openerCanClose = !!runPrevChar.trim()
      && (!!nextChar || (delimChar === '*' && !runPrevPunct));
    if (delimChar !== '*' && delimChar !== '_') return undefined;
    const endReg = delimChar === '*' ? RE_EM_STRONG_RDELIM_AST : RE_EM_STRONG_RDELIM_UND;
    const lastPossible = run.hints.lastEm[delimChar];
    const closerWindowStart = maskedFull.length - src.length + lLength;
    if (lastPossible < closerWindowStart) return undefined;
    let maskedSrc = maskedFull.slice(-1 * src.length + lLength);
    const lastPossibleInWindow = lastPossible - closerWindowStart;
    endReg.lastIndex = 0;
    while ((match = endReg.exec(maskedSrc)) !== null) {
      if (match.index > lastPossibleInWindow) break;
      rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      if (!rDelim) continue; // skip single * in __abc*abc__
      rLength = rDelim.length; // delimiter runs are ASCII
      if (match[3] || match[4]) { // found another Left Delim
        delimTotal += rLength;
        continue;
      } else if (match[5] || match[6] || openerCanClose) { // either Left or Right Delim
        if (midRun && (match[5] || match[6])) break;
        if (runLength % 3 && !((runLength + rLength) % 3)) {
          midDelimTotal += rLength;
          continue; // CommonMark Emphasis Rules 9-10
        }
      }
      delimTotal -= rLength;
      if (delimTotal > 0) continue; // Haven't found enough closing delimiters
      // Remove extra characters. *a*** -> *a*
      rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
      const lastCharLength = firstCodePointLength(match[0]);
      const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
      // Create `em` if smallest delimiter has odd char count. *a***
      if (Math.min(lLength, rLength) % 2) {
        const text = raw.slice(1, -1);
        return { type: 'em', raw, text, tokens: lexer.inlineTokens(text) };
      }
      // Create 'strong' if smallest delimiter has even char count. **a***
      const text = raw.slice(2, -2);
      return { type: 'strong', raw, text, tokens: lexer.inlineTokens(text) };
    }
  }
  return undefined;
}

function codespanToken(src) {
  const cap = RE_INLINE_CODE.exec(src);
  if (!cap) return undefined;
  let text = cap[2].replace(RE_NEWLINE_GLOBAL, ' ');
  const hasNonSpaceChars = RE_NON_SPACE.test(text);
  const hasSpaceCharsOnBothEnds = RE_STARTING_SPACE.test(text) && RE_ENDING_SPACE.test(text);
  if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) text = text.substring(1, text.length - 1);
  return { type: 'codespan', raw: cap[0], text };
}

function brToken(src) {
  const cap = RE_BR.exec(src);
  if (!cap) return undefined;
  return { type: 'br', raw: cap[0] };
}

function delToken(src, lexer, run, prevChar = '') {
  let match = RE_DEL_LDELIM.exec(src);
  if (!match) return undefined;
  const nextChar = match[1] || '';
  if (!nextChar || !prevChar || RE_PUNCTUATION.exec(prevChar)) {
    const lLength = codePointLength(match[0]) - 1;
    let rDelim, rLength, delimTotal = lLength;
    const endReg = RE_DEL_RDELIM;
    const maskedFull = lexer.ensureMask(run);
    const lastPossible = run.hints.lastDel;
    const closerWindowStart = maskedFull.length - src.length + lLength;
    if (lastPossible < closerWindowStart) return undefined;
    let maskedSrc = maskedFull.slice(-1 * src.length + lLength);
    const lastPossibleInWindow = lastPossible - closerWindowStart;
    endReg.lastIndex = 0;
    while ((match = endReg.exec(maskedSrc)) !== null) {
      if (match.index > lastPossibleInWindow) break;
      rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      if (!rDelim) continue;
      rLength = rDelim.length; // delimiter runs are ASCII
      if (rLength !== lLength) continue;
      if (match[3] || match[4]) { // found another Left Delim
        delimTotal += rLength;
        continue;
      }
      delimTotal -= rLength;
      if (delimTotal > 0) continue; // Haven't found enough closing delimiters
      rLength = Math.min(rLength, rLength + delimTotal);
      const lastCharLength = firstCodePointLength(match[0]);
      const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
      const text = raw.slice(lLength, -lLength);
      return { type: 'del', raw, text, tokens: lexer.inlineTokens(text) };
    }
  }
  return undefined;
}

function autolinkToken(src) {
  const cap = RE_AUTOLINK.exec(src);
  if (!cap) return undefined;
  let text, href;
  if (cap[2] === '@') {
    text = cap[1];
    href = 'mailto:' + text;
  } else {
    text = cap[1];
    href = text;
  }
  return {
    type: 'link',
    raw: cap[0],
    text,
    href,
    autolink: true,
    tokens: [{ type: 'text', raw: text, text }],
  };
}

function urlToken(src) {
  const cap = RE_URL.exec(src);
  if (!cap) return undefined;
  let text, href;
  if (cap[2] === '@') {
    text = cap[0];
    href = 'mailto:' + text;
  } else {
    // Extended autolink path validation.
    let prevCapZero;
    do {
      prevCapZero = cap[0];
      cap[0] = RE_BACKPEDAL.exec(cap[0])?.[0] ?? '';
    } while (prevCapZero !== cap[0]);
    text = cap[0];
    href = cap[1] === 'www.' ? 'http://' + cap[0] : cap[0];
  }
  return {
    type: 'link',
    raw: cap[0],
    text,
    href,
    autolink: true,
    tokens: [{ type: 'text', raw: text, text }],
  };
}

function inlineTextToken(src, lexer) {
  const cap = RE_INLINE_TEXT.exec(src);
  if (!cap) return undefined;
  const escaped = lexer.state.inRawBlock;
  return {
    type: 'text',
    raw: cap[0],
    // Raw HTML keeps whatever it was written with, everywhere else a
    // numeric character reference stands for the character itself.
    text: escaped ? cap[0] : decodeNumericRefs(cap[0]),
    escaped,
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                          */
/* ------------------------------------------------------------------ */

// Plain-text rendering used for image alt text: only the textual part of
// each token survives.
function renderText(tokens) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
      case 'image':
        out += token.tokens ? renderText(token.tokens) : token.text;
        break;
      case 'codespan':
      case 'escape':
      case 'html':
      case 'text':
        out += token.text;
        break;
      case 'br':
        break;
      case 'checkbox':
        out += token.raw;
        break;
      default:
        break;
    }
  }
  return out;
}

function renderInline(tokens) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case 'escape':
      case 'text': {
        out += 'tokens' in token && token.tokens
          ? renderInline(token.tokens)
          : ('escaped' in token && token.escaped ? token.text : escapeHtml(token.text));
        break;
      }
      case 'html':
        out += token.text;
        break;
      case 'link': {
        // References are not resolved inside an autolink, so every `&`
        // there is literal. Elsewhere only an `&` that cannot start one
        // needs escaping.
        const parsedText = token.autolink ? escapeHtml(token.text, true) : renderInline(token.tokens);
        const cleanHref = cleanUrl(token.href);
        if (cleanHref === null) {
          out += parsedText;
          break;
        }
        const href = escapeHtml(cleanHref, token.autolink);
        out += '<a href="' + href + '"';
        if (token.title) out += ' title="' + escapeHtml(token.title) + '"';
        out += '>' + parsedText + '</a>';
        break;
      }
      case 'image': {
        let text = token.text;
        if (token.tokens) text = renderText(token.tokens);
        const cleanHref = cleanUrl(token.href);
        if (cleanHref === null) {
          out += escapeHtml(text);
          break;
        }
        const href = cleanHref;
        out += `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"`;
        if (token.title) out += ` title="${escapeHtml(token.title)}"`;
        out += '>';
        break;
      }
      case 'checkbox':
        out += '<input ' + (token.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
        break;
      case 'strong':
        out += `<strong>${renderInline(token.tokens)}</strong>`;
        break;
      case 'em':
        out += `<em>${renderInline(token.tokens)}</em>`;
        break;
      case 'codespan':
        out += `<code>${escapeHtml(token.text, true)}</code>`;
        break;
      case 'br':
        out += '<br>';
        break;
      case 'del':
        out += `<del>${renderInline(token.tokens)}</del>`;
        break;
      default:
        throw new Error('Token with "' + token.type + '" type was not found.');
    }
  }
  return out;
}

function renderListItem(item) {
  return `<li>${renderTokens(item.tokens)}</li>\n`;
}

function renderTokens(tokens) {
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'hr':
        out += '<hr>\n';
        break;
      case 'heading':
        out += `<h${token.depth}>${renderInline(token.tokens)}</h${token.depth}>\n`;
        break;
      case 'code': {
        const langString = (token.lang || '').match(RE_NOT_SPACE_START)?.[0];
        const code = token.text ? token.text.replace(RE_ENDING_NEWLINE, '') + '\n' : '';
        if (!langString) {
          out += '<pre><code>' + escapeHtml(code, true) + '</code></pre>\n';
        } else {
          out += '<pre><code class="language-' + escapeHtml(langString) + '">'
            + escapeHtml(code, true) + '</code></pre>\n';
        }
        break;
      }
      case 'table': {
        let header = '';
        for (let j = 0; j < token.header.length; j++) {
          const cell = token.header[j];
          const content = renderInline(cell.tokens);
          const type = cell.header ? 'th' : 'td';
          const tag = cell.align ? `<${type} align="${cell.align}">` : `<${type}>`;
          header += tag + content + `</${type}>\n`;
        }
        header = `<tr>\n${header}</tr>\n`;
        let body = '';
        for (let j = 0; j < token.rows.length; j++) {
          const row = token.rows[j];
          let cell = '';
          for (let k = 0; k < row.length; k++) {
            const content = renderInline(row[k].tokens);
            const type = row[k].header ? 'th' : 'td';
            const tag = row[k].align ? `<${type} align="${row[k].align}">` : `<${type}>`;
            cell += tag + content + `</${type}>\n`;
          }
          body += `<tr>\n${cell}</tr>\n`;
        }
        if (body) body = `<tbody>${body}</tbody>`;
        out += '<table>\n' + '<thead>\n' + header + '</thead>\n' + body + '</table>\n';
        break;
      }
      case 'blockquote':
        out += `<blockquote>\n${renderTokens(token.tokens)}</blockquote>\n`;
        break;
      case 'list': {
        let body = '';
        for (let j = 0; j < token.items.length; j++) body += renderListItem(token.items[j]);
        const type = token.ordered ? 'ol' : 'ul';
        const startAttr = (token.ordered && token.start !== 1) ? (' start="' + token.start + '"') : '';
        out += '<' + type + startAttr + '>\n' + body + '</' + type + '>\n';
        break;
      }
      case 'checkbox':
        out += '<input ' + (token.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
        break;
      case 'html':
        out += token.text;
        break;
      case 'paragraph':
        out += `<p>${renderInline(token.tokens)}</p>\n`;
        break;
      case 'text':
        out += renderInline(token.tokens);
        break;
      default:
        throw new Error('Token with "' + token.type + '" type was not found.');
    }
  }
  return out;
}

/** The HTML marked 18.1.3 renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  const lexer = new Lexer();
  const tokens = lexer.lex(markdown);
  return renderTokens(tokens);
}
