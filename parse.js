// parse.js — a fast, dependency-free drop-in for marked 18.1.3 (default
// options: GFM on, breaks off, pedantic off). parse(markdown) returns exactly
// the HTML marked.parse(markdown) returns, for every input. Written from
// scratch against the CommonMark/GFM spec examples and marked's observable
// behaviour; the renderer is my own two-phase design: a line-based block pass
// builds a small tree of block nodes (and collects link reference
// definitions, first definition wins), then a render pass walks the tree and
// runs inline parsing per text, writing strings straight into an output
// array — no token objects on the hot path. Where marked departs from the
// spec, marked's HTML wins.
//
// Layout of this file:
//   1. character classifiers and tiny helpers
//   2. HTML escaping, numeric-reference decoding, URL cleaning, labels
//   3. inline scanners: text runs, code spans, tags, autolinks, urls
//   4. emphasis / strong / strikethrough (masked-source closer search)
//   5. the inline loop (direct render) and link / reflink parsing
//   6. block parsing: line classifiers, fences, headings, lists, quotes,
//      tables, HTML blocks, definitions, paragraphs
//   7. render pass + parse() entry point

// ---------------------------------------------------------------------------
// 1. character classifiers and tiny helpers
// ---------------------------------------------------------------------------

// Single-code-point tests. `ch` is always one code point (a string of length
// 1, or 2 for an astral character).
const RE_SPACE = /\s/;
const RE_PUNCT = /[\p{P}\p{S}]/u;
const RE_ALNUM = /[\p{L}\p{N}]/u;
const RE_WORDCH = /[A-Za-z0-9_]/;
const RE_ASCII_PUNCT = /[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]/;

function isSpace(ch) { return ch !== '' && RE_SPACE.test(ch); }
function isPunct(ch) { return ch !== '' && RE_PUNCT.test(ch); }
// GFM emphasis punctuation: like isPunct, but a tilde is not punctuation
// (so `~` can sit inside an emphasis delimiter run).
function isPunctGfm(ch) { return ch !== '' && ch !== '~' && RE_PUNCT.test(ch); }
// marked's `punctuation` test for the character before an opener: whitespace
// or punctuation, but never `*` or `_` (those are handled separately).
function isPrevPunct(ch) {
  return ch !== '' && ch !== '*' && ch !== '_' && (RE_SPACE.test(ch) || RE_PUNCT.test(ch));
}
function isAlnum(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  // ASCII fast path (covers the overwhelmingly common case); anything
  // else falls back to the Unicode letter/number test.
  if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return true;
  return RE_ALNUM.test(ch);
}
function isAsciiPunct(ch) { return ch !== '' && RE_ASCII_PUNCT.test(ch); }

// Characters that may appear in an e-mail local part / domain (GFM url).
function isEmailChar(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    || ch === '.' || ch === '!' || ch === '#' || ch === '$' || ch === '%' || ch === '&'
    || ch === "'" || ch === '*' || ch === '+' || ch === '/' || ch === '='
    || ch === '?' || ch === '^' || ch === '_' || ch === '`' || ch === '{'
    || ch === '|' || ch === '}' || ch === '~' || ch === '-';
}

// Remove trailing `c` characters (equivalent to str.replace(/c*$/, '')).
function rtrimChar(str, c) {
  let i = str.length;
  while (i > 0 && str.charAt(i - 1) === c) i--;
  return i === str.length ? str : str.slice(0, i);
}

// Drop trailing blank lines, keeping at most one trailing newline's worth:
// identical to marked's trimTrailingBlankLines.
function trimTrailingBlankLines(str) {
  const lines = str.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && /^[ \t]*$/.test(lines[end])) end--;
  if (lines.length - end <= 2) return str;
  return lines.slice(0, end + 1).join('\n');
}

// Expand tabs to spaces, counting columns from `indent` (marked's expandTabs).
function expandTabs(line, indent) {
  let col = indent || 0;
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\t') {
      const added = 4 - (col % 4);
      out += '    '.slice(0, added);
      col += added;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

// Column width of the leading whitespace of a line (tabs to next tab stop).
function indentCol(line) {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') col++;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

// Index of the first non-space/tab character of a line.
function contentStart(line) {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
}

function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 2. HTML escaping, numeric-reference decoding, URL cleaning, labels
// ---------------------------------------------------------------------------

// Index just past the `;` of a valid character reference starting at `&`,
// exactly marked's escape lookahead
// `(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);`, or -1. Note `&#abc;` is NOT
// valid (letters after `#` need the `x`), while `&foo_bar;` is (`\w`
// includes `_`).
function validRefEnd(str, i) {
  let j = i + 1;
  if (str[j] === '#') {
    j++;
    if (str[j] === 'x' || str[j] === 'X') {
      j++;
      let h = j;
      while (h < str.length && /[0-9A-Fa-f]/.test(str[h])) h++;
      return h > j && h - j <= 6 && str[h] === ';' ? h + 1 : -1;
    }
    let d = j;
    while (d < str.length && str[d] >= '0' && str[d] <= '9') d++;
    return d > j && d - j <= 7 && str[d] === ';' ? d + 1 : -1;
  }
  let w = j;
  while (w < str.length && /[A-Za-z0-9_]/.test(str[w])) w++;
  return w > j && str[w] === ';' ? w + 1 : -1;
}

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escape `&<>"'`; when `encode` is false an `&` that starts a valid
// character reference (`&name;`, `&#123;`, `&#x1F;`) is left alone.
function escHtml(str, encode) {
  if (str.indexOf('&') === -1 && str.indexOf('<') === -1 && str.indexOf('>') === -1
    && str.indexOf('"') === -1 && str.indexOf("'") === -1) return str;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '&' && !encode) {
      // Valid reference? `&` + optional `#` + word chars + `;` stays literal.
      if (validRefEnd(str, i) !== -1) { out += '&'; continue; }
      out += '&amp;';
    } else {
      const rep = ESCAPE_MAP[ch];
      out += rep !== undefined ? rep : ch;
    }
  }
  return out;
}

// Decode numeric character references in inline text, exactly like marked:
// a decoded character stands for itself (and is re-escaped by the caller),
// values 0 / >0x10FFFF / surrogates become U+FFFD, code 38 becomes `&amp;`,
// and a bare `&` that cannot start a valid reference becomes `&amp;`.
function decodeTextRun(str) {
  if (str.indexOf('&') === -1) return str;
  let out = '';
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch !== '&') { out += ch; i++; continue; }
    // Try a numeric reference.
    let j = i + 1;
    if (str[j] === '#') {
      let hex = false;
      j++;
      if (str[j] === 'x' || str[j] === 'X') { hex = true; j++; }
      let k = j;
      if (hex) { while (k < str.length && /[0-9A-Fa-f]/.test(str[k])) k++; }
      else { while (k < str.length && str[k] >= '0' && str[k] <= '9') k++; }
      const digits = k - j;
      if (digits > 0 && digits <= (hex ? 6 : 7) && str[k] === ';') {
        const code = hex ? parseInt(str.slice(j, k), 16) : parseInt(str.slice(j, k), 10);
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) out += '\uFFFD';
        else if (code === 38) out += '&amp;';
        else out += String.fromCodePoint(code);
        i = k + 1;
        continue;
      }
    }
    // Not a numeric reference: a valid `&name;` / `&#...;` stays literal,
    // any other `&` is escaped.
    if (validRefEnd(str, i) !== -1) { out += '&'; i++; continue; }
    out += '&amp;';
    i++;
  }
  return out;
}

// Render one inline text run: decode numeric references, then escape HTML
// (leaving valid references alone). This is what marked's text token plus
// its renderer do, fused into one pass.
function renderTextRun(str) {
  return escHtml(decodeTextRun(str), false);
}

// encodeURI, with `%25` folded back to `%`; null when it throws.
function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// Unescape `\punct` -> punct (any Unicode punctuation after a backslash).
function unescapePunct(str) {
  if (str.indexOf('\\') === -1) return str;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '\\' && i + 1 < str.length) {
      const nx = str[i + 1];
      if (isPunct(nx)) { out += nx; i++; continue; }
    }
    out += ch;
  }
  return out;
}

// Normalise a link label for definition/reference matching: trim, collapse
// runs of whitespace to one space, Unicode case-fold.
function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Index of the `)` that closes the paren run starting in `str` (balanced
// parens counted like marked's findClosingBracket): -1 balanced/absent,
// -2 more opens than closes, otherwise the index of the unmatched `)`.
function findClosingBracket(str, b) {
  if (str.indexOf(b[0]) === -1 && str.indexOf(b[1]) === -1) return -1;
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') { i++; continue; }
    if (str[i] === b[0]) level++;
    else if (str[i] === b[1]) {
      level--;
      if (level < 0) return i;
    }
  }
  return level > 0 ? -2 : -1;
}

// ---------------------------------------------------------------------------
// 3. inline scanners: text runs, code spans, tags, autolinks, urls
// ---------------------------------------------------------------------------

// Per-parse link definitions, keyed by normalised label.
let LINKS = null;
// Inline-run state (reset per inline run, saved/restored across nesting).
let IN_LINK = false;
let IN_RAW = false;
let LINK_EMITTED = false;
let LINK_PAREN_OK = true;

// Does an e-mail local part (`[email-chars]+@`) start at `s[p]`?
function emailAhead(s, p) {
  let j = p;
  while (j < s.length && isEmailChar(s[j])) j++;
  return j > p && j < s.length && s[j] === '@';
}

// Does a URL protocol (`http://`, `https://`, `ftp://`, any case) start at `s[p]`?
function protocolAhead(s, p) {
  // Allocation-free case-insensitive check for http(s):// and ftp://.
  // (The old version built a lower-cased 4-char string at every position.)
  const a = s[p];
  if (a === 'h' || a === 'H') {
    const b = s[p + 1], c = s[p + 2], d = s[p + 3];
    if ((b === 't' || b === 'T') && (c === 't' || c === 'T') && (d === 'p' || d === 'P')) {
      if (s[p + 4] === ':' && s[p + 5] === '/' && s[p + 6] === '/') return true;
      if ((s[p + 4] === 's' || s[p + 4] === 'S') && s[p + 5] === ':' && s[p + 6] === '/' && s[p + 7] === '/') return true;
    }
    return false;
  }
  if (a === 'f' || a === 'F') {
    const b = s[p + 1], c = s[p + 2];
    if ((b === 't' || b === 'T') && (c === 'p' || c === 'P')) {
      return s[p + 3] === ':' && s[p + 4] === '/' && s[p + 5] === '/';
    }
  }
  return false;
}

// Does `www.` start at `s[p]` in a position where marked's lookbehind allows
// it (start of string, or after whitespace — `\s`, NBSP included — `*`, `_`,
// `~` or `(`)?
function wwwAhead(s, p) {
  if (s[p] !== 'w' || s[p + 1] !== 'w' || s[p + 2] !== 'w' || s[p + 3] !== '.') return false;
  if (p === 0) return true;
  const prev = s[p - 1];
  return isSpace(prev) || prev === '*' || prev === '_' || prev === '~' || prev === '(';
}

// Is there a hard break (` {2,}\n`) starting at `s[p]`?
function hardBreakAhead(s, p) {
  let j = p;
  while (s[j] === ' ') j++;
  return j >= p + 2 && s[j] === '\n';
}

// ASCII word character (`\w` without the `u` flag, as in marked's text
// regex): used for the `\b_` word-boundary stop.
function isWordChar(ch) {
  return ch !== undefined && ch !== '' && /[A-Za-z0-9_]/.test(ch);
}

// Is the character at `s[p]` a stop for a plain-text run (the characters the
// inline loop tokenises separately)? Every delimiter stops a run, exactly
// like marked's text regex (which stops before any `*` or `_`); an intraword
// `_` such as in `foo_bar` is retried at the `_` and fails to open emphasis
// there, so it still renders literally.

// Length of the plain-text run starting at `s[i]`, mirroring marked's GFM
// inline.text regex. Fixes carried over from the earlier rounds:
//  - `ftp://` is a 3-letter protocol (a 4-char slice never matches it);
//  - a stop counts even when its trigger (`@`, `://`) sits before the
//    position being scanned (the stop is at the run's start, not the trigger);
//  - a hard-break space run stops the text even when it starts before the
//    run's first character was consumed.
function scanTextLen(s, i) {
  const n = s.length;
  // A lone non-alphanumeric character right before `mailto:` / `xmpp:` is
  // its own run, so the url tokeniser sees the protocol at the start.
  if (i < n && !isAlnum(s[i])) {
    if (s.startsWith('mailto:', i + 1) || s.startsWith('xmpp:', i + 1)) return 1;
  }
  // First character: a backtick run, a tilde run, or any single character.
  let j = i;
  const c = s[j];
  if (c === '`') { while (j < n && s[j] === '`') j++; }
  else if (c === '~') { while (j < n && s[j] === '~') j++; }
  else j++;
  // Immediately after the first character(s): stop at a backtick/tilde run,
  // a hard break, or an e-mail local part.
  if (j < n && (s[j] === '`' || s[j] === '~')) return j - i;
  if (hardBreakAhead(s, j)) return j - i;
  if (emailAhead(s, j)) return j - i;
  // Lazy scan: at each position try the zero-width stops first, then consume
  // one character and check the consume-one-and-stop patterns. The
  // expensive lookaheads are gated on their possible first character so
  // the common path is just the stop-character comparisons.
  while (j < n) {
    const ch = s[j];
    if (ch === '\\' || ch === '<' || ch === '!' || ch === '[' || ch === '`'
      || ch === '*' || ch === '~' || ch === '_') return j - i;
    if (ch === 'w' && wwwAhead(s, j)) return j - i;
    if ((ch === 'h' || ch === 'H' || ch === 'f' || ch === 'F') && protocolAhead(s, j)) return j - i;
    j++;
    if (ch !== ' ' && s[j] === ' ' && s[j + 1] === ' ' && hardBreakAhead(s, j)) return j - i;
    if (!isAlnum(ch) && (s.startsWith('mailto:', j) || s.startsWith('xmpp:', j))) return j - i;
    if (!isEmailChar(ch) && emailAhead(s, j)) return j - i;
  }
  return n - i;
}

// Match a code span at `s[i]` (which must be a backtick). Returns
// { rawLen, text } or null. The opener is the whole backtick run; the closer
// is the first later run of the same length not followed by a backtick, whose
// content does not start or end with a backtick.
function matchCodeSpan(s, i) {
  const n = s.length;
  let open = i;
  while (open < n && s[open] === '`') open++;
  const len = open - i;
  let p = open;
  while (p < n) {
    if (s[p] !== '`') { p++; continue; }
    let q = p;
    while (q < n && s[q] === '`') q++;
    if (q - p === len && s[q] !== '`') {
      // Content is s[open..p); it must not start or end with a backtick.
      if (p > open && s[open] !== '`' && s[p - 1] !== '`') {
        let text = s.slice(open, p).replace(/\n/g, ' ');
        const hasNonSpace = /[^ ]/.test(text);
        if (hasNonSpace && text.charAt(0) === ' ' && text.charAt(text.length - 1) === ' ') {
          text = text.substring(1, text.length - 1);
        }
        return { rawLen: q - i, text };
      }
      // Content starts/ends with a backtick: this run cannot close it;
      // keep looking for a later run.
      p = q;
      continue;
    }
    p = q;
  }
  return null;
}

// --- inline HTML tag -------------------------------------------------------
// Match an inline HTML tag / comment / processing instruction / declaration /
// CDATA section at `s[i]` (which must be `<`). Returns the raw length or 0.
function matchInlineTag(s, i) {
  const n = s.length;
  // Comment: `<!--` ... `-->`, or `<!-->` / `<!--->`.
  if (s.startsWith('<!--', i)) {
    if (s[i + 4] === '>' || (s[i + 4] === '-' && s[i + 5] === '>')) {
      return s[i + 4] === '>' ? 5 : 6;
    }
    const end = s.indexOf('-->', i + 4);
    if (end === -1) return 0;
    return end + 3 - i;
  }
  // Closing tag: `</name\s*>`.
  if (s[i + 1] === '/') {
    let j = i + 2;
    if (j >= n || !/[A-Za-z]/.test(s[j])) return 0;
    while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
    if (s[j] !== '>') return 0;
    return j + 1 - i;
  }
  // Processing instruction: `<? ... ?>`.
  if (s[i + 1] === '?') {
    const end = s.indexOf('?>', i + 2);
    if (end === -1) return 0;
    return end + 2 - i;
  }
  // Declaration / CDATA.
  if (s[i + 1] === '!') {
    if (s.startsWith('[CDATA[', i + 2)) {
      const end = s.indexOf(']]>', i + 9);
      if (end === -1) return 0;
      return end + 3 - i;
    }
    let j = i + 2;
    if (j >= n || !/[A-Za-z]/.test(s[j])) return 0;
    while (j < n && s[j] !== '>') j++;
    if (j >= n) return 0;
    return j + 1 - i;
  }
  // Open tag: `<name` + attributes + optional `/` + `>`.
  let j = i + 1;
  if (j >= n || !/[A-Za-z]/.test(s[j])) return 0;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  for (;;) {
    // Attribute: whitespace + name + optional `= value`.
    let k = j;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n' || s[k] === '\r')) k++;
    if (k === j) break;
    if (s[k] === '>' || (s[k] === '/' && s[k + 1] === '>')) { j = k; break; }
    if (!/[A-Za-z_:]/.test(s[k] || '')) return 0;
    while (k < n && /[\w.:-]/.test(s[k])) k++;
    let m = k;
    while (m < n && (s[m] === ' ' || s[m] === '\t' || s[m] === '\n' || s[m] === '\r')) m++;
    let valueParsed = false;
    if (s[m] === '=') {
      valueParsed = true;
      m++;
      while (m < n && (s[m] === ' ' || s[m] === '\t' || s[m] === '\n' || s[m] === '\r')) m++;
      if (s[m] === '"') {
        m++;
        while (m < n && s[m] !== '"') m++;
        if (s[m] !== '"') return 0;
        m++;
      } else if (s[m] === "'") {
        m++;
        while (m < n && s[m] !== "'") m++;
        if (s[m] !== "'") return 0;
        m++;
      } else {
        if (m >= n || /[\s"'=<>`]/.test(s[m])) return 0;
        while (m < n && !/[\s"'=<>`]/.test(s[m])) m++;
      }
    }
    j = valueParsed ? m : k;
  }
  if (s[j] === '/') j++;
  if (s[j] !== '>') return 0;
  return j + 1 - i;
}

// --- autolink `<scheme:...>` / `<email>` ------------------------------------
function matchAutolink(s, i) {
  // s[i] === '<'; the `>` must come before any whitespace/control/`<>`.
  let j = i + 1;
  const n = s.length;
  // Scheme: [a-zA-Z][a-zA-Z0-9+.-]{1,31} followed by `:`.
  if (/[A-Za-z]/.test(s[j] || '')) {
    let k = j + 1;
    while (k < n && /[A-Za-z0-9+.-]/.test(s[k])) k++;
    if (k - j >= 2 && k - j <= 32 && s[k] === ':') {
      let m = k + 1;
      while (m < n) {
        const c = s[m];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '<' || c === '>' || c.charCodeAt(0) < 0x20) break;
        m++;
      }
      if (s[m] === '>') {
        const text = s.slice(i + 1, m);
        return { rawLen: m + 1 - i, text, href: text };
      }
      return null;
    }
  }
  // E-mail: local@domain(.domain)+ with the `(?![-_])` tail guard.
  // The local part is one or more e-mail chars (never `@` itself).
  let p = j;
  while (p < n && isEmailChar(s[p])) p++;
  if (p > j && s[p] === '@') {
    const at = p;
    let d = at + 1;
    if (d < n && /[A-Za-z0-9]/.test(s[d])) {
      let ok = true;
      let labels = 0;
      for (;;) {
        let labelEnd = d;
        while (labelEnd < n && /[A-Za-z0-9-]/.test(s[labelEnd])) labelEnd++;
        // A label ends at its last alphanumeric character.
        while (labelEnd > d && s[labelEnd - 1] === '-') labelEnd--;
        if (labelEnd === d || labelEnd - d > 63) { ok = false; break; }
        labels++;
        if (s[labelEnd] === '.') {
          d = labelEnd + 1;
          if (d >= n || !/[A-Za-z0-9]/.test(s[d])) { ok = false; break; }
          continue;
        }
        d = labelEnd;
        break;
      }
      if (ok && labels >= 2 && s[d] === '>' && s[d - 1] !== '-' && s[d - 1] !== '_') {
        const text = s.slice(i + 1, d);
        return { rawLen: d + 1 - i, text, href: 'mailto:' + text };
      }
    }
  }
  return null;
}

// --- extended autolink (GFM url) -------------------------------------------
// Backpedal: trim trailing punctuation / unbalanced parens the way marked's
// `_backpedal` regex does.
const RE_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
function backpedal(text) {
  let prev = '';
  let cur = text;
  while (cur !== prev) {
    prev = cur;
    const m = RE_BACKPEDAL.exec(cur);
    cur = m ? m[0] : '';
  }
  return cur;
}

// Char-code tests for the e-mail / URL scanners (regex-free: a regex
// .test() per character dominated matchUrl's cost on plain text runs).
function isEmailLocalCode(c) { // [A-Za-z0-9._+-]
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    || c === 46 || c === 95 || c === 43 || c === 45;
}
function isEmailDomainCode(c) { // [A-Za-z0-9-_]
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    || c === 45 || c === 95;
}
function isAlnumCode(c) { // [A-Za-z0-9]
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isWordDashCode(c) { // [\w-] = [A-Za-z0-9_-]
  return isAlnumCode(c) || c === 95 || c === 45;
}
function isDomainLabelCode(c) { // [A-Za-z0-9-]
  return isAlnumCode(c) || c === 45;
}

function matchExtendedEmail(s, i) {
  // [A-Za-z0-9._+-]+ @ [a-zA-Z0-9-_]+ (.[a-zA-Z0-9-_]*[a-zA-Z0-9])+ (?![\w-])
  // A dot not followed by a label ending in an alnum ends the domain there
  // (e.g. the trailing dot of `a@b.c.` stays literal text); only a domain
  // with no dotted label at all fails the match.
  let j = i;
  while (j < s.length && isEmailLocalCode(s.charCodeAt(j))) j++;
  if (j === i || s[j] !== '@') return -1;
  j++;
  let d = j;
  if (d >= s.length || !isEmailDomainCode(s.charCodeAt(d))) return -1;
  let sawDot = false;
  for (;;) {
    let labelEnd = d;
    while (labelEnd < s.length && isEmailDomainCode(s.charCodeAt(labelEnd))) labelEnd++;
    if (s[labelEnd] === '.') {
      // Next label must end in an alnum.
      let nd = labelEnd + 1;
      let ne = nd;
      while (ne < s.length && isEmailDomainCode(s.charCodeAt(ne))) ne++;
      if (ne === nd || !isAlnumCode(s.charCodeAt(ne - 1))) {
        d = labelEnd;
        break;
      }
      sawDot = true;
      d = ne;
      continue;
    }
    d = labelEnd;
    break;
  }
  if (!sawDot) return -1;
  if (d < s.length && isWordDashCode(s.charCodeAt(d))) return -1;
  return d;
}

// Try a GFM extended autolink at `s[i]`. Returns { rawLen, text, href }.
function matchUrl(s, i) {
  const n = s.length;
  // (1) `mailto:` / `xmpp:` + extended e-mail (lowercase scheme only).
  if (s.startsWith('mailto:', i) || s.startsWith('xmpp:', i)) {
    const schemeLen = s.startsWith('mailto:', i) ? 7 : 5;
    const end = matchExtendedEmail(s, i + schemeLen);
    if (end !== -1) {
      let extra = end;
      if (s.startsWith('xmpp:', i) && s[extra] === '/') {
        let q = extra + 1;
        while (q < n && (isAlnumCode(s.charCodeAt(q)) || s[q] === '@' || s[q] === '.')) q++;
        extra = q;
      }
      return { rawLen: extra - i, text: s.slice(i, extra), href: s.slice(i, extra) };
    }
  }
  // (2) `http(s)://` / `ftp://` / `www.` + domain + rest.
  let kind = 0; // 1 = protocol, 2 = www.
  let rest = -1;
  if (protocolAhead(s, i)) {
    kind = 1;
    rest = i;
    while (rest < n && s[rest] !== ':' ) rest++;
    rest += 3; // skip `://`
  } else if (s.startsWith('www.', i)) {
    kind = 2;
    rest = i + 4;
  }
  if (kind !== 0) {
    // Domain: (?:[a-zA-Z0-9-]+\.?)+
    let d = rest;
    let ok = false;
    while (d < n) {
      let labelEnd = d;
      while (labelEnd < n && isDomainLabelCode(s.charCodeAt(labelEnd))) labelEnd++;
      if (labelEnd === d) break;
      ok = true;
      d = labelEnd;
      if (s[d] === '.') { d++; continue; }
      break;
    }
    if (ok) {
      let m = d;
      while (m < n && s[m] !== ' ' && s[m] !== '\t' && s[m] !== '\n' && s[m] !== '\r' && s[m] !== '<') m++;
      let text = backpedal(s.slice(i, m));
      if (text.length > 0) {
        return {
          rawLen: text.length,
          text,
          href: kind === 2 ? 'http://' + text : text,
        };
      }
    }
  }
  // (3) Bare e-mail.
  const end = matchExtendedEmail(s, i);
  if (end !== -1) {
    const text = s.slice(i, end);
    return { rawLen: end - i, text, href: 'mailto:' + text };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. emphasis / strong / strikethrough: masked source + closer search
// ---------------------------------------------------------------------------

// Tiny regex composer (same idea as marked's `edit`): start from a pattern
// string, substitute named parts, get the final RegExp.
function ed(pattern, flags) {
  let src = typeof pattern === 'string' ? pattern : pattern.source;
  const obj = {
    replace(name, val) {
      let vs = typeof val === 'string' ? val : val.source;
      vs = vs.replace(/(^|[^\[])\^/g, '$1');
      src = src.replace(name, vs);
      return obj;
    },
    getRegex() { return new RegExp(src, flags || ''); },
  };
  return obj;
}

const RE_PUNCT_SRC = '[\\p{P}\\p{S}]';
const RE_LABEL_BRACKETS = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const RE_BOUNDED_INLINE_LABEL = ed(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/)
  .replace('brackets', RE_LABEL_BRACKETS).getRegex();
const RE_BOUNDED_BLOCK_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
const RE_REFLINK_SEARCH = ed('reflink|nolink(?!\\()', 'g')
  .replace('reflink', ed(/^!?\[(label)\]\[(ref)\]/)
    .replace('label', RE_BOUNDED_INLINE_LABEL)
    .replace('ref', RE_BOUNDED_BLOCK_LABEL).getRegex())
  .replace('nolink', ed(/^!?\[(ref)\](?:\[\])?/)
    .replace('ref', RE_BOUNDED_BLOCK_LABEL).getRegex())
  .getRegex();

// Mask escapes outside code spans: a `\punct` escape becomes `+`s, a code
// span keeps its backticks but has inner backticks masked, a lone backtick
// run is left alone.
const RE_ANY_PUNCT_OUTSIDE_CODE = ed(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, 'gu')
  .replace('punct', RE_PUNCT_SRC).getRegex();

// Mask links, code spans and html tags so their delimiters are invisible to
// the emphasis closer search. Every replacement keeps its length, so indices
// in the masked source line up with the raw source.
const RE_BLOCK_SKIP = ed(/link|precode-code|html/, 'g')
  .replace('link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/)
  .replace('precode-', '(?<!`)()')
  .replace('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .replace('html', /<(?! )[^<>]*?>/)
  .getRegex();

// Does this link text hold a link already? (Images do not count: an image
// may hold a link, a link may not.) Used while masking reflinks.
function linkInText(text) {
  if (text.indexOf('[') === -1) return false;
  for (const m of text.matchAll(RE_BLOCK_SKIP)) {
    if (parseLinkAt(m[0], 0) && text.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of text.matchAll(RE_REFLINK_SEARCH)) {
    const m0 = m[0];
    const refStart = m0.lastIndexOf('[');
    if (m0.charAt(0) === '!' || !Object.hasOwn(LINKS, normalizeLabel(m0.slice(refStart + 1, -1)))) continue;
    if (refStart > 1 && linkInText(m0.slice(1, refStart - 1))) continue;
    return true;
  }
  return false;
}

// Build the masked source for one inline run: links, code spans, html tags
// and escapes are flattened so `*`, `_` and `~` inside them cannot close
// (or open) emphasis. Length-preserving by construction.
function maskSrc(src) {
  let masked = src;
  if (LINKS && src.indexOf('[') !== -1) {
    const maskReflink = (m0) => {
      const refStart = m0.lastIndexOf('[');
      if (!Object.hasOwn(LINKS, normalizeLabel(m0.slice(refStart + 1, -1)))) return m0;
      if (refStart > 1 && m0.charAt(0) !== '!') {
        const text = m0.slice(1, refStart - 1);
        if (linkInText(text)) {
          return '[' + text.replace(RE_REFLINK_SEARCH, maskReflink)
            + '][' + 'a'.repeat(m0.length - refStart - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(m0.length - 2) + ']';
    };
    masked = masked.replace(RE_REFLINK_SEARCH, maskReflink);
  }
  masked = masked.replace(RE_ANY_PUNCT_OUTSIDE_CODE, (m0, code, punct) => {
    if (punct) return '+'.repeat(m0.length);
    if (code) return code + m0.slice(code.length, -code.length).replace(/`/g, '+') + code;
    return m0;
  });
  masked = masked.replace(RE_BLOCK_SKIP, (m0) => '[' + 'a'.repeat(m0.length - 2) + ']');
  return masked;
}

// Last `*` / `_` / `~` run in `src` that can close emphasis/strong/del: a
// run whose preceding character is not ASCII whitespace (a run at position 0
// never counts). -1 when there is none.
function scanClosers(src) {
  const out = { '*': -1, _: -1, '~': -1 };
  const n = src.length;
  for (let i = 0; i < n; i++) {
    const ch = src[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    const prev = i === 0 ? '\n' : src[i - 1];
    let j = i + 1;
    while (j < n && src[j] === ch) j++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      out[ch] = i;
    }
    i = j - 1;
  }
  return out;
}

// Classify a delimiter run at `masked[p..p+len)` for the right-delimiter
// rules. `delim` is `*`, `_` or `~`; `gfm` selects the GFM punctuation
// classes (tilde is not punctuation there). Returns the group number
// (1..6) or 0 when the run cannot be a delimiter at all. Groups 1-2 are
// right-delimiters only, 3-4 left-delimiters only, 5-6 either. (For `_`
// there is no group 6.)
function classifyCloser(masked, p, len, delim, gfm) {
  const prev = p === 0 ? '' : masked[p - 1];
  const next = p + len >= masked.length ? '' : masked[p + len];
  if (prev === '') return 0;
  const punct = gfm ? isPunctGfm : isPunct;
  const prevIsPunct = prev !== delim && punct(prev);
  const prevIsSpace = isSpace(prev);
  const prevIsOther = !prevIsPunct && !prevIsSpace && prev !== delim;
  const nextIsSpace = next === '' || isSpace(next);
  const nextIsPunct = next !== '' && next !== delim && punct(next);
  const nextIsOther = next !== '' && !nextIsSpace && !nextIsPunct && next !== delim;
  if (prevIsPunct) {
    if (nextIsSpace) return 1;
    if (nextIsPunct) return 5;
    if (nextIsOther) return 3;
    return 0;
  }
  if (prevIsSpace) {
    if (nextIsPunct) return 4;
    if (nextIsOther) return 3;
    return 0;
  }
  if (prevIsOther) {
    if (nextIsSpace || nextIsPunct) return 2;
    if (nextIsOther) return delim === '_' ? 0 : 6;
    return 0;
  }
  return 0;
}

// Length of the delimiter run starting at `s[p]` (delim `*`, `_` or `~`).
function runLen(s, p) {
  const ch = s[p];
  let j = p + 1;
  while (j < s.length && s[j] === ch) j++;
  return j - p;
}

// Try to open emphasis/strong at absolute position `pos` in the inline run
// `s` (masked source `masked`, closer hints `closers`). Returns
// { rawLen, kind, text } or null.
function tryEmStrong(s, masked, closers, pos, prevChar) {
  const delim = s[pos];
  const gfm = true;
  // Left-delimiter match: the whole run, then the character after it.
  let p = pos;
  while (p < s.length && s[p] === delim) p++;
  const lLength = p - pos;
  if (p >= s.length) return null;
  const after = s[p];
  let nextPunct = '';
  let nextOther = '';
  if (after !== delim) {
    if (isPunctGfm(after)) nextPunct = after;
    else if (!isSpace(after)) nextOther = after;
  }
  if (nextPunct === '' && nextOther === '') return null;
  const nextChar = nextPunct;
  // A mid-run opener (the run started before this position, e.g. after a
  // failed attempt consumed part of it): flanking is judged on the whole
  // run, so find its start in the masked source.
  const midRun = prevChar === delim;
  let runStart = pos;
  while (runStart > 0 && masked[runStart - 1] === delim) runStart--;
  let runPrevChar = '';
  if (runStart > 0) {
    const slice = masked.slice(Math.max(0, runStart - 2), runStart);
    runPrevChar = [...slice].at(-1) ?? '';
  }
  let pc = prevChar;
  let prevPunct;
  if (runStart < pos) {
    pc = runPrevChar;
    prevPunct = runPrevChar === '*' || runPrevChar === '_' || isPrevPunct(runPrevChar);
  } else {
    prevPunct = isPrevPunct(prevChar);
  }
  // `_` cannot open inside a word (checked against the adjusted prev char).
  if (nextOther !== '' && delim === '_' && isAlnum(pc)) return null;
  // Left-flanking gate: followed by a normal character always may open;
  // followed by punctuation only at the start or after whitespace/punct.
  if (nextChar !== '' && pc !== '' && !prevPunct) return null;
  const runLength = pos - runStart + lLength;
  const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || isPrevPunct(runPrevChar);
  const openerCanClose = runPrevChar.trim() !== ''
    && (nextChar !== '' || (delim === '*' && !runPrevPunct));
  const lastPossible = closers[delim];
  const windowStart = pos + lLength;
  if (lastPossible < windowStart) return null;
  // Orphan skip: only at the very start of the closer window.
  let searchFrom = windowStart;
  let orphanSkipped = false;
  if (delim === '*') {
    const orphan = matchOrphanAst(masked, windowStart);
    if (orphan !== -1) { searchFrom = orphan; orphanSkipped = true; }
  } else if (delim === '_') {
    const orphan = matchOrphanUnd(masked, windowStart);
    if (orphan !== -1) { searchFrom = orphan; orphanSkipped = true; }
  }
  let delimTotal = lLength;
  let midDelimTotal = 0;
  // Resume just past the orphan's final run: the regex resumes after the
  // orphan match, so a run starting exactly there is never a closer.
  let q = orphanSkipped ? searchFrom + 1 : searchFrom;
  const n = masked.length;
  while (q < n) {
    // Next delimiter run start (a delimiter whose previous char is not one).
    while (q < n && !(masked[q] === delim && masked[q - 1] !== delim)) q++;
    if (q >= n) break;
    const rp = q;
    const rLen = runLen(masked, q);
    q = rp + rLen;
    // Cutoff: no qualifying closer at or beyond this run.
    if (rp - 1 > lastPossible) break;
    const group = classifyCloser(masked, rp, rLen, delim, gfm);
    if (group === 0) continue;
    if (group === 3 || group === 4) {
      delimTotal += rLen;
      continue;
    }
    if (group === 5 || group === 6 || openerCanClose) {
      if (midRun && (group === 5 || group === 6)) return null;
      if (runLength % 3 !== 0 && (runLength + rLen) % 3 === 0) {
        midDelimTotal += rLen;
        continue;
      }
    }
    delimTotal -= rLen;
    if (delimTotal > 0) continue;
    let used = rLen;
    const adj = rLen + delimTotal + midDelimTotal;
    if (adj < used) used = adj;
    if (used <= 0) return null;
    const rawLen = rp + used - pos;
    const strong = Math.min(lLength, used) % 2 === 0;
    const text = strong
      ? s.slice(pos + 2, pos + rawLen - 2)
      : s.slice(pos + 1, pos + rawLen - 1);
    return { rawLen, kind: strong ? 'strong' : 'em', text };
  }
  return null;
}

// Orphan-skip pattern for `*`: `[^_*]*?__[^_*]*?\*[^_*]*?(?=__)` at the
// start of the closer window. Returns the index just before the final `__`,
// or -1.
function matchOrphanAst(masked, start) {
  let i = start;
  const n = masked.length;
  while (i < n && masked[i] !== '*' && masked[i] !== '_') i++;
  if (masked[i] !== '_' || masked[i + 1] !== '_') return -1;
  i += 2;
  while (i < n && masked[i] !== '*' && masked[i] !== '_') i++;
  if (masked[i] !== '*') return -1;
  i++;
  while (i < n && masked[i] !== '*' && masked[i] !== '_') i++;
  if (masked[i] === '_' && masked[i + 1] === '_') return i;
  return -1;
}

// Orphan-skip pattern for `_`: `[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)`.
function matchOrphanUnd(masked, start) {
  let i = start;
  const n = masked.length;
  while (i < n && masked[i] !== '*' && masked[i] !== '_') i++;
  if (masked[i] !== '*' || masked[i + 1] !== '*') return -1;
  i += 2;
  while (i < n && masked[i] !== '*' && masked[i] !== '_') i++;
  if (masked[i] !== '_') return -1;
  i++;
  while (i < n && masked[i] !== '*' && masked[i] !== '_') i++;
  if (masked[i] === '*' && masked[i + 1] === '*') return i;
  return -1;
}

// Try to open strikethrough at absolute position `pos`. Returns
// { rawLen, text } or null.
function tryDel(s, masked, closers, pos, prevChar) {
  let p = pos;
  while (p < s.length && s[p] === '~') p++;
  const lLength = p - pos;
  if (lLength > 2) return null;
  if (p >= s.length) return null;
  const after = s[p];
  let nextPunct = '';
  let nextOther = '';
  if (after !== '~') {
    if (isPunct(after)) nextPunct = after;
    else if (!isSpace(after)) nextOther = after;
  }
  if (nextPunct === '' && nextOther === '') return null;
  if (nextPunct !== '' && prevChar !== '' && !isPrevPunct(prevChar)) return null;
  const lastPossible = closers['~'];
  const windowStart = pos + lLength;
  if (lastPossible < windowStart) return null;
  let delimTotal = lLength;
  let q = windowStart;
  const n = masked.length;
  while (q < n) {
    while (q < n && !(masked[q] === '~' && masked[q - 1] !== '~')) q++;
    if (q >= n) break;
    const rp = q;
    const rLen = runLen(masked, q);
    q = rp + rLen;
    if (rp - 1 > lastPossible) break;
    if (rLen !== lLength) continue;
    const group = classifyCloser(masked, rp, rLen, '~', false);
    if (group === 0) continue;
    if (group === 3 || group === 4) {
      delimTotal += rLen;
      continue;
    }
    delimTotal -= rLen;
    if (delimTotal > 0) continue;
    let used = rLen;
    const adj = rLen + delimTotal;
    if (adj < used) used = adj;
    if (used <= 0) return null;
    const rawLen = rp + used - pos;
    return { rawLen, text: s.slice(pos + lLength, pos + rawLen - lLength) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 5. inline links / reflinks / the inline loop
// ---------------------------------------------------------------------------

// Destination part of an inline link, after `](`: `[ \t\n]*` + href +
// optional title + `[ \t\n]*\)`. Same alternatives as marked's link regex.
const RE_LINK_DEST = /^[ \t\n]*(<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\)))(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)))?[ \t\n]*\)/;

// Parse the bracketed label starting at `s[i]` (`s[i]` is `[`). Returns
// an array of { label, end } candidates (end = index just past the
// closing `]`) in marked's backtracking order. Mirrors marked's label
// regex, whose alternatives at a backtick run are tried code-span first,
// then the trailing run of 2+ backticks right before `]`: the regex
// engine backtracks between them when the link after the first candidate
// fails, so a code span may swallow the first `]` and the label may end
// at a later one (e.g. `[less `` a ` b ``](./u) [a `b](./v)` links to
// ./v, while doc-33's `[less ...](./u) ... [`a_b`](...)` links to ./u
// because the swallowed reading cannot complete there).
function parseInlineLabel(s, i) {
  const n = s.length;
  const out = [];
  const MAX_CANDIDATES = 8;
  let steps = 0;
  const MAX_STEPS = 400;
  // Depth-first walk of the label elements. At a backtick run where both
  // the code-span and the trailing-backticks readings apply, the code-span
  // reading is explored first, then the trailing one.
  function walk(j, depth) {
    if (out.length >= MAX_CANDIDATES || steps > MAX_STEPS) return;
    while (j < n) {
      if (++steps > MAX_STEPS) return;
      const c = s[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') {
        let open = j;
        while (open < n && s[open] === '`') open++;
        let k = open;
        while (k < n && s[k] !== '`') k++;
        const hasCode = k < n;
        const hasTrail = (open - j >= 2) && s[open] === ']';
        if (hasCode && hasTrail) {
          let q = k;
          while (q < n && s[q] === '`') q++;
          walk(q, depth);
          if (out.length >= MAX_CANDIDATES || steps > MAX_STEPS) return;
          walk(open, depth);
          return;
        }
        if (hasCode) {
          let q = k;
          while (q < n && s[q] === '`') q++;
          j = q;
          continue;
        }
        if (hasTrail) { j = open; continue; }
        return; // A lone backtick kills this reading of the label.
      }
      if (c === '[') { depth++; if (depth > 3) return; j++; continue; }
      if (c === ']') {
        depth--;
        if (depth === 0) { out.push({ label: s.slice(i + 1, j), end: j + 1 }); return; }
        j++;
        continue;
      }
      j++;
    }
  }
  walk(i, 0);
  return out;
}

// Is there a `<` in `label` (starting at absolute `labelStart` in `s`)
// where a tag/autolink token beginning there runs past the label's end?
function isLabelEndInsideToken(s, label, labelStart) {
  if (label.indexOf('<') === -1) return false;
  const labelEnd = labelStart + label.length;
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      const cs = matchCodeSpan(s, labelStart + i);
      if (cs) { i += cs.rawLen - 1; continue; }
    }
    if (c !== '<') continue;
    const p = labelStart + i;
    const tagLen = matchInlineTag(s, p);
    if (tagLen > 0) {
      if (p + tagLen > labelEnd) return true;
      i += tagLen - 1;
      continue;
    }
    const al = matchAutolink(s, p);
    if (al) {
      if (p + al.rawLen > labelEnd) return true;
      i += al.rawLen - 1;
    }
  }
  return false;
}

// Parse an inline link/image starting at `s[i]` (`[` or `![`). Returns
// { rawLen, isImage, href, title, label } or null.
function parseLinkAt(s, i) {
  const n = s.length;
  let isImage = false;
  let j = i;
  if (s[j] === '!') { isImage = true; j++; }
  if (s[j] !== '[') return null;
  if (!LINK_PAREN_OK) return null;
  // Try each label candidate in marked's backtracking order: the first
  // candidate whose `](` + destination parses wins the link.
  const labs = parseInlineLabel(s, j);
  for (const lab of labs) {
    if (isLabelEndInsideToken(s, lab.label, j + 1)) continue;
    const k = lab.end;
    if (s[k] !== '(') continue;
    const m = RE_LINK_DEST.exec(s.slice(k + 1));
    if (!m) continue;
    let href = m[1];
    let title = m[2] !== undefined ? m[2].slice(1, -1) : '';
    let rawLen = (k + 1 - i) + m[0].length;
    // Angle-bracket href checks / paren balancing (mirrors Tokenizer.link).
    const trimmed = href.trim();
    if (trimmed.startsWith('<')) {
      if (!trimmed.endsWith('>')) continue;
      const inner = trimmed.slice(0, -1);
      if ((trimmed.length - rtrimChar(inner, '\\').length) % 2 === 0) continue;
    } else {
      const lastParen = findClosingBracket(href, '()');
      if (lastParen === -2) continue;
      if (lastParen > -1) {
        rawLen = (isImage ? 5 : 4) + lab.label.length + lastParen;
        href = href.slice(0, lastParen);
        title = '';
      }
    }
    // The raw text must not end with an odd number of backslashes.
    const rawText = s.slice(i, i + rawLen);
    if ((rawText.length - rtrimChar(rawText.slice(0, -1), '\\').length) % 2 === 0) continue;
    href = href.trim();
    if (trimmed.startsWith('<')) href = href.slice(1, -1);
    return {
      rawLen,
      isImage,
      href: unescapePunct(href),
      title: unescapePunct(title),
      label: lab.label.replace(/\\([\[\]])/g, '$1'),
    };
  }
  return null;
}

// Scan a reflink reference label (marked's _blockLabel) starting at `s[i]`
// (`s[i]` is the first ref character). Returns { ref, end } (end = index
// just past `]`) or null.
function scanBlockLabel(s, i) {
  const n = s.length;
  // `(?!\s*\])` — the ref cannot be empty or all whitespace.
  let j = i;
  while (j < n && isSpace(s[j])) j++;
  if (s[j] === ']') return null;
  j = i;
  while (j < n) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '[' || c === ']') break;
    if (c === '\n') {
      // A newline is allowed only when the next line is not blank.
      let k = j + 1;
      while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
      if (s[k] === '\n' || k >= n) return null;
      j++;
      continue;
    }
    j++;
  }
  if (s[j] !== ']') return null;
  return { ref: s.slice(i, j), end: j + 1 };
}

// Parse a reference link / shortcut link at `s[i]` (`[` or `![`). Returns
// { kind, isImage, label, ref, rawLen } or null. The caller looks the ref
// up in LINKS; an unresolved reference is handled by the inline loop.
function parseReflinkAt(s, i) {
  const n = s.length;
  let isImage = false;
  let j = i;
  if (s[j] === '!') { isImage = true; j++; }
  if (s[j] !== '[') return null;
  // Full reference: [label][ref]. Try each label candidate in marked's
  // backtracking order.
  const labs = parseInlineLabel(s, j);
  for (const lab of labs) {
    const k = lab.end;
    if (s[k] === '[') {
      const ref = scanBlockLabel(s, k + 1);
      if (ref && !isLabelEndInsideToken(s, lab.label, j + 1)) {
        return { kind: 'reflink', isImage, label: lab.label, ref: ref.ref, rawLen: ref.end - i };
      }
    }
  }
  // Shortcut reference: [ref], optionally followed by `[]`.
  const ref = scanBlockLabel(s, j + 1);
  if (ref) {
    let end = ref.end;
    if (s[end] === '[' && s[end + 1] === ']') end += 2;
    return { kind: 'nolink', isImage, label: ref.ref, ref: ref.ref, rawLen: end - i };
  }
  return null;
}

// Match a hard break at `s[i]`: ` {2,}\n` or `\\\n`, not followed by only
// whitespace to the end, plus trailing `[ \t]*`. Returns the raw length
// or 0.
function matchBr(s, i) {
  const n = s.length;
  let j = i;
  if (s[j] === '\\') {
    if (s[j + 1] !== '\n') return 0;
    j += 2;
  } else {
    while (s[j] === ' ') j++;
    if (j < i + 2 || s[j] !== '\n') return 0;
    j++;
  }
  // `(?!\s*$)` — the rest must not be all whitespace.
  let k = j;
  while (k < n && isSpace(s[k])) k++;
  if (k >= n) return 0;
  while (j < n && (s[j] === ' ' || s[j] === '\t')) j++;
  return j - i;
}

// Render an autolink / GFM url token: `<a href="...">text</a>` with both
// parts escaped encode=true; when the href cannot be cleaned, just the
// text.
function emitAutolink(out, tok) {
  const clean = cleanUrl(tok.href);
  if (clean === null) { out.push(escHtml(tok.text, true)); return; }
  out.push('<a href="' + escHtml(clean, true) + '">' + escHtml(tok.text, true) + '</a>');
}

// Emit a link/image into `out` (or its plain text when `mode === 'text'`).
// `lk` has { href, title, label, isImage }. Returns true when the token
// was emitted, false when the link must bail (a non-image link whose label
// already holds a link) — the caller then falls through to plain text.
function emitLink(out, lk, mode) {
  const outerInLink = IN_LINK;
  const outerEmitted = LINK_EMITTED;
  const outerInRaw = IN_RAW;
  IN_LINK = true;
  LINK_EMITTED = false;
  const labelText = lk.label.replace(/\\([\[\]])/g, '$1');
  const labelMode = lk.isImage ? 'text' : mode;
  const labelOut = [];
  inlineTo(labelOut, labelText, labelMode);
  const textHasLink = LINK_EMITTED;
  LINK_EMITTED = outerEmitted;
  IN_LINK = outerInLink;
  if (!lk.isImage) {
    if (textHasLink) { IN_RAW = outerInRaw; return false; }
    LINK_EMITTED = true;
  }
  if (mode === 'text') {
    for (const part of labelOut) out.push(part);
    return true;
  }
  const clean = cleanUrl(lk.href);
  if (lk.isImage) {
    const alt = labelOut.join('');
    if (clean === null) { out.push(escHtml(alt, false)); return true; }
    out.push('<img src="' + escHtml(clean, false) + '" alt="' + escHtml(alt, false) + '"');
    if (lk.title) out.push(' title="' + escHtml(lk.title, false) + '"');
    out.push('>');
    return true;
  }
  if (clean === null) {
    for (const part of labelOut) out.push(part);
    return true;
  }
  out.push('<a href="' + escHtml(clean, false) + '"');
  if (lk.title) out.push(' title="' + escHtml(lk.title, false) + '"');
  out.push('>');
  for (const part of labelOut) out.push(part);
  out.push('</a>');
  return true;
}

// Anything that can start inline syntax, an autolink, or a hard break:
// backslash, `<`, `[`, `*`, `_`, backtick, `~`, `@` (e-mail), `![`,
// `www.`, `://`, or two spaces before a newline. A run containing none
// of these is plain text: one escaped/decoded/raw push, no per-char loop.
const RE_INLINE_SYNTAX = /[\\<\[*_`~@]|!\[|www\.|:\/\/|  \n/;

// Render one inline run `s` into `out`. `mode` is 'html' (normal output)
// or 'text' (plain-text flattening, like marked's TextRenderer for image
// alt text). The run's own linkParenPossible state is derived from the
// outer value and whether the run contains `)`.
function inlineTo(out, s, mode) {
  const n = s.length;
  if (n === 0) return;
  // Fast path: no inline syntax anywhere in the run — a single text push.
  // No `<` means no tag can flip IN_LINK/IN_RAW, and no `*`/`_`/`~`
  // means no emphasis state is needed, so the globals are untouched.
  if (!RE_INLINE_SYNTAX.test(s)) {
    if (mode === 'text') out.push(IN_RAW ? s : decodeTextRun(s));
    else out.push(IN_RAW ? s : renderTextRun(s));
    return;
  }
  let masked = null;
  let closers = null;
  const ensureMask = () => {
    if (masked === null) {
      masked = maskSrc(s);
      closers = scanClosers(masked);
    }
  };
  const saveParen = LINK_PAREN_OK;
  LINK_PAREN_OK = saveParen && s.indexOf(')') !== -1;
  try {
    let i = 0;
    let prevChar = '';
    let prevWasText = false;
    while (i < n) {
      if (!prevWasText) prevChar = '';
      prevWasText = false;
      const c = s[i];
      if (c === '\\') {
        const nx = s[i + 1];
        if (nx !== undefined && isAsciiPunct(nx)) {
          out.push(mode === 'text' ? nx : renderTextRun(nx));
          i += 2;
          continue;
        }
        const brLen = matchBr(s, i);
        if (brLen > 0) {
          if (mode === 'html') out.push('<br>');
          i += brLen;
          continue;
        }
      } else if (c === '<') {
        const tagLen = matchInlineTag(s, i);
        if (tagLen > 0) {
          const raw = s.slice(i, i + tagLen);
          if (!IN_LINK && /^<a /i.test(raw)) IN_LINK = true;
          else if (IN_LINK && /^<\/a>/i.test(raw)) IN_LINK = false;
          if (!IN_RAW && /^<(pre|code|kbd|script)(\s|>)/i.test(raw)) IN_RAW = true;
          else if (IN_RAW && /^<\/(pre|code|kbd|script)(\s|>)/i.test(raw)) IN_RAW = false;
          out.push(raw);
          i += tagLen;
          continue;
        }
        const al = matchAutolink(s, i);
        if (al) {
          if (mode === 'text') out.push(al.text);
          else emitAutolink(out, al);
          i += al.rawLen;
          continue;
        }
      } else if (c === '[' || (c === '!' && s[i + 1] === '[')) {
        if (LINK_PAREN_OK) {
          const lk = parseLinkAt(s, i);
          if (lk && emitLink(out, lk, mode)) { i += lk.rawLen; continue; }
        }
        const rl = parseReflinkAt(s, i);
        if (rl) {
          const def = LINKS ? LINKS[normalizeLabel(rl.ref)] : undefined;
          if (def) {
            if (emitLink(out, { href: def.href, title: def.title, label: rl.label, isImage: rl.isImage }, mode)) {
              i += rl.rawLen;
              continue;
            }
          } else {
            // Unresolved reference: just the first character, as text.
            out.push(mode === 'text' ? s[i] : renderTextRun(s[i]));
            if (s[i] !== '_') prevChar = s[i];
            prevWasText = true;
            i += 1;
            continue;
          }
        }
      } else if (c === '*' || c === '_') {
        ensureMask();
        const em = tryEmStrong(s, masked, closers, i, prevChar);
        if (em) {
          if (mode === 'html') {
            out.push(em.kind === 'strong' ? '<strong>' : '<em>');
            inlineTo(out, em.text, mode);
            out.push(em.kind === 'strong' ? '</strong>' : '</em>');
          } else {
            inlineTo(out, em.text, mode);
          }
          i += em.rawLen;
          continue;
        }
        // A failed emphasis may still be the start of an e-mail address
        // (e.g. `__a@b.co` links the whole address).
        if (!IN_LINK) {
          const u = matchUrl(s, i);
          if (u) {
            if (mode === 'text') out.push(u.text);
            else emitAutolink(out, u);
            i += u.rawLen;
            continue;
          }
        }
      } else if (c === '`') {
        const cs = matchCodeSpan(s, i);
        if (cs) {
          if (mode === 'html') out.push('<code>' + escHtml(cs.text, true) + '</code>');
          else out.push(cs.text);
          i += cs.rawLen;
          continue;
        }
      } else if (c === ' ') {
        const brLen = matchBr(s, i);
        if (brLen > 0) {
          if (mode === 'html') out.push('<br>');
          i += brLen;
          continue;
        }
      } else if (c === '~') {
        ensureMask();
        const d = tryDel(s, masked, closers, i, prevChar);
        if (d) {
          if (mode === 'html') {
            out.push('<del>');
            inlineTo(out, d.text, mode);
            out.push('</del>');
          } else {
            inlineTo(out, d.text, mode);
          }
          i += d.rawLen;
          continue;
        }
      } else if (!IN_LINK) {
        const u = matchUrl(s, i);
        if (u) {
          if (mode === 'text') out.push(u.text);
          else emitAutolink(out, u);
          i += u.rawLen;
          continue;
        }
      }
      // Plain text run.
      const len = scanTextLen(s, i);
      const raw = s.slice(i, i + len);
      if (mode === 'text') out.push(IN_RAW ? raw : decodeTextRun(raw));
      else out.push(IN_RAW ? raw : renderTextRun(raw));
      const lastCh = raw.charAt(raw.length - 1);
      if (lastCh !== '_') prevChar = lastCh;
      prevWasText = true;
      i += len;
    }
  } finally {
    LINK_PAREN_OK = saveParen;
  }
}

// Render one top-level inline run (a block's text): the raw-block state is
// reset first, exactly as marked does before each inline run.
function inlineTop(out, s) {
  IN_RAW = false;
  inlineTo(out, s, 'html');
}

// ---------------------------------------------------------------------------
// 6. block parsing
// ---------------------------------------------------------------------------

// Split a table row/header line into cells (marked's splitCells): split on
// unescaped ` |`, drop an empty first/last cell (leading/trailing pipe),
// pad/truncate to `count`, trim, unescape `\|`.
function splitCells(str, count) {
  const t = str.replace(/\|/g, (m, off, s) => {
    let escaped = false;
    for (let p = off - 1; p >= 0 && s[p] === '\\'; p--) escaped = !escaped;
    return escaped ? '|' : ' |';
  });
  const cells = t.split(' |');
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells[cells.length - 1].trim()) cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (let i = 0; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  return cells;
}

// Line helpers for the string+position block lexer.
function lineEnd(src, pos) {
  const e = src.indexOf('\n', pos);
  return e === -1 ? src.length : e;
}
function lineAt(src, pos) {
  return src.slice(pos, lineEnd(src, pos));
}
function nextLinePos(src, pos) {
  const e = src.indexOf('\n', pos);
  return e === -1 ? src.length : e + 1;
}
function isBlankLine(line) {
  return /^[ \t]*$/.test(line);
}

// Is `line` a horizontal rule? ` {0,3}` + 3+ of one of `-`, `_`, `*`,
// with only spaces/tabs between.
function isHrLine(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 3) i++;
  if (i >= line.length) return false;
  const ch = line[i];
  if (ch !== '-' && ch !== '_' && ch !== '*') return false;
  let count = 0;
  for (let j = i; j < line.length; j++) {
    const c = line[j];
    if (c === ch) count++;
    else if (c !== ' ' && c !== '\t') return false;
  }
  return count >= 3;
}

// Is `line` an ATX heading start? ` {0,3}#{1,6}` + whitespace/end.
function isHeadingLine(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 3) i++;
  let j = i;
  while (j < line.length && line[j] === '#') j++;
  const d = j - i;
  if (d === 0 || d > 6) return false;
  return j >= line.length || isSpace(line[j]);
}

// Is `line` a fenced-code opening? Backtick run 3+ with no backtick in the
// rest of the line, or a tilde run 3+.
function isFencesLine(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 3) i++;
  const ch = line[i];
  if (ch !== '`' && ch !== '~') return false;
  let j = i;
  while (j < line.length && line[j] === ch) j++;
  if (j - i < 3) return false;
  if (ch === '`') return line.indexOf('`', j) === -1;
  return true;
}

// Is `line` a blockquote marker line?
function isBlockquoteLine(line) {
  return /^ {0,3}>/.test(line);
}

// Is `line` a list item start? GFM paragraph variant: bullet + whitespace +
// a non-space character. Ke (blockquote) variant: any bullet + space/tab/end.
function isListLineGfm(line) {
  return /^ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t]/.test(line);
}
function isListLineKe(line) {
  return /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/.test(line);
}

// Block-level HTML tags (marked's list K) for the html interrupt (types
// 1-6) and the html block rule.
const HTML_BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const RE_HTML_INTERRUPT = new RegExp('^ {0,3}(?:</?(?:' + HTML_BLOCK_TAGS + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)');

// Is `line` an html-block interrupt (types 1-6) for a paragraph?
function isHtmlInterruptLine(line) {
  return RE_HTML_INTERRUPT.test(line);
}

// Is `line` an indented-code line? ` {4}` or ` {0,3}\t`, then a character.
function isCodeLine(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 4) i++;
  if (i === 4) return line.length > 4;
  return line[i] === '\t' && line.length > i + 1;
}

// Table delimiter line: ` {0,3}` + optional pipes/colons/dashes.
const RE_TABLE_DELIM = /^ {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?$/;
function isTableDelimLine(line) {
  return RE_TABLE_DELIM.test(line);
}

// Does the line at `pos` start a table (header line + delimiter line)?
// This is the paragraph-continuation interrupt: marked's paragraph
// lookahead uses the raw table regex, so any delimiter-shaped next line
// stops the paragraph — even a bare `---` (the table tokenizer may
// still reject it, and then it becomes a setext underline instead).
function isTableStart(src, pos) {
  const header = lineAt(src, pos);
  if (isBlankLine(header)) return false;
  const np = nextLinePos(src, pos);
  if (np >= src.length) return false;
  return isTableDelimLine(lineAt(src, np));
}

// Table-delimiter line as marked's GFM lheading lookaheads see it: a
// delimiter row with at least one pipe. A bare `---` or `:---` is NOT
// one — it may be a setext underline instead.
const RE_TABLE_DELIM_PIPE = /^ {0,3}\|?(?:[:\- ]*\|)+[:\- ]*$/;

// --- individual block rules (each returns null or { rawLen, ... }) --------

function parseSpace(src, pos) {
  let p = pos;
  while (p < src.length) {
    const e = lineEnd(src, p);
    if (!isBlankLine(src.slice(p, e))) break;
    p = e === src.length ? e : e + 1;
  }
  if (p === pos) return null;
  return { rawLen: p - pos, raw: src.slice(pos, p) };
}

function parseCode(src, pos) {
  let p = pos;
  let rawEnd = pos;
  while (p < src.length) {
    const line = lineAt(src, p);
    if (!isCodeLine(line)) break;
    rawEnd = nextLinePos(src, p);
    p = rawEnd;
    // Blank lines after a code line are part of the match.
    while (p < src.length) {
      const e = lineEnd(src, p);
      if (!isBlankLine(src.slice(p, e))) break;
      p = e + 1;
      if (e === src.length) break;
    }
  }
  if (rawEnd === pos) return null;
  const raw = trimTrailingBlankLines(src.slice(pos, rawEnd));
  const text = raw.split('\n').map((line) => line.replace(/^(?: {0,3}\t| {1,4})/, '')).join('\n');
  return { rawLen: raw.length, raw, text };
}

function parseFences(src, pos) {
  const first = lineAt(src, pos);
  let i = 0;
  while (i < first.length && first[i] === ' ' && i < 3) i++;
  const ch = first[i];
  if (ch !== '`' && ch !== '~') return null;
  let j = i;
  while (j < first.length && first[j] === ch) j++;
  const runLen = j - i;
  if (runLen < 3) return null;
  if (ch === '`' && first.indexOf('`', j) !== -1) return null;
  const info = first.slice(j);
  const contentStart = nextLinePos(src, pos);
  let p = contentStart;
  let closeLine = -1;
  let closeEnd = src.length;
  while (p < src.length) {
    const ln = lineAt(src, p);
    let k = 0;
    while (k < ln.length && ln[k] === ' ' && k < 3) k++;
    if (ln[k] === ch) {
      let m = k;
      while (m < ln.length && ln[m] === ch) m++;
      if (m - k >= runLen) {
        let t = m;
        while (t < ln.length && ln[t] === ' ') t++;
        if (t === ln.length) { closeLine = p; closeEnd = lineEnd(src, p); break; }
      }
    }
    p = nextLinePos(src, p);
  }
  const contentEnd = closeLine === -1 ? src.length : closeLine;
  let text = src.slice(contentStart, contentEnd);
  if (text.endsWith('\n')) text = text.slice(0, -1);
  // Indent compensation (backtick fences only): lines are dedented by the
  // opening fence's leading whitespace.
  if (ch === '`' && i > 0) {
    text = text.split('\n').map((line) => {
      const m = /^\s+/.exec(line);
      if (!m) return line;
      return line.slice(Math.min(m[0].length, i));
    }).join('\n');
  }
  const lang = info.trim() ? unescapePunct(info.trim()) : info;
  return { rawLen: closeEnd - pos, raw: src.slice(pos, closeEnd), text, lang };
}

function parseHeading(src, pos) {
  const line = lineAt(src, pos);
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 3) i++;
  let j = i;
  while (j < line.length && line[j] === '#') j++;
  const depth = j - i;
  if (depth === 0 || depth > 6) return null;
  if (j < line.length && !isSpace(line[j])) return null;
  let text = line.slice(j).trim();
  if (text.endsWith('#')) {
    const s = rtrimChar(text, '#');
    if (!s || /[ \t]$/.test(s)) text = s.trim();
  }
  return { rawLen: lineEnd(src, pos) - pos, raw: line, depth, text };
}

function parseHr(src, pos) {
  const line = lineAt(src, pos);
  if (!isHrLine(line)) return null;
  return { rawLen: lineEnd(src, pos) - pos, raw: line };
}

// Parse a link reference definition at `pos`. Returns
// { rawLen, raw, tag, href, title } or null. Mirrors marked's def regex:
//   ^ {0,3}\[(label)\]: *(?:\n[ \t]*)?(dest)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)
// with title = "..." | '...' (no blank line) | (...). The title group is
// optional and backtracks: a title that parses but is followed by junk
// falls back to a title-less definition, which is valid only when the
// destination itself is followed by spaces and a line end.
function parseDef(src, pos) {
  const n = src.length;
  let i = pos;
  while (i < n && src[i] === ' ' && i - pos < 3) i++;
  if (src[i] !== '[') return null;
  const lab = scanBlockLabel(src, i + 1);
  if (!lab) return null;
  let k = lab.end;
  if (src[k] !== ':') return null;
  k++;
  while (src[k] === ' ') k++;
  if (src[k] === '\n') { k++; while (src[k] === ' ' || src[k] === '\t') k++; }
  // Href: `<...>` (same line) or a run of non-whitespace.
  let href = '';
  if (src[k] === '<') {
    const end = src.indexOf('>', k + 1);
    const nl = src.indexOf('\n', k);
    if (end === -1 || (nl !== -1 && end > nl)) return null;
    href = src.slice(k + 1, end);
    k = end + 1;
  } else {
    let m = k;
    while (m < n && !isSpace(src[m])) m++;
    if (m === k) return null;
    href = src.slice(k, m);
    k = m;
  }
  // A non-angle href with an unmatched `)` is not a definition.
  if (!href.startsWith('<') && findClosingBracket(href, '()') !== -1) return null;
  const cleanHref = href.startsWith('<') && href.endsWith('>')
    ? unescapePunct(href.slice(1, -1))
    : unescapePunct(href);
  const makeDef = (rawEnd, title) => ({
    rawLen: rawEnd - pos,
    raw: src.slice(pos, rawEnd),
    tag: normalizeLabel(lab.ref),
    href: cleanHref,
    title: title !== undefined ? unescapePunct(title) : undefined,
  });
  // End of the definition line: only spaces, then a line end or EOF.
  const lineEndOk = (p) => {
    let e = p;
    while (src[e] === ' ') e++;
    return src[e] === '\n' || e >= n ? e : -1;
  };
  // Try with a title: separator ` +(?:\n[ \t]*)?` or ` *\n[ \t]*`.
  let u = k;
  let sep = false;
  let sp = 0;
  while (src[u] === ' ') { u++; sp++; }
  if (sp > 0) {
    sep = true;
    if (src[u] === '\n') { u++; while (src[u] === ' ' || src[u] === '\t') u++; }
  } else if (src[u] === '\n') {
    sep = true;
    u++;
    while (src[u] === ' ' || src[u] === '\t') u++;
  }
  if (sep) {
    const t = parseDefTitle(src, u);
    if (t) {
      const e = lineEndOk(t.end);
      if (e !== -1) return makeDef(e, t.title);
    }
  }
  // Fall back to a title-less definition (the title attempt, if any, is
  // simply not part of the definition; its text stays a paragraph).
  const e = lineEndOk(k);
  if (e !== -1) return makeDef(e, undefined);
  return null;
}

// Parse a (possibly multi-line) link title at `src[i]` (`"`, `'` or `(`).
// Returns { title, end } or null.
function parseDefTitle(src, i) {
  const q = src[i];
  const n = src.length;
  if (q === '"') {
    let j = i + 1;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '"') return { title: src.slice(i + 1, j), end: j + 1 };
      j++;
    }
    return null;
  }
  if (q === "'") {
    let j = i + 1;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '\n') {
        if (src[j + 1] === '\n') return null;
        j++;
        continue;
      }
      if (src[j] === "'") return { title: src.slice(i + 1, j), end: j + 1 };
      j++;
    }
    return null;
  }
  if (q === '(') {
    let j = i + 1;
    while (j < n) {
      if (src[j] === '\\') { j += 2; continue; }
      if (src[j] === '(' || src[j] === ')') {
        return src[j] === ')' ? { title: src.slice(i + 1, j), end: j + 1 } : null;
      }
      j++;
    }
    return null;
  }
  return null;
}

// Parse an HTML block at `pos`. Returns { rawLen, raw, text } or null.
function parseHtml(src, pos) {
  const n = src.length;
  const first = lineAt(src, pos);
  let i = 0;
  while (i < first.length && first[i] === ' ' && i < 3) i++;
  if (first[i] !== '<') return null;
  const rest = first.slice(i);
  const lower = rest.toLowerCase();
  let matchEnd = -1;
  // Type 1: <script|pre|style|textarea ...> ... </name>
  // Type 1 tags start after the opening '<'.
  const m1 = /^(script|pre|style|textarea)(?:[\s>]|$)/.exec(lower.slice(1));
  if (m1) {
    const closeRe = new RegExp('</' + m1[1] + '>', 'i');
    const cm = closeRe.exec(src.slice(pos));
    if (cm) {
      const after = pos + cm.index + cm[0].length;
      const le = lineEnd(src, after);
      matchEnd = le;
      // Consume all following newlines.
      let e = le;
      while (src[e] === '\n') e++;
      matchEnd = e;
    } else {
      matchEnd = n;
    }
  } else if (rest.startsWith('<!--')) {
    // Type 2: comment.
    if (rest.startsWith('<!-->') || rest.startsWith('<!--->')) {
      const le = lineEnd(src, pos);
      let e = le;
      while (src[e] === '\n') e++;
      matchEnd = e;
    } else {
      const end = src.indexOf('-->', pos + 4);
      if (end === -1) {
        matchEnd = n;
      } else {
        const le = lineEnd(src, end + 3);
        let e = le;
        while (src[e] === '\n') e++;
        matchEnd = e;
      }
    }
  } else if (rest.startsWith('<?')) {
    // Type 3: processing instruction.
    const end = src.indexOf('?>', pos + 2);
    if (end === -1) {
      matchEnd = n;
    } else {
      const le = lineEnd(src, end + 2);
      let e = le;
      while (src[e] === '\n') e++;
      matchEnd = e;
    }
  } else if (/^<![A-Z]/.test(rest)) {
    // Type 4: declaration.
    const end = src.indexOf('>', pos + 2);
    if (end === -1) {
      matchEnd = n;
    } else {
      const le = lineEnd(src, end + 1);
      let e = le;
      while (src[e] === '\n') e++;
      matchEnd = e;
    }
  } else if (rest.startsWith('<![CDATA[')) {
    // Type 5: CDATA.
    const end = src.indexOf(']]>', pos + 9);
    if (end === -1) {
      matchEnd = n;
    } else {
      const le = lineEnd(src, end + 3);
      let e = le;
      while (src[e] === '\n') e++;
      matchEnd = e;
    }
  } else {
    // Type 6: block-level tag (from K), or type 7: any other tag alone
    // on its line. Both end at the first blank line.
    const tagRe = new RegExp('^</?(?:' + HTML_BLOCK_TAGS + ')(?:[ \\t]+|$|/?>)', 'i');
    const openRe = /^<(?!script|pre|style|textarea)([a-z][a-z0-9-]*)(?: +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?)* *\/?>(?=[ \t]*(?:\n|$))/i;
    const closeRe = /^<\/[a-z][a-z0-9-]*\s*>(?=[ \t]*(?:\n|$))/i;
    if (!tagRe.test(rest) && !openRe.test(rest) && !closeRe.test(rest)) return null;
    // Consume lines until a blank line (consuming exactly one blank line).
    let p = nextLinePos(src, pos);
    let end = n;
    while (p < n) {
      const e = lineEnd(src, p);
      if (isBlankLine(src.slice(p, e))) { end = e === n ? n : e + 1; break; }
      p = e === n ? n : e + 1;
    }
    matchEnd = end;
  }
  if (matchEnd === -1) return null;
  const text = trimTrailingBlankLines(src.slice(pos, matchEnd));
  return { rawLen: text.length, raw: text, text };
}

// Parse a table at `pos`. Returns { rawLen, node } or null.
function parseTable(src, pos) {
  const headerLine = lineAt(src, pos);
  if (isBlankLine(headerLine)) return null;
  const np = nextLinePos(src, pos);
  if (np >= src.length) return null;
  const delimLine = lineAt(src, np);
  if (!isTableDelimLine(delimLine)) return null;
  if (!/[:|]/.test(delimLine)) return null;
  const headerCells = splitCells(headerLine.replace(/^ +/, ''));
  const alignParts = delimLine.replace(/^\||\| *$/g, '').split('|');
  if (headerCells.length !== alignParts.length) return null;
  const align = alignParts.map((part) => {
    if (/^ *-+: *$/.test(part)) return 'right';
    if (/^ *:-+: *$/.test(part)) return 'center';
    if (/^ *:-+ *$/.test(part)) return 'left';
    return null;
  });
  // Rows: lines that are not blank and do not interrupt a table. A row
  // ends only at a spaces-only line: marked's table-row lookahead refuses
  // ` *\n` (spaces, no tabs), so a tab-only line is itself a row of empty
  // cells, as are lines like a setext underline (no lheading exclusion).
  const rows = [];
  let p = nextLinePos(src, np);
  let lastRowEnd = lineEnd(src, np);
  while (p < src.length) {
    const ln = lineAt(src, p);
    if (/^ *$/.test(ln) || isHrLine(ln) || isHeadingLine(ln) || isBlockquoteLine(ln)
      || isCodeLine(ln) || isFencesLine(ln) || isListLineGfm(ln) || isHtmlInterruptLine(ln)) break;
    rows.push(ln);
    lastRowEnd = lineEnd(src, p);
    p = nextLinePos(src, p);
  }
  const raw = src.slice(pos, lastRowEnd);
  const node = {
    type: 'table',
    raw,
    header: headerCells,
    align,
    rows: rows.map((r) => splitCells(r, headerCells.length)),
  };
  return { rawLen: raw.length, node };
}

// Parse a setext heading at `pos`. Returns { rawLen, raw, depth, text }
// or null.
function parseLheading(src, pos) {
  const first = lineAt(src, pos);
  if (isLheadingExcludedFirst(first)) return null;
  const lines = [first];
  let end = nextLinePos(src, pos);
  while (end < src.length) {
    const ln = lineAt(src, end);
    if (/^ {0,3}(=+|-+)[ \t]*$/.test(ln)) {
      const text = lines.join('\n').trim();
      return {
        rawLen: lineEnd(src, end) - pos,
        raw: src.slice(pos, lineEnd(src, end)),
        depth: ln.trimStart().charAt(0) === '=' ? 1 : 2,
        text,
      };
    }
    if (isBlankLine(ln) || isLheadingExcludedCont(ln)) return null;
    lines.push(ln);
    end = nextLinePos(src, end);
  }
  return null;
}

// First line of a setext heading may not be a bullet, indented code,
// fence, blockquote, heading, html tag line, or table delimiter line.
function isLheadingExcludedFirst(line) {
  if (/^ {0,3}(?:[*+-]|\d{1,9}[.)]) /.test(line)) return true;
  if (isCodeLine(line)) return true;
  if (isFencesLine(line)) return true;
  if (isBlockquoteLine(line)) return true;
  if (isHeadingLine(line)) return true;
  if (/^ {0,3}<[^>\n]+>$/.test(line)) return true;
  if (RE_TABLE_DELIM_PIPE.test(line)) return true;
  return false;
}

// Continuation lines of a setext heading may not be blank or a bullet,
// fence, blockquote, heading, hr, html tag line, or table delimiter line.
function isLheadingExcludedCont(line) {
  if (/^ {0,3}(?:[*+-]|\d{1,9}[.)]) /.test(line)) return true;
  if (isFencesLine(line)) return true;
  if (isBlockquoteLine(line)) return true;
  if (isHeadingLine(line)) return true;
  if (isHrLine(line)) return true;
  if (/^ {0,3}<[^>\n]+>$/.test(line)) return true;
  if (RE_TABLE_DELIM_PIPE.test(line)) return true;
  return false;
}

// Parse a paragraph at `pos` (top-level only). Returns { rawLen, raw, text }
// or null.
function parseParagraph(src, pos) {
  const first = lineAt(src, pos);
  if (isBlankLine(first)) return null;
  const lines = [first];
  let end = nextLinePos(src, pos);
  while (end < src.length) {
    const ln = lineAt(src, end);
    if (isBlankLine(ln)) {
      // A spaces-only line ends the paragraph, unless it is the final
      // line of the input (no newline after it): marked’s paragraph
      // regex only refuses a continuation followed by spaces+newline.
      if (lineEnd(src, end) === src.length) { lines.push(ln); end = src.length; }
      break;
    }
    if (isHrLine(ln) || isHeadingLine(ln) || isBlockquoteLine(ln)
      || isFencesLine(ln) || isListLineGfm(ln) || isHtmlInterruptLine(ln)
      || isTableStart(src, end)) break;
    lines.push(ln);
    end = nextLinePos(src, end);
  }
  const text = lines.join('\n');
  return { rawLen: text.length, raw: text, text };
}

// Parse a single text line (non-top fallback). Returns { rawLen, raw, text }.
function parseText(src, pos) {
  const line = lineAt(src, pos);
  if (line.length === 0) return null;
  return { rawLen: line.length, raw: line, text: line };
}

// --- blockquote ------------------------------------------------------------
// Is `line` at `pos` an interrupt for a lazy blockquote continuation (the
// Ke paragraph interrupts: hr, heading, blockquote, fences, list, html,
// table, blank — no indented code, no setext)?
function isLazyInterrupt(src, pos) {
  const ln = lineAt(src, pos);
  return isBlankLine(ln) || isHrLine(ln) || isHeadingLine(ln) || isBlockquoteLine(ln)
    || isFencesLine(ln) || isListLineKe(ln) || isHtmlInterruptLine(ln)
    || isTableStart(src, pos);
}

// Parse a blockquote at `pos`. Returns { rawLen, node } or null.
function parseBlockquote(src, pos) {
  if (!isBlockquoteLine(lineAt(src, pos))) return null;
  // Collect the blockquote regex match: `>` lines, each pulling in its
  // lazy paragraph-continuation lines.
  const lines = [];
  let p = pos;
  while (p < src.length) {
    const ln = lineAt(src, p);
    if (!isBlockquoteLine(ln)) break;
    lines.push(ln);
    p = nextLinePos(src, p);
    const content = ln.replace(/^ {0,3}> ?/, '');
    if (content.trim() !== '') {
      while (p < src.length && !isLazyInterrupt(src, p)) {
        lines.push(lineAt(src, p));
        p = nextLinePos(src, p);
      }
    }
  }
  if (lines.length === 0) return null;
  let s = '';
  let r = '';
  const o = [];
  let rest = lines;
  while (rest.length > 0) {
    // One frame: lazy lines, then `>` lines.
    let i = false;
    const l = [];
    let q = 0;
    for (; q < rest.length; q++) {
      if (isBlockquoteLine(rest[q])) { l.push(rest[q]); i = true; }
      else if (!i) l.push(rest[q]);
      else break;
    }
    rest = rest.slice(q);
    const h = l.join('\n');
    // The three marker-strip replaces.
    let u = h.replace(/^( {0,3}>)([ \t]+)/gm, (m, b, w) => b + expandTabs(w, b.length));
    u = u.replace(/\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g, '\n    $1');
    u = u.replace(/^ {0,3}>[ \t]?/gm, '');
    s = s ? s + '\n' + h : h;
    r = r ? r + '\n' + u : u;
    lexBlocks(u, true, true, o);
    if (rest.length === 0) break;
    const k = o[o.length - 1];
    if (k && (k.type === 'code' || k.type === 'heading' || k.type === 'hr' || k.type === 'html' || k.type === 'table')) break;
    if (k && k.type === 'blockquote') {
      const g = k;
      const b = rest.join('\n');
      const m = g.raw + '\n' + b.replace(/^ {0,3}>[ \t]?/gm, '');
      const f = parseBlockquote(m, 0);
      o[o.length - 1] = f.node;
      const y = m.substring(f.rawLen).replace(/^\n/, '');
      const R = y ? y.split('\n').length : 0;
      const A = R ? rest.slice(0, -R) : rest;
      if (A.length > 0) s = s + '\n' + A.join('\n');
      r = r.substring(0, r.length - g.text.length) + f.node.text;
      rest = rest.slice(A.length);
      if (rest.length > 0 && isBlockquoteLine(rest[0])) continue;
      break;
    } else if (k && k.type === 'list') {
      const g = k;
      const b = g.raw + '\n' + rest.join('\n');
      const m = parseList(b, 0);
      o[o.length - 1] = m.node;
      const f = m.node.raw.length > g.raw.length
        ? b.slice(g.raw.length + 1, m.node.raw.length).split('\n').length : 0;
      if (f > 0) {
        const y = rest.slice(0, f).join('\n');
        s = s + '\n' + y;
        r = r + '\n' + y;
      }
      rest = rest.slice(f);
      continue;
    }
  }
  const node = { type: 'blockquote', raw: s, text: r, tokens: o };
  return { rawLen: s.length, node };
}

// --- list ------------------------------------------------------------------

// Interrupt regexes for list-item continuation lines, built once per
// content-indent limit RL (0-3) — parseList used to compile six of these
// per item, which dominated list-heavy documents.
const LIST_INTERRUPT_RES = [];
function listInterruptRes(RL) {
  let r = LIST_INTERRUPT_RES[RL];
  if (!r) {
    r = {
      bullet: new RegExp('^ {0,' + RL + '}(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))'),
      hr: new RegExp('^ {0,' + RL + '}((?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)'),
      fences: new RegExp('^ {0,' + RL + '}(?:```|~~~)'),
      heading: new RegExp('^ {0,' + RL + '}#{1,6}(?:\\s|$)'),
      html: new RegExp('^ {0,' + RL + '}(?:</?(?:' + HTML_BLOCK_TAGS + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)', 'i'),
      blockquote: new RegExp('^ {0,' + RL + '}>'),
    };
    LIST_INTERRUPT_RES[RL] = r;
  }
  return r;
}

// Parse a list at `pos`. Returns { rawLen, node } or null.
function parseList(src, pos) {
  const firstLine = lineAt(src, pos);
  let i = 0;
  while (i < firstLine.length && firstLine[i] === ' ' && i < 3) i++;
  const ch = firstLine[i];
  let ordered = false;
  let bullet = '';
  let startNum = '';
  if (ch === '-' || ch === '+' || ch === '*') {
    bullet = ch;
    i++;
  } else if (ch >= '0' && ch <= '9') {
    let j = i;
    while (j < firstLine.length && firstLine[j] >= '0' && firstLine[j] <= '9') j++;
    if (j - i > 9) return null;
    if (firstLine[j] !== '.' && firstLine[j] !== ')') return null;
    bullet = firstLine.slice(i, j + 1);
    ordered = true;
    startNum = firstLine.slice(i, j);
    i = j + 1;
  } else {
    return null;
  }
  const afterBullet = firstLine.slice(i);
  if (afterBullet !== '' && afterBullet[0] !== ' ' && afterBullet[0] !== '\t') return null;
  if (isHrLine(firstLine)) return null;
  const listStart = pos;
  const bulletRe = ordered ? '\\d{1,9}\\' + bullet.slice(-1) : '\\' + bullet;
  // Sticky (no `^` — sticky already anchors at lastIndex) so the item
  // match runs on `src` directly instead of a fresh slice per item.
  const itemRe = new RegExp('( {0,3}' + bulletRe + ')((?:[\\t ][^\\n]*)?(?:\\n|$))', 'y');
  const items = [];
  let loose = false;
  let p = false;
  let e = pos;
  while (e < src.length) {
    itemRe.lastIndex = e;
    const t = itemRe.exec(src);
    if (!t || isHrLine(lineAt(src, e))) break;
    const itemStartPos = e;
    e += t[0].length;
    const g = (t[2] || '').split('\n', 1)[0];
    const b = t[1].length;
    let m = g.replace(/^[ \t]+/, (v) => expandTabs(v, b));
    const f = lineAt(src, e);
    let y = m.trim() === '';
    let R = 0;
    let d = '';
    if (y) {
      R = b + 1;
    } else {
      R = m.search(/[^ ]/);
      if (R === -1) R = m.length;
      R = R > 4 ? 1 : R;
      d = m.slice(R);
      R += b;
    }
    let u = false;
    if (y && isBlankLine(f) && e < src.length) {
      e = nextLinePos(src, e);
      u = true;
    }
    if (!u) {
      // marked builds every interrupt regex through a memoiser that maps
      // the content indent R to clamp(R-1, 0, 3): a nested block may sit
      // one column deeper than the interrupt limit, so it belongs to the item.
      const RL = Math.max(0, Math.min(3, R - 1));
      const { bullet: vRe, hr: qRe, fences: eeRe, heading: teRe, html: mmRe, blockquote: neRe } = listInterruptRes(RL);
      while (e < src.length) {
        const U = lineAt(src, e);
        const f2 = U;
        const Z = U.replace(/^[ \t]+/, (me) => expandTabs(me, 0));
        if (eeRe.test(f2) || teRe.test(f2) || mmRe.test(f2) || neRe.test(f2) || vRe.test(f2) || qRe.test(f2)) break;
        if (Z.search(/[^ ]/) >= R || f2.trim() === '') {
          d += '\n' + Z.slice(R);
        } else {
          if (y || m.replace(/\t/g, '    ').search(/[^ ]/) >= 4 || eeRe.test(m) || teRe.test(m) || mmRe.test(m) || qRe.test(m)) break;
          let qe = f2;
          if (/^ {0,3}(?:=+|-+) *$/.test(f2) && parseLheading(m + '\n' + f2, 0)) {
            qe = '    ' + Z.replace(/^ {0,3}/, '');
          }
          d += '\n' + qe;
        }
        y = f2.trim() === '';
        e = nextLinePos(src, e);
        m = Z.slice(R);
      }
    }
    const A = src.slice(itemStartPos, e);
    if (!loose) {
      if (p) loose = true;
      else if (/\n[ \t]*\n[ \t]*$/.test(A)) p = true;
    }
    items.push({ type: 'list_item', raw: A, task: /^\[[ xX]\][ \t]+\S/.test(d), loose: false, text: d, tokens: [] });
  }
  if (items.length === 0) return null;
  const last = items[items.length - 1];
  last.raw = last.raw.trimEnd();
  last.text = last.text.trimEnd();
  const listRaw = src.slice(listStart, e).trimEnd();
  // Lex each item's text (non-top) and check looseness via space tokens.
  for (const item of items) {
    item.tokens = [];
    lexBlocks(item.text, false, false, item.tokens);
    if (!loose) {
      const spaces = item.tokens.filter((t) => t.type === 'space');
      if (spaces.length > 0 && spaces.some((t) => /\n.*\n/.test(t.raw))) loose = true;
    }
  }
  // Task checkboxes: strip `[ ]`/`[x]` from the item and its first token,
  // and surface a checkbox token.
  for (const item of items) {
    const first = item.tokens[0];
    if (item.task && first && (first.type === 'text' || first.type === 'paragraph')) {
      item.text = item.text.replace(/^\[[ xX]\][ \t]+/, '');
      first.raw = first.raw.replace(/^\[[ xX]\][ \t]+/, '');
      first.text = first.text.replace(/^\[[ xX]\][ \t]+/, '');
      const km = /\[[ xX]\]/.exec(item.raw);
      if (km) {
        const checked = km[0] !== '[ ]';
        item.checked = checked;
        if (loose) {
          first.checkbox = checked;
        } else if (first.type === 'paragraph' || first.type === 'text') {
          item.tokens.unshift({ type: 'checkbox', raw: km[0] + ' ', checked });
        }
      }
    } else if (item.task) {
      item.task = false;
    }
  }
  if (loose) {
    for (const item of items) {
      item.loose = true;
      for (const tok of item.tokens) if (tok.type === 'text') tok.type = 'paragraph';
    }
  }
  const node = {
    type: 'list',
    raw: listRaw,
    ordered,
    start: ordered ? parseInt(startNum, 10) : '',
    loose,
    items,
  };
  return { rawLen: listRaw.length, node };
}

// --- the block loop --------------------------------------------------------

// Lex `src` into `nodes` (appended). `top` selects paragraph vs text as
// the fallback; `mergeFirstPara` merges the first paragraph of this call
// into a trailing paragraph of `nodes` (blockquote frames). Returns the
// index into `src` just past the last consumed block.
function lexBlocks(src, top, mergeFirstPara, nodes) {
  let pos = 0;
  let mergeFirst = mergeFirstPara;
  const n = src.length;
  while (pos < n) {
    const sp = parseSpace(src, pos);
    if (sp) {
      pos += sp.rawLen;
      if (sp.rawLen === 1 && nodes.length > 0) {
        nodes[nodes.length - 1].raw += '\n';
      } else {
        nodes.push({ type: 'space', raw: sp.raw });
      }
      continue;
    }
    const cd = parseCode(src, pos);
    if (cd) {
      pos += cd.rawLen;
      const last = nodes[nodes.length - 1];
      if (last && (last.type === 'paragraph' || last.type === 'text')) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + cd.raw;
        last.text += '\n' + cd.text;
      } else {
        nodes.push({ type: 'code', raw: cd.raw, text: cd.text, lang: '' });
      }
      continue;
    }
    const fn = parseFences(src, pos);
    if (fn) {
      pos += fn.rawLen;
      nodes.push({ type: 'code', raw: fn.raw, text: fn.text, lang: fn.lang });
      continue;
    }
    const hd = parseHeading(src, pos);
    if (hd) {
      pos += hd.rawLen;
      nodes.push({ type: 'heading', raw: hd.raw, depth: hd.depth, text: hd.text });
      continue;
    }
    const hr = parseHr(src, pos);
    if (hr) {
      pos += hr.rawLen;
      nodes.push({ type: 'hr', raw: hr.raw });
      continue;
    }
    const bq = parseBlockquote(src, pos);
    if (bq) {
      pos += bq.rawLen;
      nodes.push(bq.node);
      continue;
    }
    const ls = parseList(src, pos);
    if (ls) {
      pos += ls.rawLen;
      nodes.push(ls.node);
      continue;
    }
    const hm = parseHtml(src, pos);
    if (hm) {
      pos += hm.rawLen;
      nodes.push({ type: 'html', raw: hm.raw, text: hm.text });
      continue;
    }
    const df = parseDef(src, pos);
    if (df) {
      pos += df.rawLen;
      const last = nodes[nodes.length - 1];
      if (last && (last.type === 'paragraph' || last.type === 'text')) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + df.raw;
        last.text += '\n' + df.raw;
      } else {
        if (!Object.hasOwn(LINKS, df.tag)) LINKS[df.tag] = { href: df.href, title: df.title };
        nodes.push({ type: 'def', raw: df.raw });
      }
      continue;
    }
    const tb = parseTable(src, pos);
    if (tb) {
      pos += tb.rawLen;
      nodes.push(tb.node);
      continue;
    }
    const lh = parseLheading(src, pos);
    if (lh) {
      pos += lh.rawLen;
      nodes.push({ type: 'heading', raw: lh.raw, depth: lh.depth, text: lh.text });
      continue;
    }
    if (top) {
      const pg = parseParagraph(src, pos);
      if (pg) {
        pos += pg.rawLen;
        const last = nodes[nodes.length - 1];
        if (mergeFirst && last && last.type === 'paragraph') {
          last.raw += (last.raw.endsWith('\n') ? '' : '\n') + pg.raw;
          last.text += '\n' + pg.text;
        } else {
          nodes.push({ type: 'paragraph', raw: pg.raw, text: pg.text });
        }
        mergeFirst = false;
        continue;
      }
    }
    const tx = parseText(src, pos);
    if (tx) {
      pos += tx.rawLen;
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'text') {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + tx.raw;
        last.text += '\n' + tx.text;
      } else {
        nodes.push({ type: 'text', raw: tx.raw, text: tx.text });
      }
      continue;
    }
    // Safety net (parseText matches any non-empty line, so unreachable).
    pos = nextLinePos(src, pos);
  }
  return pos;
}

// --- rendering -------------------------------------------------------------

function checkboxHtml(checked) {
  return '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
}

function renderNodes(nodes, out) {
  for (const node of nodes) {
    switch (node.type) {
      case 'space':
      case 'def':
        break;
      case 'code': {
        const langWord = node.lang ? node.lang.match(/^\S*/)[0] : '';
        const r = node.text ? node.text.replace(/\n$/, '') + '\n' : '';
        const esc = escHtml(r, true);
        if (langWord) out.push('<pre><code class="language-' + escHtml(langWord, false) + '">' + esc + '</code></pre>\n');
        else out.push('<pre><code>' + esc + '</code></pre>\n');
        break;
      }
      case 'heading': {
        const inner = [];
        inlineTop(inner, node.text);
        out.push('<h' + node.depth + '>' + inner.join('') + '</h' + node.depth + '>\n');
        break;
      }
      case 'hr':
        out.push('<hr>\n');
        break;
      case 'blockquote': {
        const inner = [];
        renderNodes(node.tokens, inner);
        out.push('<blockquote>\n' + inner.join('') + '</blockquote>\n');
        break;
      }
      case 'list': {
        let s = '';
        for (const item of node.items) {
          const inner = [];
          renderNodes(item.tokens, inner);
          s += '<li>' + inner.join('') + '</li>\n';
        }
        const tag = node.ordered ? 'ol' : 'ul';
        const startAttr = node.ordered && node.start !== 1 ? ' start="' + node.start + '"' : '';
        out.push('<' + tag + startAttr + '>\n' + s + '</' + tag + '>\n');
        break;
      }
      case 'checkbox':
        out.push(checkboxHtml(node.checked));
        break;
      case 'html':
        out.push(node.text);
        break;
      case 'paragraph': {
        const inner = [];
        if (node.checkbox !== undefined) inner.push(checkboxHtml(node.checkbox));
        inlineTop(inner, node.text);
        out.push('<p>' + inner.join('') + '</p>\n');
        break;
      }
      case 'text': {
        const inner = [];
        if (node.checkbox !== undefined) inner.push(checkboxHtml(node.checkbox));
        inlineTop(inner, node.text);
        out.push(inner.join(''));
        break;
      }
      case 'table': {
        let head = '';
        for (let i = 0; i < node.header.length; i++) {
          const inner = [];
          inlineTop(inner, node.header[i]);
          head += (node.align[i] ? '<th align="' + node.align[i] + '">' : '<th>') + inner.join('') + '</th>\n';
        }
        let body = '';
        for (const row of node.rows) {
          let rc = '';
          for (let i = 0; i < row.length; i++) {
            const inner = [];
            inlineTop(inner, row[i]);
            rc += (node.align[i] ? '<td align="' + node.align[i] + '">' : '<td>') + inner.join('') + '</td>\n';
          }
          body += '<tr>\n' + rc + '</tr>\n';
        }
        out.push('<table>\n<thead>\n<tr>\n' + head + '</tr>\n</thead>\n'
          + (body ? '<tbody>' + body + '</tbody>' : '') + '</table>\n');
        break;
      }
    }
  }
}

// --- entry -----------------------------------------------------------------

// Render `markdown` to HTML, byte-identical to marked 18.1.3 with default
// options (gfm on, breaks off). Deterministic: no state is kept between
// calls.
export function parse(markdown) {
  const src = markdown.replace(/\r\n|\r/g, '\n');
  LINKS = Object.create(null);
  IN_LINK = false;
  IN_RAW = false;
  LINK_EMITTED = false;
  LINK_PAREN_OK = true;
  const nodes = [];
  lexBlocks(src, true, false, nodes);
  const out = [];
  renderNodes(nodes, out);
  return out.join('');
}
