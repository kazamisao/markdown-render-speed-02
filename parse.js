// parse.js — round 11 fresh rewrite.
// A dependency-free Markdown renderer: parse(src) returns exactly the
// HTML marked 18.1.3 produces with its default options (GFM on, breaks
// off, pedantic off, async off). Written from scratch in this session;
// where marked disagrees with the CommonMark/GFM prose, marked wins.
//
// How it works, in three layers:
//  1. Block layer: the input is split into lines once. A scanner walks
//     the lines and emits a flat list of node tuples — small arrays whose
//     first slot is a numeric tag — instead of allocating an object per
//     block. Link reference definitions are harvested during this same
//     walk, so a definition is visible to inline rendering even when it
//     appears below the text that uses it.
//  2. Render layer: the node list is walked once, pushing HTML strings
//     into a single output array. Containers (quotes, lists) render into
//     a scratch array that is joined once.
//  3. Inline layer: one character-code scanner per text run. Runs with
//     no inline syntax take a one-shot escape path. Emphasis is resolved
//     on a "veiled" copy of the run in which links, code spans, tags and
//     escapes are flattened to same-length filler, so delimiters inside
//     them can neither open nor close; the veiled copy is built lazily,
//     only when a closer actually exists after an opener.
//
// No state survives between parse() calls; parse is a pure function of
// its input string.

// ===========================================================================
// 1. Small character predicates. Everything hot works on char codes.
// ===========================================================================

const ASCII_PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const UNICODE_PUNCT_RE = /[\p{P}\p{S}]/u;
const UNICODE_ALNUM_RE = /[\p{L}\p{N}]/u;

// Unicode whitespace: ASCII whitespace plus the space/line/paragraph
// separators marked treats as \s.
function chSpace(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  if (c === 32 || (c >= 9 && c <= 13)) return true;
  return c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a)
    || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000;
}

function chPunct(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return ASCII_PUNCT.indexOf(ch) >= 0;
  return UNICODE_PUNCT_RE.test(ch);
}

// GFM emphasis punctuation: like chPunct, except `~` is not punctuation.
function chPunctGfm(ch) {
  return ch !== '' && ch !== '~' && chPunct(ch);
}

// "Previous char is punctuation" for emphasis flanking: whitespace or
// punctuation, never `*` or `_` themselves.
function chPrevPunct(ch) {
  return ch !== '' && ch !== '*' && ch !== '_' && (chSpace(ch) || chPunct(ch));
}

function chAlnum(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return true;
  return UNICODE_ALNUM_RE.test(ch);
}

function chAsciiPunct(ch) {
  return ch !== '' && ASCII_PUNCT.indexOf(ch) >= 0;
}

function chWord(ch) { // [A-Za-z0-9_], marked's \w
  if (ch === '' || ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90)
    || (c >= 97 && c <= 122) || c === 95;
}

// Characters allowed in an e-mail address (GFM extended autolinks).
function chMail(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    || ch === '.' || ch === '!' || ch === '#' || ch === '$' || ch === '%'
    || ch === '&' || ch === "'" || ch === '*' || ch === '+' || ch === '/'
    || ch === '=' || ch === '?' || ch === '^' || ch === '_' || ch === '`'
    || ch === '{' || ch === '|' || ch === '}' || ch === '~' || ch === '-';
}

// Char-code predicates used by the URL / e-mail scanners.
function ccLocal(c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 95 || c === 43 || c === 45; }
function ccDomain(c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95; }
function ccAlnum(c) { return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
function ccWordDash(c) { return ccAlnum(c) || c === 95 || c === 45; }
function ccLabel(c) { return ccAlnum(c) || c === 45; }

// Columns of leading indentation of a line (space = 1, tab = to next
// multiple of 4).
function indentCols(line) {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') col += 1;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

// Column of the first non-space/tab character, counting each tab as four
// columns (the `replace(/\t/g, '    ')` reading); -1 for all-whitespace.
function firstNonSpaceCol(m) {
  let cols = 0;
  for (let i = 0; i < m.length; i++) {
    const ch = m[i];
    if (ch === ' ') { cols += 1; continue; }
    if (ch === '\t') { cols += 4; continue; }
    return cols;
  }
  return -1;
}

// Index of the first character that is not a space or tab.
function firstNonWsIdx(line) {
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

// Remove `cols` columns of indentation from a line's front; a tab that
// straddles the boundary is replaced by the spaces it has left.
function stripIndent(line, cols) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < cols) {
    const ch = line[i];
    if (ch === ' ') { col += 1; i += 1; }
    else if (ch === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= cols) { col += w; i += 1; }
      else return ' '.repeat(col + w - cols) + line.slice(i + 1);
    } else break;
  }
  return line.slice(i);
}

// Expand tabs to spaces, counting columns from `base` (marked's
// expandTabs).
function tabsToSpaces(line, base) {
  let col = base || 0;
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\t') {
      const add = 4 - (col % 4);
      out += '    '.slice(0, add);
      col += add;
    } else {
      out += ch;
      col += 1;
    }
  }
  return out;
}

function trimSpacesTabs(s) {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === ' ' || s[a] === '\t')) a++;
  while (b > a && (s[b - 1] === ' ' || s[b - 1] === '\t')) b--;
  return s.slice(a, b);
}

function rtrimChar(s, c) {
  let i = s.length;
  while (i > 0 && s.charAt(i - 1) === c) i--;
  return i === s.length ? s : s.slice(0, i);
}

// Drop trailing blank lines from a string, keeping at most the final
// newline of the last content line (marked's trimTrailingBlankLines).
function trimTrailingBlanks(s) {
  const lines = s.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && /^[ \t]*$/.test(lines[end])) end--;
  if (lines.length - end <= 2) return s;
  return lines.slice(0, end + 1).join('\n');
}

// ===========================================================================
// 2. Escaping, character references, URL cleaning, labels
// ===========================================================================

// Index just past the `;` of a valid character reference starting at the
// `&` at position i, or -1. Matches marked's escape lookahead:
// `(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);`.
function charRefEnd(s, i) {
  let j = i + 1;
  if (s[j] === '#') {
    j++;
    if (s[j] === 'x' || s[j] === 'X') {
      j++;
      const h0 = j;
      while (j < s.length && /[0-9A-Fa-f]/.test(s[j])) j++;
      return j > h0 && j - h0 <= 6 && s[j] === ';' ? j + 1 : -1;
    }
    const d0 = j;
    while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
    return j > d0 && j - d0 <= 7 && s[j] === ';' ? j + 1 : -1;
  }
  const w0 = j;
  while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
  return j > w0 && s[j] === ';' ? j + 1 : -1;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const HTML_ESC_RE = /[&<>"']/g;

// Escape `&<>"'`. With `keepRefs`, an `&` that starts a valid character
// reference is left alone.
function escapeHtml(s, keepRefs) {
  if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1
    && s.indexOf('"') === -1 && s.indexOf("'") === -1) return s;
  let out = '';
  let last = 0;
  HTML_ESC_RE.lastIndex = 0;
  let m;
  while ((m = HTML_ESC_RE.exec(s)) !== null) {
    const ch = m[0];
    if (ch === '&' && keepRefs && charRefEnd(s, m.index) !== -1) continue;
    out += s.slice(last, m.index) + HTML_ESCAPES[ch];
    last = m.index + 1;
  }
  return last === 0 ? s : out + s.slice(last);
}

// Decode numeric character references in inline text, exactly like
// marked: a decoded character stands for itself (re-escaped by the
// caller), values 0 / >0x10FFFF / surrogates become U+FFFD, code 38
// becomes `&amp;`, and a bare `&` that cannot start a valid reference
// becomes `&amp;`.
function decodeNumericRefs(s) {
  if (s.indexOf('&') === -1) return s;
  let out = '';
  let last = 0;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const amp = s.indexOf('&', i);
    if (amp < 0) break;
    let j = amp + 1;
    if (s[j] === '#') {
      let hex = false;
      j++;
      if (s[j] === 'x' || s[j] === 'X') { hex = true; j++; }
      const d0 = j;
      if (hex) { while (j < n && /[0-9A-Fa-f]/.test(s[j])) j++; }
      else { while (j < n && s[j] >= '0' && s[j] <= '9') j++; }
      const digits = j - d0;
      if (digits > 0 && digits <= (hex ? 6 : 7) && s[j] === ';') {
        const code = hex ? parseInt(s.slice(d0, j), 16) : parseInt(s.slice(d0, j), 10);
        let rep;
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) rep = '\uFFFD';
        else if (code === 38) rep = '&amp;';
        else rep = String.fromCodePoint(code);
        out += s.slice(last, amp) + rep;
        last = j + 1;
        i = j + 1;
        continue;
      }
    }
    if (charRefEnd(s, amp) !== -1) { i = amp + 1; continue; }
    out += s.slice(last, amp) + '&amp;';
    last = amp + 1;
    i = amp + 1;
  }
  return last === 0 ? s : out + s.slice(last);
}

// Render one inline text run: decode numeric references, then escape
// HTML (leaving valid references alone). This is marked's text token
// plus its renderer, fused into one pass.
function textRun(s) {
  return escapeHtml(decodeNumericRefs(s), true);
}

// encodeURI, with `%25` folded back to `%`; null when it throws (a lone
// surrogate in the URL).
function cleanHref(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// Unescape `\punct` -> punct (any Unicode punctuation after a backslash).
function unescapePunct(s) {
  if (s.indexOf('\\') === -1) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && chPunct(s[i + 1])) {
      out += s[i + 1];
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

// Normalise a link label for definition/reference matching: trim,
// collapse runs of whitespace to one space, Unicode case-fold.
function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Index of the `)` that closes the paren run starting in `str`
// (balanced parens counted like marked's findClosingBracket): -1 when
// balanced/absent, -2 when more opens than closes, otherwise the index
// of the unmatched `)`.
function closingParen(str, b) {
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

// ===========================================================================
// 3. Inline matchers: code spans, HTML tags, autolinks, URLs, link labels
// ===========================================================================

// Match a code span at s[i] (a backtick). Returns { len, text } or null.
// The opener is the whole backtick run; the closer is the first later
// run of the same length not followed by a backtick, whose content does
// not start or end with a backtick.
function findCodeSpan(s, i) {
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
      if (p > open && s[open] !== '`' && s[p - 1] !== '`') {
        let text = s.slice(open, p).replace(/\n/g, ' ');
        if (/[^ ]/.test(text) && text.length >= 2
          && text.charAt(0) === ' ' && text.charAt(text.length - 1) === ' ') {
          text = text.substring(1, text.length - 1);
        }
        return { len: q - i, text };
      }
      p = q;
      continue;
    }
    p = q;
  }
  return null;
}

// Match an inline HTML construct at s[i] (which must be `<`). Returns
// the raw length, or 0. Covers comments, processing instructions,
// declarations, CDATA sections, open tags and closing tags.
function findTag(s, i) {
  const n = s.length;
  if (s.startsWith('<!--', i)) {
    if (s[i + 4] === '>' || (s[i + 4] === '-' && s[i + 5] === '>')) {
      return s[i + 4] === '>' ? 5 : 6;
    }
    const end = s.indexOf('-->', i + 4);
    if (end === -1) return 0;
    return end + 3 - i;
  }
  if (s[i + 1] === '/') {
    let j = i + 2;
    if (j >= n || !/[A-Za-z]/.test(s[j])) return 0;
    while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
    if (s[j] !== '>') return 0;
    return j + 1 - i;
  }
  if (s[i + 1] === '?') {
    const end = s.indexOf('?>', i + 2);
    if (end === -1) return 0;
    return end + 2 - i;
  }
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
  let j = i + 1;
  if (j >= n || !/[A-Za-z]/.test(s[j])) return 0;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  for (;;) {
    let k = j;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n' || s[k] === '\r')) k++;
    if (k === j) break;
    if (s[k] === '>' || (s[k] === '/' && s[k + 1] === '>')) { j = k; break; }
    if (!/[A-Za-z_:]/.test(s[k] || '')) return 0;
    while (k < n && /[\w.:-]/.test(s[k])) k++;
    let m = k;
    while (m < n && (s[m] === ' ' || s[m] === '\t' || s[m] === '\n' || s[m] === '\r')) m++;
    let hasValue = false;
    if (s[m] === '=') {
      hasValue = true;
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
    j = hasValue ? m : k;
  }
  if (s[j] === '/') j++;
  if (s[j] !== '>') return 0;
  return j + 1 - i;
}

// Match an autolink `<scheme:...>` or `<email>` at s[i]. Returns
// { len, text, href } or null.
function findAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
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
        return { len: m + 1 - i, text, href: text };
      }
      return null;
    }
  }
  let p = j;
  while (p < n && chMail(s[p])) p++;
  if (p > j && s[p] === '@') {
    const at = p;
    let d = at + 1;
    if (d < n && /[A-Za-z0-9]/.test(s[d])) {
      let ok = true;
      let labels = 0;
      for (;;) {
        let labelEnd = d;
        while (labelEnd < n && /[A-Za-z0-9-]/.test(s[labelEnd])) labelEnd++;
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
        return { len: d + 1 - i, text, href: 'mailto:' + text };
      }
    }
  }
  return null;
}

// --- GFM extended autolinks ------------------------------------------------

// Trim trailing punctuation / unbalanced parens the way marked's
// backpedal does: apply the pattern until the result stops changing.
const BACKPEDAL_RE = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
function backpedalUrl(text) {
  let prev = '';
  let cur = text;
  while (cur !== prev) {
    prev = cur;
    const m = BACKPEDAL_RE.exec(cur);
    cur = m ? m[0] : '';
  }
  return cur;
}

// Does an e-mail local part (`[A-Za-z0-9._+-]+@`) start at s[p]? Scans
// the word at p with inlined char-code tests; the work is bounded by the
// word, not the whole run.
function mailLocalAhead(s, p) {
  const n = s.length;
  let j = p;
  while (j < n) {
    const code = s.charCodeAt(j);
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122) || code === 46 || code === 33 || code === 35
      || code === 36 || code === 37 || code === 38 || code === 39 || code === 42
      || code === 43 || code === 47 || code === 61 || code === 63 || code === 94
      || code === 95 || code === 96 || code === 123 || code === 124 || code === 125
      || code === 126 || code === 45)) break;
    j++;
  }
  return j > p && j < n && s[j] === '@';
}

// Does a URL protocol (`http://`, `https://`, `ftp://`, any case) start
// at s[p]? Allocation-free case-insensitive check.
function protocolAt(s, p) {
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

// Does `www.` start at s[p] where marked's lookbehind allows it (start
// of string, or after whitespace — `\s`, NBSP included — `*`, `_`, `~`
// or `(`)?
function wwwAt(s, p) {
  if (s[p] !== 'w' || s[p + 1] !== 'w' || s[p + 2] !== 'w' || s[p + 3] !== '.') return false;
  if (p === 0) return true;
  const prev = s[p - 1];
  return chSpace(prev) || prev === '*' || prev === '_' || prev === '~' || prev === '(';
}

// Match an extended e-mail address at s[i]: local@domain with a dotted
// domain. Returns the index just past the address, or -1. A dot not
// followed by a label ending in an alnum ends the domain there (so the
// trailing dot of `a@b.c.` stays literal text); only a domain with no
// dotted label at all fails the match.
function findExtMail(s, i) {
  let j = i;
  while (j < s.length && ccLocal(s.charCodeAt(j))) j++;
  if (j === i || s[j] !== '@') return -1;
  j++;
  let d = j;
  if (d >= s.length || !ccDomain(s.charCodeAt(d))) return -1;
  let sawDot = false;
  for (;;) {
    let labelEnd = d;
    while (labelEnd < s.length && ccDomain(s.charCodeAt(labelEnd))) labelEnd++;
    if (s[labelEnd] === '.') {
      let nd = labelEnd + 1;
      let ne = nd;
      while (ne < s.length && ccDomain(s.charCodeAt(ne))) ne++;
      if (ne === nd || !ccAlnum(s.charCodeAt(ne - 1))) {
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
  if (d < s.length && ccWordDash(s.charCodeAt(d))) return -1;
  return d;
}

// Try a GFM extended autolink at s[i]. Returns { len, text, href }.
function findUrl(s, i) {
  const n = s.length;
  if (s.startsWith('mailto:', i) || s.startsWith('xmpp:', i)) {
    const schemeLen = s.startsWith('mailto:', i) ? 7 : 5;
    const end = findExtMail(s, i + schemeLen);
    if (end !== -1) {
      let extra = end;
      if (s.startsWith('xmpp:', i) && s[extra] === '/') {
        let q = extra + 1;
        while (q < n && (ccAlnum(s.charCodeAt(q)) || s[q] === '@' || s[q] === '.')) q++;
        extra = q;
      }
      return { len: extra - i, text: s.slice(i, extra), href: s.slice(i, extra) };
    }
  }
  let kind = 0; // 1 = protocol, 2 = www.
  let rest = -1;
  if (protocolAt(s, i)) {
    kind = 1;
    rest = i;
    while (rest < n && s[rest] !== ':') rest++;
    rest += 3;
  } else if (s.startsWith('www.', i)) {
    kind = 2;
    rest = i + 4;
  }
  if (kind !== 0) {
    let d = rest;
    let ok = false;
    while (d < n) {
      let labelEnd = d;
      while (labelEnd < n && ccLabel(s.charCodeAt(labelEnd))) labelEnd++;
      if (labelEnd === d) break;
      ok = true;
      d = labelEnd;
      if (s[d] === '.') { d++; continue; }
      break;
    }
    if (ok) {
      let m = d;
      while (m < n && s[m] !== ' ' && s[m] !== '\t' && s[m] !== '\n' && s[m] !== '\r' && s[m] !== '<') m++;
      const text = backpedalUrl(s.slice(i, m));
      if (text.length > 0) {
        return { len: text.length, text, href: kind === 2 ? 'http://' + text : text };
      }
    }
  }
  const end = findExtMail(s, i);
  if (end !== -1) {
    const text = s.slice(i, end);
    return { len: end - i, text, href: 'mailto:' + text };
  }
  return null;
}

// Match a hard break at s[i]: ` {2,}\n` or `\\\n`, not followed by only
// whitespace to the end, plus trailing `[ \t]*`. Returns the raw length
// or 0.
function findHardBreak(s, i) {
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
  let k = j;
  while (k < n && chSpace(s[k])) k++;
  if (k >= n) return 0;
  while (j < n && (s[j] === ' ' || s[j] === '\t')) j++;
  return j - i;
}

// --- link labels -----------------------------------------------------------

// Parse the bracketed label starting at s[i] (s[i] is `[`). Returns an
// array of { label, end } candidates (end = index just past the closing
// `]`) in marked's backtracking order. At a backtick run where both the
// code-span reading and the trailing-run-of-2+-backticks-right-before-`]`
// reading apply, the code-span reading is explored first, then the
// trailing one, because marked's label regex backtracks between them
// when the link after the first candidate fails.
function labelOptions(s, i) {
  const n = s.length;
  const out = [];
  const MAX_CAND = 8;
  let steps = 0;
  const MAX_STEPS = 400;
  function walk(j, depth) {
    if (out.length >= MAX_CAND || steps > MAX_STEPS) return;
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
          if (out.length >= MAX_CAND || steps > MAX_STEPS) return;
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
        return;
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
function labelSpillsIntoToken(s, label, labelStart) {
  if (label.indexOf('<') === -1) return false;
  const labelEnd = labelStart + label.length;
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      const cs = findCodeSpan(s, labelStart + i);
      if (cs) { i += cs.len - 1; continue; }
    }
    if (c !== '<') continue;
    const p = labelStart + i;
    const tagLen = findTag(s, p);
    if (tagLen > 0) {
      if (p + tagLen > labelEnd) return true;
      i += tagLen - 1;
      continue;
    }
    const al = findAutolink(s, p);
    if (al) {
      if (p + al.len > labelEnd) return true;
      i += al.len - 1;
    }
  }
  return false;
}

// Parse a link destination + optional title starting at s[k] (k points
// just past the `(` of `](`). Mirrors marked's link-destination regex:
// `[ \t\n]*` + href + optional title + `[ \t\n]*\)`. Returns
// { href, title, end } (end = index just past `)`) or null. `title` is
// undefined when there is none.
function readLinkTail(s, k) {
  const n = s.length;
  let p = k;
  while (p < n && (s[p] === ' ' || s[p] === '\t' || s[p] === '\n')) p++;
  if (s[p] === ')') return { href: '', title: undefined, end: p + 1 };
  let href = '';
  let destEnd;
  let angleEnd = -1;
  if (s[p] === '<') {
    let q = p + 1;
    while (q < n) {
      const ch = s[q];
      if (ch === '\n' || ch === '<') break;
      if (ch === '>') { if (q > p + 1) angleEnd = q; break; }
      if (ch === '\\') { q += 2; continue; }
      q++;
    }
    if (angleEnd !== -1) {
      href = s.slice(p, angleEnd + 1);
      destEnd = angleEnd + 1;
    }
  }
  if (angleEnd === -1) {
    // Bare destination: runs to the first space, control character, or
    // the closing paren that does not match an open paren inside it.
    // Parens must balance: an unmatched open paren is not a link.
    let q = p;
    let depth = 0;
    while (q < n) {
      const ch = s[q];
      if (ch === '\\') { q += 2; continue; }
      if (ch === '(') { depth++; q++; continue; }
      if (ch === ')') {
        if (depth === 0) break;
        depth--;
        q++;
        continue;
      }
      const c = s.charCodeAt(q);
      if (c === 32 || c === 9 || c === 10 || c < 32) break;
      q++;
    }
    if (q === p || depth !== 0) return null;
    href = s.slice(p, q);
    destEnd = q;
  }
  let t = destEnd;
  let title;
  let sepEnd = -1;
  {
    let u = t;
    let sp = 0;
    while (s[u] === ' ') { u++; sp++; }
    if (sp > 0) {
      if (s[u] === '\n') { u++; while (s[u] === ' ' || s[u] === '\t') u++; }
      sepEnd = u;
    } else if (s[u] === '\n') {
      u++;
      while (s[u] === ' ' || s[u] === '\t') u++;
      sepEnd = u;
    }
  }
  if (sepEnd !== -1) {
    const q = s[sepEnd];
    if (q === '"' || q === "'" || q === '(') {
      const close = q === '(' ? ')' : q;
      let v = sepEnd + 1;
      let ok = false;
      while (v < n) {
        const ch = s[v];
        if (ch === '\\') { v += 2; continue; }
        if (ch === close) { ok = true; break; }
        v++;
      }
      if (ok) {
        title = s.slice(sepEnd + 1, v);
        t = v + 1;
      }
    }
  }
  while (t < n && (s[t] === ' ' || s[t] === '\t' || s[t] === '\n')) t++;
  if (s[t] !== ')') return null;
  return { href, title, end: t + 1 };
}

// Parse an inline link/image starting at s[i] (`[` or `![`). Returns
// { len, isImage, href, title, label } or null.
function readInlineLink(s, i, parenOk) {
  const n = s.length;
  let isImage = false;
  let j = i;
  if (s[j] === '!') { isImage = true; j++; }
  if (s[j] !== '[') return null;
  if (!parenOk) return null;
  const cands = labelOptions(s, j);
  for (const cand of cands) {
    if (labelSpillsIntoToken(s, cand.label, j + 1)) continue;
    const k = cand.end;
    if (s[k] !== '(') continue;
    const suf = readLinkTail(s, k + 1);
    if (!suf) continue;
    let href = suf.href;
    let title = suf.title !== undefined ? suf.title : '';
    let rawLen = (k + 1 - i) + (suf.end - (k + 1));
    const trimmed = href.trim();
    if (trimmed.startsWith('<')) {
      if (!trimmed.endsWith('>')) continue;
      const inner = trimmed.slice(0, -1);
      if ((trimmed.length - rtrimChar(inner, '\\').length) % 2 === 0) continue;
    } else {
      const lastParen = closingParen(href, '()');
      if (lastParen === -2) continue;
      if (lastParen > -1) {
        rawLen = (isImage ? 5 : 4) + cand.label.length + lastParen;
        href = href.slice(0, lastParen);
        title = '';
      }
    }
    const rawText = s.slice(i, i + rawLen);
    if ((rawText.length - rtrimChar(rawText.slice(0, -1), '\\').length) % 2 === 0) continue;
    href = href.trim();
    if (trimmed.startsWith('<')) href = href.slice(1, -1);
    return {
      len: rawLen,
      isImage,
      href: unescapePunct(href),
      title: unescapePunct(title),
      label: cand.label.replace(/\\([\[\]])/g, '$1'),
    };
  }
  return null;
}

// Scan a reference label (marked's _blockLabel) starting at s[i] (s[i]
// is the first ref character). Returns { ref, end } (end = index just
// past `]`) or null.
function scanRef(s, i) {
  const n = s.length;
  let j = i;
  while (j < n && chSpace(s[j])) j++;
  if (s[j] === ']') return null;
  j = i;
  while (j < n) {
    const c = s[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '[' || c === ']') break;
    if (c === '\n') {
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

// Parse a reference link / shortcut link at s[i] (`[` or `![`).
// Returns { kind, isImage, label, ref, len } or null. The caller looks
// the ref up in the definitions; an unresolved reference is handled by
// the inline loop.
function readRefLink(s, i) {
  const n = s.length;
  let isImage = false;
  let j = i;
  if (s[j] === '!') { isImage = true; j++; }
  if (s[j] !== '[') return null;
  const cands = labelOptions(s, j);
  for (const cand of cands) {
    const k = cand.end;
    if (s[k] === '[') {
      const ref = scanRef(s, k + 1);
      if (ref && !labelSpillsIntoToken(s, cand.label, j + 1)) {
        return { kind: 'reflink', isImage, label: cand.label, ref: ref.ref, len: ref.end - i };
      }
    }
  }
  const ref = scanRef(s, j + 1);
  if (ref) {
    let end = ref.end;
    if (s[end] === '[' && s[end + 1] === ']') end += 2;
    return { kind: 'nolink', isImage, label: ref.ref, ref: ref.ref, len: end - i };
  }
  return null;
}

// Parse a (possibly multi-line) link title at s[i] (`"`, `'` or `(`).
// Returns { title, end } or null. Used for link reference definitions.
function readDefTitle(s, i) {
  const q = s[i];
  const n = s.length;
  if (q === '"') {
    let j = i + 1;
    while (j < n) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '"') return { title: s.slice(i + 1, j), end: j + 1 };
      j++;
    }
    return null;
  }
  if (q === "'") {
    let j = i + 1;
    while (j < n) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '\n') {
        if (s[j + 1] === '\n') return null;
        j++;
        continue;
      }
      if (s[j] === "'") return { title: s.slice(i + 1, j), end: j + 1 };
      j++;
    }
    return null;
  }
  if (q === '(') {
    let j = i + 1;
    while (j < n) {
      if (s[j] === '\\') { j += 2; continue; }
      if (s[j] === '(' || s[j] === ')') {
        return s[j] === ')' ? { title: s.slice(i + 1, j), end: j + 1 } : null;
      }
      j++;
    }
    return null;
  }
  return null;
}

// ===========================================================================
// 4. Emphasis / strong / strikethrough on a veiled source
// ===========================================================================

// Veiling patterns. A veiled copy of an inline run hides the delimiters
// that live inside links, code spans, HTML tags and escapes, so they can
// neither open nor close emphasis. Every replacement keeps its length,
// so indices in the veiled source line up with the raw source.

const VEIL_ESCAPES_RE = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
const VEIL_LINKS_RE = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!`)()(?<b>`+)[^`]+\k<b>(?!`)|<(?! )[^<>]*?>/g;
const VEIL_BOUNDED_LABEL = /(?:[^\[\]\\`]*(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/;
const VEIL_BLOCK_LABEL = /(?:(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})/;
const VEIL_REFLINK_RE = new RegExp(
  '!?\\[(' + VEIL_BOUNDED_LABEL.source + ')\\]\\[(' + VEIL_BLOCK_LABEL.source + ')\\]'
  + '|!?\\[(' + VEIL_BLOCK_LABEL.source + ')\\](?:\\[\\])?(?!\\()',
  'g',
);

// Does this link text hold a link already? (Images do not count: an
// image may hold a link, a link may not.) Used while veiling reflinks.
function textHasLink(st, text, parenOk) {
  if (text.indexOf('[') === -1) return false;
  for (const m of text.matchAll(VEIL_LINKS_RE)) {
    if (readInlineLink(m[0], 0, parenOk) && text.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of text.matchAll(VEIL_REFLINK_RE)) {
    const m0 = m[0];
    const refStart = m0.lastIndexOf('[');
    if (m0.charAt(0) === '!' || !st.defs.has(normalizeLabel(m0.slice(refStart + 1, -1)))) continue;
    if (refStart > 1 && textHasLink(st, m0.slice(1, refStart - 1), parenOk)) continue;
    return true;
  }
  return false;
}

// Build the veiled source for one inline run. The three masking
// regexes only run when the run holds a character they could match:
// a reflink needs `]` (and `[`, checked by the caller-side gate),
// escapes need a backtick or a backslash, and the link/tag/code
// pattern needs `[`, a backtick or `<`.
function veilRun(st, s, parenOk) {
  let veiled = s;
  if (s.indexOf('[') !== -1 && s.indexOf(']') !== -1) {
    const veilOne = (m0) => {
      const refStart = m0.lastIndexOf('[');
      if (!st.defs.has(normalizeLabel(m0.slice(refStart + 1, -1)))) return m0;
      if (refStart > 1 && m0.charAt(0) !== '!') {
        const text = m0.slice(1, refStart - 1);
        if (textHasLink(st, text, parenOk)) {
          return '[' + text.replace(VEIL_REFLINK_RE, veilOne)
            + '][' + 'a'.repeat(m0.length - refStart - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(m0.length - 2) + ']';
    };
    veiled = veiled.replace(VEIL_REFLINK_RE, veilOne);
  }
  if (s.indexOf('`') !== -1 || s.indexOf('\\') !== -1) {
    veiled = veiled.replace(VEIL_ESCAPES_RE, (m0, code, punct) => {
      if (punct) return '+'.repeat(m0.length);
      if (code) return code + m0.slice(code.length, -code.length).replace(/`/g, '+') + code;
      return m0;
    });
  }
  if (s.indexOf('[') !== -1 || s.indexOf('`') !== -1 || s.indexOf('<') !== -1) {
    veiled = veiled.replace(VEIL_LINKS_RE, (m0) => '[' + 'a'.repeat(m0.length - 2) + ']');
  }
  return veiled;
}

// Last `*` / `_` / `~` run in `src` that can close emphasis/strong/del:
// a run whose preceding character is not ASCII whitespace (a run at
// position 0 never counts). -1 when there is none.
function lastClosers(src) {
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

// Classify a delimiter run at `veiled[p..p+len)` for the right-delimiter
// rules. `delim` is `*`, `_` or `~`; `gfm` selects the GFM punctuation
// classes (tilde is not punctuation there). Returns the group number
// (1..6) or 0 when the run cannot be a delimiter at all. Groups 1-2 are
// right-delimiters only, 3-4 left-delimiters only, 5-6 either. (For `_`
// there is no group 6.)
function delimGroup(veiled, p, len, delim, gfm) {
  const prev = p === 0 ? '' : veiled[p - 1];
  const next = p + len >= veiled.length ? '' : veiled[p + len];
  if (prev === '') return 0;
  const punct = gfm ? chPunctGfm : chPunct;
  const prevIsPunct = prev !== delim && punct(prev);
  const prevIsSpace = chSpace(prev);
  const prevIsOther = !prevIsPunct && !prevIsSpace && prev !== delim;
  const nextIsSpace = next === '' || chSpace(next);
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

// Length of the delimiter run starting at s[p] (delim `*`, `_` or `~`).
function runLength(s, p) {
  const ch = s[p];
  let j = p + 1;
  while (j < s.length && s[j] === ch) j++;
  return j - p;
}

// Orphan-skip pattern for `*`: `[^_*]*?__[^_*]*?\*[^_*]*?(?=__)` at the
// start of the closer window. Returns the index just before the final
// `__`, or -1.
function orphanStar(veiled, start) {
  let i = start;
  const n = veiled.length;
  while (i < n && veiled[i] !== '*' && veiled[i] !== '_') i++;
  if (veiled[i] !== '_' || veiled[i + 1] !== '_') return -1;
  i += 2;
  while (i < n && veiled[i] !== '*' && veiled[i] !== '_') i++;
  if (veiled[i] !== '*') return -1;
  i++;
  while (i < n && veiled[i] !== '*' && veiled[i] !== '_') i++;
  if (veiled[i] === '_' && veiled[i + 1] === '_') return i;
  return -1;
}

// Orphan-skip pattern for `_`: `[^_*]*?\*\*[^_*]*?_[^_*]*?(?=\*\*)`.
function orphanUnderscore(veiled, start) {
  let i = start;
  const n = veiled.length;
  while (i < n && veiled[i] !== '*' && veiled[i] !== '_') i++;
  if (veiled[i] !== '*' || veiled[i + 1] !== '*') return -1;
  i += 2;
  while (i < n && veiled[i] !== '*' && veiled[i] !== '_') i++;
  if (veiled[i] !== '_') return -1;
  i++;
  while (i < n && veiled[i] !== '*' && veiled[i] !== '_') i++;
  if (veiled[i] === '*' && veiled[i + 1] === '*') return i;
  return -1;
}

// Try to open emphasis/strong at absolute position `pos` in the inline
// run `s` (veiled source `veiled`, closer hints `closers`). Returns
// { len, kind, text } or null.
function openEmphasis(s, veiled, closers, pos, prevChar) {
  const delim = s[pos];
  let p = pos;
  while (p < s.length && s[p] === delim) p++;
  const lLen = p - pos;
  if (p >= s.length) return null;
  const after = s[p];
  let nextPunct = '';
  let nextOther = '';
  if (after !== delim) {
    if (chPunctGfm(after)) nextPunct = after;
    else if (!chSpace(after)) nextOther = after;
  }
  if (nextPunct === '' && nextOther === '') return null;
  const nextChar = nextPunct;
  // A mid-run opener (the run started before this position, e.g. after a
  // failed attempt consumed part of it): flanking is judged on the whole
  // run, so find its start in the veiled source.
  const midRun = prevChar === delim;
  let runStart = pos;
  while (runStart > 0 && veiled[runStart - 1] === delim) runStart--;
  let runPrevChar = '';
  if (runStart > 0) {
    const slice = veiled.slice(Math.max(0, runStart - 2), runStart);
    runPrevChar = [...slice].at(-1) ?? '';
  }
  let pc = prevChar;
  let prevPunct;
  if (runStart < pos) {
    pc = runPrevChar;
    prevPunct = runPrevChar === '*' || runPrevChar === '_' || chPrevPunct(runPrevChar);
  } else {
    prevPunct = chPrevPunct(prevChar);
  }
  if (nextOther !== '' && delim === '_' && chAlnum(pc)) return null;
  if (nextChar !== '' && pc !== '' && !prevPunct) return null;
  const runLengthTotal = pos - runStart + lLen;
  const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || chPrevPunct(runPrevChar);
  const openerCanClose = runPrevChar.trim() !== ''
    && (nextChar !== '' || (delim === '*' && !runPrevPunct));
  const lastPossible = closers[delim];
  const windowStart = pos + lLen;
  if (lastPossible < windowStart) return null;
  let searchFrom = windowStart;
  let orphanSkipped = false;
  if (delim === '*') {
    const orphan = orphanStar(veiled, windowStart);
    if (orphan !== -1) { searchFrom = orphan; orphanSkipped = true; }
  } else if (delim === '_') {
    const orphan = orphanUnderscore(veiled, windowStart);
    if (orphan !== -1) { searchFrom = orphan; orphanSkipped = true; }
  }
  let delimTotal = lLen;
  let midDelimTotal = 0;
  let q = orphanSkipped ? searchFrom + 1 : searchFrom;
  const n = veiled.length;
  while (q < n) {
    while (q < n && !(veiled[q] === delim && veiled[q - 1] !== delim)) q++;
    if (q >= n) break;
    const rp = q;
    const rLen = runLength(veiled, q);
    q = rp + rLen;
    if (rp - 1 > lastPossible) break;
    const group = delimGroup(veiled, rp, rLen, delim, true);
    if (group === 0) continue;
    if (group === 3 || group === 4) {
      delimTotal += rLen;
      continue;
    }
    if (group === 5 || group === 6 || openerCanClose) {
      if (midRun && (group === 5 || group === 6)) return null;
      if (runLengthTotal % 3 !== 0 && (runLengthTotal + rLen) % 3 === 0) {
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
    const strong = Math.min(lLen, used) % 2 === 0;
    const text = strong
      ? s.slice(pos + 2, pos + rawLen - 2)
      : s.slice(pos + 1, pos + rawLen - 1);
    return { len: rawLen, kind: strong ? 'strong' : 'em', text };
  }
  return null;
}

// Try to open strikethrough at absolute position `pos`. Returns
// { len, text } or null.
function openStrikethrough(s, veiled, closers, pos, prevChar) {
  let p = pos;
  while (p < s.length && s[p] === '~') p++;
  const lLen = p - pos;
  if (lLen > 2) return null;
  if (p >= s.length) return null;
  const after = s[p];
  let nextPunct = '';
  let nextOther = '';
  if (after !== '~') {
    if (chPunct(after)) nextPunct = after;
    else if (!chSpace(after)) nextOther = after;
  }
  if (nextPunct === '' && nextOther === '') return null;
  if (nextPunct !== '' && prevChar !== '' && !chPrevPunct(prevChar)) return null;
  const lastPossible = closers['~'];
  const windowStart = pos + lLen;
  if (lastPossible < windowStart) return null;
  let delimTotal = lLen;
  let q = windowStart;
  const n = veiled.length;
  while (q < n) {
    while (q < n && !(veiled[q] === '~' && veiled[q - 1] !== '~')) q++;
    if (q >= n) break;
    const rp = q;
    const rLen = runLength(veiled, q);
    q = rp + rLen;
    if (rp - 1 > lastPossible) break;
    if (rLen !== lLen) continue;
    const group = delimGroup(veiled, rp, rLen, '~', false);
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
    return { len: rawLen, text: s.slice(pos + lLen, pos + rawLen - lLen) };
  }
  return null;
}

// ===========================================================================
// 5. The inline loop (direct render) and link emission
// ===========================================================================

// Is there a hard break (` {2,}\n`) starting at s[p]?
function hardBreakAt(s, p) {
  let j = p;
  while (s[j] === ' ') j++;
  return j >= p + 2 && s[j] === '\n';
}

// Length of the plain-text run starting at s[i], mirroring marked's GFM
// inline text token. The run stops where a construct may begin: a
// backslash, `<`, `![`, `[`, backtick/tilde run, `*`/`_`, a hard break,
// an e-mail local part, a `www.`/protocol URL, or `mailto:`/`xmpp:`.
function textRunLength(s, i) {
  const n = s.length;
  if (i < n && !chAlnum(s[i])) {
    if (s.startsWith('mailto:', i + 1) || s.startsWith('xmpp:', i + 1)) return 1;
  }
  let j = i;
  const c = s[j];
  if (c === '`') { while (j < n && s[j] === '`') j++; }
  else if (c === '~') { while (j < n && s[j] === '~') j++; }
  else j++;
  if (j < n && (s[j] === '`' || s[j] === '~')) return j - i;
  if (hardBreakAt(s, j)) return j - i;
  if (mailLocalAhead(s, j)) return j - i;
  while (j < n) {
    const code = s.charCodeAt(j);
    if (code === 92 || code === 60 || code === 33 || code === 91 || code === 96
      || code === 42 || code === 126 || code === 95) return j - i;
    if (code === 119 && wwwAt(s, j)) return j - i;
    if ((code === 104 || code === 72 || code === 102 || code === 70) && protocolAt(s, j)) return j - i;
    j++;
    if (code !== 32 && s[j] === ' ' && s[j + 1] === ' ' && hardBreakAt(s, j)) return j - i;
    const prevAlnum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 128 && UNICODE_ALNUM_RE.test(s[j - 1]));
    if (!prevAlnum) {
      const nj = s[j];
      if ((nj === 'm' || nj === 'x') && (s.startsWith('mailto:', j) || s.startsWith('xmpp:', j))) return j - i;
    }
    const prevMail = (code >= 48 && code <= 57) || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122) || code === 46 || code === 33 || code === 35
      || code === 36 || code === 37 || code === 38 || code === 39 || code === 42
      || code === 43 || code === 47 || code === 61 || code === 63 || code === 94
      || code === 95 || code === 96 || code === 123 || code === 124 || code === 125
      || code === 126 || code === 45;
    if (!prevMail && mailLocalAhead(s, j)) return j - i;
  }
  return n - i;
}

// Render an autolink / GFM url token: `<a href="...">text</a>` with both
// parts escaped fully; when the href cannot be cleaned, just the text.
function pushAutolink(out, tok) {
  const clean = cleanHref(tok.href);
  if (clean === null) { out.push(escapeHtml(tok.text, false)); return; }
  out.push('<a href="' + escapeHtml(clean, false) + '">' + escapeHtml(tok.text, false) + '</a>');
}

// Emit a link/image into `out` (or its plain text when `mode === 'text'`).
// `lk` has { href, title, label, isImage }. Returns true when the token
// was emitted, false when the link must bail (a non-image link whose label
// already holds a link) — the caller then falls through to plain text.
function pushLink(st, out, lk, mode, parenOk) {
  const savedInLink = st.inLink;
  const savedEmitted = st.linkEmitted;
  const savedInRaw = st.inRaw;
  st.inLink = true;
  st.linkEmitted = false;
  const labelText = lk.label.replace(/\\([\[\]])/g, '$1');
  const labelMode = lk.isImage ? 'text' : mode;
  const labelOut = [];
  renderInline(st, labelOut, labelText, labelMode, parenOk);
  const textHasLink = st.linkEmitted;
  st.linkEmitted = savedEmitted;
  st.inLink = savedInLink;
  if (!lk.isImage) {
    if (textHasLink) { st.inRaw = savedInRaw; return false; }
    st.linkEmitted = true;
  }
  if (mode === 'text') {
    for (const part of labelOut) out.push(part);
    return true;
  }
  const clean = cleanHref(lk.href);
  if (lk.isImage) {
    const alt = labelOut.join('');
    if (clean === null) { out.push(escapeHtml(alt, true)); return true; }
    out.push('<img src="' + escapeHtml(clean, true) + '" alt="' + escapeHtml(alt, true) + '"');
    if (lk.title) out.push(' title="' + escapeHtml(lk.title, true) + '"');
    out.push('>');
    return true;
  }
  if (clean === null) {
    for (const part of labelOut) out.push(part);
    return true;
  }
  out.push('<a href="' + escapeHtml(clean, true) + '"');
  if (lk.title) out.push(' title="' + escapeHtml(lk.title, true) + '"');
  out.push('>');
  for (const part of labelOut) out.push(part);
  out.push('</a>');
  return true;
}

// Anything that can start inline syntax, an autolink, or a hard break:
// backslash, `<`, `[`, `*`, `_`, backtick, `~`, `@` (e-mail), `![`,
// `www.`, `://`, or two spaces before a newline. A run containing none
// of these is plain text: one escaped/decoded push, no per-char loop.
const INLINE_SYNTAX_RE = /[\\<\[*_`~@]|!\[|www\.|:\/\/|  \n/;
const TEXT_ESC_RE = /[&<>"']/;

// Render one inline run `s` into `out`. `mode` is 'html' (normal output)
// or 'text' (plain-text flattening, like marked's TextRenderer for image
// alt text). `parenOk` is the outer run's link-paren state: a link is
// only attempted when the run contains `)`.
function renderInline(st, out, s, mode, parenOk) {
  const n = s.length;
  if (n === 0) return;
  if (!INLINE_SYNTAX_RE.test(s)) {
    if (mode === 'text') out.push(st.inRaw ? s : decodeNumericRefs(s));
    else out.push(st.inRaw ? s : textRun(s));
    return;
  }
  const runParenOk = parenOk && s.indexOf(')') !== -1;
  let veiled = null;
  let closers = null;
  let rawClosers = null;
  const needVeil = () => {
    if (veiled === null) {
      veiled = veilRun(st, s, runParenOk);
      closers = lastClosers(veiled);
    }
  };
  const needRawClosers = () => {
    if (rawClosers === null) rawClosers = lastClosers(s);
  };
  let i = 0;
  let prevChar = '';
  let afterText = false;
  while (i < n) {
    if (!afterText) prevChar = '';
    afterText = false;
    const c = s[i];
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx !== undefined && chAsciiPunct(nx)) {
        out.push(mode === 'text' ? nx : textRun(nx));
        i += 2;
        continue;
      }
      const brLen = findHardBreak(s, i);
      if (brLen > 0) {
        if (mode === 'html') out.push('<br>');
        i += brLen;
        continue;
      }
    } else if (c === '<') {
      const tagLen = findTag(s, i);
      if (tagLen > 0) {
        const raw = s.slice(i, i + tagLen);
        if (!st.inLink && /^<a /i.test(raw)) st.inLink = true;
        else if (st.inLink && /^<\/a>/i.test(raw)) st.inLink = false;
        if (!st.inRaw && /^<(pre|code|kbd|script)(\s|>)/i.test(raw)) st.inRaw = true;
        else if (st.inRaw && /^<\/(pre|code|kbd|script)(\s|>)/i.test(raw)) st.inRaw = false;
        out.push(raw);
        i += tagLen;
        continue;
      }
      const al = findAutolink(s, i);
      if (al) {
        if (mode === 'text') out.push(al.text);
        else pushAutolink(out, al);
        i += al.len;
        continue;
      }
    } else if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      if (runParenOk) {
        const lk = readInlineLink(s, i, runParenOk);
        if (lk && pushLink(st, out, lk, mode, runParenOk)) { i += lk.len; continue; }
      }
      const rl = readRefLink(s, i);
      if (rl) {
        const def = st.defs.get(normalizeLabel(rl.ref));
        if (def) {
          if (pushLink(st, out, { href: def.href, title: def.title, label: rl.label, isImage: rl.isImage }, mode, runParenOk)) {
            i += rl.len;
            continue;
          }
        } else {
          out.push(mode === 'text' ? s[i] : textRun(s[i]));
          if (s[i] !== '_') prevChar = s[i];
          afterText = true;
          i += 1;
          continue;
        }
      }
    } else if (c === '*' || c === '_') {
      const rLen = runLength(s, i);
      needRawClosers();
      if (rawClosers[c] >= i + rLen) {
        needVeil();
        const em = openEmphasis(s, veiled, closers, i, prevChar);
        if (em) {
          if (mode === 'html') {
            out.push(em.kind === 'strong' ? '<strong>' : '<em>');
            renderInline(st, out, em.text, mode, runParenOk);
            out.push(em.kind === 'strong' ? '</strong>' : '</em>');
          } else {
            renderInline(st, out, em.text, mode, runParenOk);
          }
          i += em.len;
          continue;
        }
      }
      if (!st.inLink) {
        const u = findUrl(s, i);
        if (u) {
          if (mode === 'text') out.push(u.text);
          else pushAutolink(out, u);
          i += u.len;
          continue;
        }
      }
    } else if (c === '`') {
      const cs = findCodeSpan(s, i);
      if (cs) {
        if (mode === 'html') out.push('<code>' + escapeHtml(cs.text, false) + '</code>');
        else out.push(cs.text);
        i += cs.len;
        continue;
      }
    } else if (c === ' ') {
      const brLen = findHardBreak(s, i);
      if (brLen > 0) {
        if (mode === 'html') out.push('<br>');
        i += brLen;
        continue;
      }
    } else if (c === '~') {
      const rLen = runLength(s, i);
      needRawClosers();
      if (rawClosers['~'] >= i + rLen) {
        needVeil();
        const d = openStrikethrough(s, veiled, closers, i, prevChar);
        if (d) {
          if (mode === 'html') {
            out.push('<del>');
            renderInline(st, out, d.text, mode, runParenOk);
            out.push('</del>');
          } else {
            renderInline(st, out, d.text, mode, runParenOk);
          }
          i += d.len;
          continue;
        }
      }
    } else if (!st.inLink && chMail(c)) {
      const u = findUrl(s, i);
      if (u) {
        if (mode === 'text') out.push(u.text);
        else pushAutolink(out, u);
        i += u.len;
        continue;
      }
    }
    const len = textRunLength(s, i);
    const raw = s.slice(i, i + len);
    if (mode === 'text') out.push(st.inRaw ? raw : decodeNumericRefs(raw));
    else if (st.inRaw || !TEXT_ESC_RE.test(raw)) out.push(raw);
    else out.push(textRun(raw));
    const lastCh = raw.charAt(raw.length - 1);
    if (lastCh !== '_') prevChar = lastCh;
    afterText = true;
    i += len;
  }
}

// Render one top-level inline run (a block's text): the raw-block state
// is reset first, exactly as marked does before each inline run.
function renderInlineTop(st, out, s) {
  st.inRaw = false;
  renderInline(st, out, s, 'html', true);
}

// ===========================================================================
// 6. Block layer: node tags, line classifiers, leaf rules
// ===========================================================================

// Node tags for the flat record arrays [tag, ...payload].
const N_SPACE = 0; // [0, blankCount]
const N_CODE = 1; // [1, text, lang]
const N_HEAD = 2; // [2, depth, text]
const N_HR = 3; // [3]
const N_QUOTE = 4; // [4, innerNodes, rawLines, strippedLines]
const N_LIST = 5; // [5, ordered, start, loose, items, srcLines]
const N_HTML = 6; // [6, text]
const N_PARA = 7; // [7, text]
const N_TEXT = 8; // [8, text]
const N_TABLE = 9; // [9, headerCells, align, rows]

// Block-level HTML tags (marked's list K) for the html interrupt
// (types 1-6) and the html block rule.
const HTML_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const HTML_INTERRUPT_RE = new RegExp('^ {0,3}(?:</?(?:' + HTML_TAGS + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)');
const TABLE_DELIM_RE = /^ {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?$/;
const TABLE_DELIM_PIPE_RE = /^ {0,3}\|?(?:[:\- ]*\|)+[:\- ]*$/;
const SETEXT_UNDER_RE = /^ {0,3}(=+|-+)[ \t]*$/;

// [indentCols, firstNonWsIdx] of a line.
function lineIndent(line) {
  let col = 0;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ') { col += 1; i += 1; }
    else if (ch === '\t') { col += 4 - (col % 4); i += 1; }
    else break;
  }
  return [col, i];
}

// Is `line` a horizontal rule? ` {0,3}` + 3+ of one of `-`, `_`, `*`,
// with only spaces/tabs between.
function lineIsHr(line) {
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
function lineIsHeading(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 3) i++;
  let j = i;
  while (j < line.length && line[j] === '#') j++;
  const d = j - i;
  if (d === 0 || d > 6) return false;
  return j >= line.length || chSpace(line[j]);
}

// Is `line` a fenced-code opening? Backtick run 3+ with no backtick in
// the rest of the line, or a tilde run 3+.
function lineIsFence(line) {
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

function lineIsQuote(line) {
  return /^ {0,3}>/.test(line);
}

// GFM paragraph variant: bullet + whitespace + a non-space character
// (only `1.` interrupts paragraphs).
function lineIsListGfm(line) {
  return /^ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t]/.test(line);
}

// Blockquote/list variant: any bullet + space/tab/end.
function lineIsListKe(line) {
  return /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/.test(line);
}

function lineIsHtmlInterrupt(line) {
  return HTML_INTERRUPT_RE.test(line);
}

// Is `line` an indented-code line? ` {4}` or ` {0,3}\t`, then a char.
function lineIsCode(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 4) i++;
  if (i === 4) return line.length > 4;
  return line[i] === '\t' && line.length > i + 1;
}

// Does the line at `j` start a table (header line + delimiter line)?
// This is the paragraph-continuation interrupt: any delimiter-shaped
// next line stops the paragraph — even a bare `---` (the table rule may
// still reject it, and then it becomes a setext underline instead).
function tableStartsAt(lines, j) {
  if (isBlank(lines[j])) return false;
  if (j + 1 >= lines.length) return false;
  return TABLE_DELIM_RE.test(lines[j + 1]);
}

// Split a table row/header line into cells (marked's splitCells): split
// on unescaped ` |`, drop an empty first/last cell (leading/trailing
// pipe), pad/truncate to `count`, trim, unescape `\|`.
function splitTableCells(str, count) {
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

// --- leaf block rules (each returns null or { next, ... }) ---------------

// Indented code block at lines[i]. Returns { text, next } where next is
// the index just past the last code line (trailing blank lines are not
// consumed: they belong to the following space run).
function readCode(lines, i) {
  const n = lines.length;
  let lastCode = -1;
  let j = i;
  while (j < n) {
    if (lineIsCode(lines[j])) { lastCode = j; j++; continue; }
    if (isBlank(lines[j])) {
      let k = j;
      while (k < n && isBlank(lines[k])) k++;
      if (k < n && lineIsCode(lines[k])) { j = k; continue; }
    }
    break;
  }
  if (lastCode < 0) return null;
  let text = lines.slice(i, lastCode + 1).map((line) => stripIndent(line, 4)).join('\n');
  const after = lastCode + 1;
  if (after < n && !(isBlank(lines[after]) && after < n - 1)) text += '\n';
  return { text, next: lastCode + 1 };
}

// Fenced code block at lines[i]. Returns { text, lang, next }.
function readFence(lines, i) {
  const first = lines[i];
  let sp = 0;
  while (sp < first.length && first[sp] === ' ' && sp < 3) sp++;
  const ch = first[sp];
  if (ch !== '`' && ch !== '~') return null;
  let j = sp;
  while (j < first.length && first[j] === ch) j++;
  const runLen = j - sp;
  if (runLen < 3) return null;
  if (ch === '`' && first.indexOf('`', j) !== -1) return null;
  const info = first.slice(j);
  const n = lines.length;
  let closeIdx = -1;
  for (let p = i + 1; p < n; p++) {
    const ln = lines[p];
    let k = 0;
    while (k < ln.length && ln[k] === ' ' && k < 3) k++;
    if (ln[k] === ch) {
      let m = k;
      while (m < ln.length && ln[m] === ch) m++;
      if (m - k >= runLen) {
        let t = m;
        while (t < ln.length && ln[t] === ' ') t++;
        if (t === ln.length) { closeIdx = p; break; }
      }
    }
  }
  const contentEnd = closeIdx === -1 ? n : closeIdx;
  let text = lines.slice(i + 1, contentEnd).join('\n');
  if (ch === '`' && sp > 0) {
    text = text.split('\n').map((line) => {
      const m = /^\s+/.exec(line);
      if (!m) return line;
      return line.slice(Math.min(m[0].length, sp));
    }).join('\n');
  }
  const lang = info.trim() ? unescapePunct(info.trim()) : info;
  return { text, lang, next: contentEnd === n ? n : closeIdx + 1 };
}

// ATX heading at lines[i]. Returns { depth, text, next }.
function readHeading(lines, i) {
  const line = lines[i];
  let sp = 0;
  while (sp < line.length && line[sp] === ' ' && sp < 3) sp++;
  let j = sp;
  while (j < line.length && line[j] === '#') j++;
  const depth = j - sp;
  if (depth === 0 || depth > 6) return null;
  if (j < line.length && !chSpace(line[j])) return null;
  let text = line.slice(j).trim();
  if (text.endsWith('#')) {
    const s = rtrimChar(text, '#');
    if (!s || /[ \t]$/.test(s)) text = s.trim();
  }
  return { depth, text, next: i + 1 };
}

// Parse a link reference definition starting at lines[i], using the
// joined tail string (a definition may span lines). Returns
// { tag, href, title, next } (next = index just past the definition's
// last line) or null. Mirrors marked's def rule:
//   ^ {0,3}\[(label)\]: *(?:\n[ \t]*)?(dest)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)
// with title = "..." | '...' (no blank line) | (...). A title that
// parses but is followed by junk falls back to a title-less definition,
// which is valid only when the destination itself is followed by spaces
// and a line end.
function readDef(st, lines, i) {
  const tail = lines.slice(i).join('\n');
  const n = tail.length;
  let p = 0;
  while (p < n && tail[p] === ' ' && p < 3) p++;
  if (tail[p] !== '[') return null;
  const lab = scanRef(tail, p + 1);
  if (!lab) return null;
  let k = lab.end;
  if (tail[k] !== ':') return null;
  k++;
  while (tail[k] === ' ') k++;
  if (tail[k] === '\n') { k++; while (tail[k] === ' ' || tail[k] === '\t') k++; }
  let href = '';
  if (tail[k] === '<') {
    const end = tail.indexOf('>', k + 1);
    const nl = tail.indexOf('\n', k);
    if (end === -1 || (nl !== -1 && end > nl)) return null;
    href = tail.slice(k + 1, end);
    k = end + 1;
  } else {
    let m = k;
    while (m < n && !chSpace(tail[m])) m++;
    if (m === k) return null;
    href = tail.slice(k, m);
    k = m;
  }
  if (!href.startsWith('<') && closingParen(href, '()') !== -1) return null;
  const cleanHref = href.startsWith('<') && href.endsWith('>')
    ? unescapePunct(href.slice(1, -1))
    : unescapePunct(href);
  const lineEndOk = (q) => {
    let e = q;
    while (tail[e] === ' ') e++;
    return tail[e] === '\n' || e >= n ? e : -1;
  };
  const makeDef = (rawEnd, title) => {
    const rawLines = tail.slice(0, rawEnd).split('\n').length;
    return {
      tag: normalizeLabel(lab.ref),
      href: cleanHref,
      title: title !== undefined ? unescapePunct(title) : undefined,
      next: i + rawLines - (tail.slice(0, rawEnd).endsWith('\n') ? 1 : 0),
      raw: tail.slice(0, rawEnd),
    };
  };
  let u = k;
  let sep = false;
  let sp = 0;
  while (tail[u] === ' ') { u++; sp++; }
  if (sp > 0) {
    sep = true;
    if (tail[u] === '\n') { u++; while (tail[u] === ' ' || tail[u] === '\t') u++; }
  } else if (tail[u] === '\n') {
    sep = true;
    u++;
    while (tail[u] === ' ' || tail[u] === '\t') u++;
  }
  if (sep) {
    const t = readDefTitle(tail, u);
    if (t) {
      const e = lineEndOk(t.end);
      if (e !== -1) return makeDef(e, t.title);
    }
  }
  const e = lineEndOk(k);
  if (e !== -1) return makeDef(e, undefined);
  return null;
}

// HTML block at lines[i]. Returns { text, next } or null.
function readHtml(lines, i) {
  const first = lines[i];
  let sp = 0;
  while (sp < first.length && first[sp] === ' ' && sp < 3) sp++;
  if (first[sp] !== '<') return null;
  const rest = first.slice(sp);
  const lower = rest.toLowerCase();
  const tail = lines.slice(i).join('\n');
  const n = tail.length;
  const coverLines = (text) => {
    let c = 0;
    for (let q = 0; q < text.length; q++) if (text[q] === '\n') c++;
    return text.endsWith('\n') ? c : c + 1;
  };
  const endAfter = (at) => {
    let le = tail.indexOf('\n', at);
    if (le === -1) le = n;
    let e = le;
    while (tail[e] === '\n') e++;
    return e;
  };
  let matchEnd = -1;
  const m1 = /^(script|pre|style|textarea)(?:[\s>]|$)/.exec(lower.slice(1));
  if (m1) {
    const closeRe = new RegExp('</' + m1[1] + '>', 'i');
    const cm = closeRe.exec(tail);
    matchEnd = cm ? endAfter(cm.index + cm[0].length) : n;
  } else if (rest.startsWith('<!--')) {
    if (rest.startsWith('<!-->') || rest.startsWith('<!--->')) {
      matchEnd = endAfter(0);
    } else {
      const end = tail.indexOf('-->', 4);
      matchEnd = end === -1 ? n : endAfter(end + 3);
    }
  } else if (rest.startsWith('<?')) {
    const end = tail.indexOf('?>', 2);
    matchEnd = end === -1 ? n : endAfter(end + 2);
  } else if (/^<![A-Z]/.test(rest)) {
    const end = tail.indexOf('>', 2);
    matchEnd = end === -1 ? n : endAfter(end + 1);
  } else if (rest.startsWith('<![CDATA[')) {
    const end = tail.indexOf(']]>', 9);
    matchEnd = end === -1 ? n : endAfter(end + 3);
  } else {
    const tagRe = new RegExp('^</?(?:' + HTML_TAGS + ')(?:[ \\t]+|$|/?>)', 'i');
    const openRe = /^<(?!script|pre|style|textarea)([a-z][a-z0-9-]*)(?: +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?)* *\/?>(?=[ \t]*(?:\n|$))/i;
    const closeRe = /^<\/[a-z][a-z0-9-]*\s*>(?=[ \t]*(?:\n|$))/i;
    if (!tagRe.test(rest) && !openRe.test(rest) && !closeRe.test(rest)) return null;
    let p = i + 1;
    let end = n;
    while (p < lines.length) {
      if (isBlank(lines[p])) {
        const off = lines.slice(i, p).join('\n').length + (p > i ? 1 : 0);
        const le = off + lines[p].length;
        end = le === n ? n : le + 1;
        break;
      }
      p++;
    }
    matchEnd = end;
  }
  if (matchEnd === -1) return null;
  const text = trimTrailingBlanks(tail.slice(0, matchEnd));
  return { text, next: i + coverLines(text) };
}

// Table at lines[i]. Returns { header, align, rows, next } or null.
function readTable(lines, i) {
  const headerLine = lines[i];
  if (isBlank(headerLine)) return null;
  if (i + 1 >= lines.length) return null;
  const delimLine = lines[i + 1];
  if (!TABLE_DELIM_RE.test(delimLine)) return null;
  if (!/[:|]/.test(delimLine)) return null;
  const headerCells = splitTableCells(headerLine.replace(/^ +/, ''));
  const alignParts = delimLine.replace(/^\||\| *$/g, '').split('|');
  if (headerCells.length !== alignParts.length) return null;
  const align = alignParts.map((part) => {
    if (/^ *-+: *$/.test(part)) return 'right';
    if (/^ *:-+: *$/.test(part)) return 'center';
    if (/^ *:-+ *$/.test(part)) return 'left';
    return null;
  });
  const rows = [];
  let p = i + 2;
  while (p < lines.length) {
    const ln = lines[p];
    if (/^ *$/.test(ln) || lineIsHr(ln) || lineIsHeading(ln) || lineIsQuote(ln)
      || lineIsCode(ln) || lineIsFence(ln) || lineIsListGfm(ln) || lineIsHtmlInterrupt(ln)) break;
    rows.push(ln);
    p++;
  }
  return {
    header: headerCells,
    align,
    rows: rows.map((r) => splitTableCells(r, headerCells.length)),
    next: p,
  };
}

// Setext heading at lines[i]. Returns { depth, text, next } or null.
function readSetext(lines, i) {
  const first = lines[i];
  if (first === '') return null;
  if (setextBadFirst(first)) return null;
  const collected = [first];
  let j = i + 1;
  while (j < lines.length) {
    const ln = lines[j];
    const um = SETEXT_UNDER_RE.exec(ln);
    if (um) {
      return {
        depth: ln.trimStart().charAt(0) === '=' ? 1 : 2,
        text: collected.join('\n').trim(),
        next: j + 1,
      };
    }
    if (isBlank(ln) || setextBadCont(ln)) return null;
    collected.push(ln);
    j++;
  }
  return null;
}

// First line of a setext heading may not be a bullet, indented code,
// fence, blockquote, heading, html tag line, or table delimiter line.
function setextBadFirst(line) {
  if (/^ {0,3}(?:[*+-]|\d{1,9}[.)]) /.test(line)) return true;
  if (lineIsCode(line)) return true;
  if (lineIsFence(line)) return true;
  if (lineIsQuote(line)) return true;
  if (lineIsHeading(line)) return true;
  if (/^ {0,3}<[^>\n]+>$/.test(line)) return true;
  if (TABLE_DELIM_PIPE_RE.test(line)) return true;
  return false;
}

// Continuation lines of a setext heading may not be blank or a bullet,
// fence, blockquote, heading, hr, html tag line, or table delimiter line.
function setextBadCont(line) {
  if (/^ {0,3}(?:[*+-]|\d{1,9}[.)]) /.test(line)) return true;
  if (lineIsFence(line)) return true;
  if (lineIsQuote(line)) return true;
  if (lineIsHeading(line)) return true;
  if (lineIsHr(line)) return true;
  if (/^ {0,3}<[^>\n]+>$/.test(line)) return true;
  if (TABLE_DELIM_PIPE_RE.test(line)) return true;
  return false;
}

// Does line `lines[j]` interrupt a paragraph? (hr, heading, blockquote,
// fences, list, html, table start — no indented code, no setext, no def.)
function paragraphInterrupt(lines, j) {
  const ln = lines[j];
  if (isBlank(ln)) return true;
  const [ind, fi] = lineIndent(ln);
  if (ind >= 4) return false;
  const ch = ln[fi];
  if (ch === '#') { if (lineIsHeading(ln)) return true; }
  else if (ch === '`' || ch === '~') { if (lineIsFence(ln)) return true; }
  else if (ch === '>') return true;
  else if (ch === '-' || ch === '+' || ch === '*' || ch === '_') {
    if (lineIsHr(ln) || lineIsListGfm(ln)) return true;
  }
  else if (ch >= '0' && ch <= '9') { if (lineIsListGfm(ln)) return true; }
  else if (ch === '<') { if (lineIsHtmlInterrupt(ln)) return true; }
  return tableStartsAt(lines, j);
}

// Paragraph at lines[i]. Returns { text, next }.
function readPara(lines, i) {
  const n = lines.length;
  const collected = [lines[i]];
  let j = i + 1;
  while (j < n) {
    const ln = lines[j];
    if (isBlank(ln)) {
      if (j === n - 1) { collected.push(ln); j = n; }
      break;
    }
    if (paragraphInterrupt(lines, j)) break;
    collected.push(ln);
    j++;
  }
  let text = collected.join('\n');
  if (text.charCodeAt(text.length - 1) === 10) text = text.slice(0, -1);
  return { text, next: j };
}

// --- blockquote ------------------------------------------------------------

// Is the line at `lines[j]` an interrupt for a lazy blockquote
// continuation (hr, heading, blockquote, fences, list, html, blank —
// no indented code, no setext, and no table: marked's blockquote
// regex lets a table-looking line continue the lazy paragraph).
function lazyInterrupt(lines, j) {
  const ln = lines[j];
  return isBlank(ln) || lineIsHr(ln) || lineIsHeading(ln) || lineIsQuote(ln)
    || lineIsFence(ln) || lineIsListKe(ln) || lineIsHtmlInterrupt(ln);
}

// Strip one blockquote marker from a line (no-op when there is none).
function stripQuoteMarker(line) {
  return line.replace(/^ {0,3}>[ \t]?/, '');
}

// Strip the markers of one collected frame (array of lines) into the
// frame's content lines, applying marked's tab-expansion after the
// marker and the setext-underline indentation on the way.
function stripQuoteFrame(frame) {
  const out = [];
  for (let idx = 0; idx < frame.length; idx++) {
    const line = frame[idx];
    const m = /^( {0,3}>)([ \t]+)/.exec(line);
    if (m) {
      const rest = line.slice(m[0].length);
      out.push(m[1] + tabsToSpaces(m[2], m[1].length) + rest);
      continue;
    }
    if (idx > 0) {
      const sm = /^ {0,3}((?:=+|-+)[ \t]*)$/.exec(line);
      if (sm) { out.push('    ' + sm[1]); continue; }
    }
    out.push(line);
  }
  return out.map((line) => line.replace(/^ {0,3}>[ \t]?/, ''));
}

// Parse a blockquote at lines[i]. Returns { rec, next } or null, where
// next is the index just past the consumed lines.
function readQuote(st, lines, i) {
  const n = lines.length;
  if (!lineIsQuote(lines[i])) return null;
  const collected = [];
  let p = i;
  while (p < n) {
    const ln = lines[p];
    if (!lineIsQuote(ln)) break;
    collected.push(ln);
    p++;
    const content = ln.replace(/^ {0,3}> ?/, '');
    if (content.trim() !== '') {
      while (p < n && !lazyInterrupt(lines, p)) {
        collected.push(lines[p]);
        p++;
      }
    }
  }
  if (collected.length === 0) return null;
  const inner = [];
  let rawLines = [];
  let strippedLines = [];
  let rest = collected;
  let consumed = 0;
  while (rest.length > 0) {
    let seen = false;
    const frame = [];
    let q = 0;
    for (; q < rest.length; q++) {
      if (lineIsQuote(rest[q])) { frame.push(rest[q]); seen = true; }
      else if (!seen) frame.push(rest[q]);
      else break;
    }
    const frameLines = stripQuoteFrame(frame);
    lexInto(st, frameLines, true, inner, true);
    rawLines = rawLines.concat(frame);
    strippedLines = strippedLines.concat(frameLines);
    consumed += q;
    rest = rest.slice(q);
    if (rest.length === 0) break;
    const last = inner[inner.length - 1];
    if (last && (last[0] === N_CODE || last[0] === N_HEAD || last[0] === N_HR
      || last[0] === N_HTML || last[0] === N_TABLE)) break;
    if (last && last[0] === N_QUOTE) {
      const g = last;
      const restStripped = rest.map(stripQuoteMarker);
      const combined = g[2].concat(restStripped);
      const reparsed = readQuote(st, combined, 0);
      inner[inner.length - 1] = reparsed.rec;
      const usedRest = reparsed.next - g[2].length;
      strippedLines = strippedLines.slice(0, strippedLines.length - g[3].length)
        .concat(reparsed.rec[3]);
      rawLines = rawLines.concat(rest.slice(0, usedRest));
      consumed += usedRest;
      rest = rest.slice(usedRest);
      if (rest.length > 0 && lineIsQuote(rest[0])) continue;
      break;
    } else if (last && last[0] === N_LIST) {
      const g = last;
      const combined = g[5].concat(rest);
      const reparsed = readList(st, combined, 0);
      inner[inner.length - 1] = reparsed.rec;
      const f = reparsed.next - g[5].length;
      if (f > 0) {
        const y = rest.slice(0, f);
        rawLines = rawLines.concat(y);
        strippedLines = strippedLines.concat(y);
        consumed += f;
        rest = rest.slice(f);
      }
      continue;
    }
  }
  const rec = [N_QUOTE, inner, rawLines, strippedLines];
  return { rec, next: i + consumed };
}

// --- list ------------------------------------------------------------------

// Interrupt patterns for list-item continuation lines, built once per
// content-indent limit RL (0-3) and cached.
const LIST_RES_CACHE = [];
function listRes(RL) {
  let r = LIST_RES_CACHE[RL];
  if (!r) {
    r = {
      bullet: new RegExp('^ {0,' + RL + '}(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))'),
      hr: new RegExp('^ {0,' + RL + '}((?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)'),
      fences: new RegExp('^ {0,' + RL + '}(?:```|~~~)'),
      heading: new RegExp('^ {0,' + RL + '}#{1,6}(?:\\s|$)'),
      html: new RegExp('^ {0,' + RL + '}(?:</?(?:' + HTML_TAGS + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)', 'i'),
      blockquote: new RegExp('^ {0,' + RL + '}>'),
    };
    LIST_RES_CACHE[RL] = r;
  }
  return r;
}

// Does `line` interrupt a list item at indent limit RL (any of the six
// interrupt shapes)? The first non-space character decides which shapes
// can match at all, so plain text lines skip every regex.
function listInterrupts(line, RL) {
  let k = 0;
  while (k < line.length && line[k] === ' ') k++;
  if (k > RL) return false;
  const c = line[k];
  const res = listRes(RL);
  switch (c) {
    case '`': case '~': return res.fences.test(line);
    case '#': return res.heading.test(line);
    case '<': return res.html.test(line);
    case '>': return res.blockquote.test(line);
    case '-': case '*': return res.bullet.test(line) || res.hr.test(line);
    case '+': return res.bullet.test(line);
    case '_': return res.hr.test(line);
    default:
      return c >= '0' && c <= '9' ? res.bullet.test(line) : false;
  }
}

// Does `line` match the fence/heading/html/hr interrupt shapes at RL
// (the shapes a lazy continuation line must not follow)?
function listInterruptsLazy(line, RL) {
  let k = 0;
  while (k < line.length && line[k] === ' ') k++;
  if (k > RL) return false;
  const c = line[k];
  const res = listRes(RL);
  switch (c) {
    case '`': case '~': return res.fences.test(line);
    case '#': return res.heading.test(line);
    case '<': return res.html.test(line);
    case '-': case '+': case '*': case '_': return res.hr.test(line);
    default: return false;
  }
}

// Does `line` start a list item with the given marker? `marker` is the
// bullet character for unordered lists, or the `.`/`)` delimiter for
// ordered ones. Returns { bulletEnd, rest } or null.
function matchItem(line, ordered, marker) {
  let sp = 0;
  while (sp < line.length && line[sp] === ' ' && sp < 3) sp++;
  if (ordered) {
    let j = sp;
    while (j < line.length && line[j] >= '0' && line[j] <= '9') j++;
    if (j - sp === 0 || j - sp > 9) return null;
    if (line[j] !== marker) return null;
    const after = line.slice(j + 1);
    if (after !== '' && after[0] !== ' ' && after[0] !== '\t') return null;
    return { bulletEnd: j + 1, rest: after };
  }
  if (line[sp] !== marker) return null;
  const after = line.slice(sp + 1);
  if (after !== '' && after[0] !== ' ' && after[0] !== '\t') return null;
  return { bulletEnd: sp + 1, rest: after };
}

// Parse a list at lines[i]. Returns { rec, next } or null.
function readList(st, lines, i) {
  const n = lines.length;
  const firstLine = lines[i];
  let sp = 0;
  while (sp < firstLine.length && firstLine[sp] === ' ' && sp < 3) sp++;
  const ch = firstLine[sp];
  let ordered = false;
  let marker = '';
  let startNum = '';
  if (ch === '-' || ch === '+' || ch === '*') {
    marker = ch;
    sp++;
  } else if (ch >= '0' && ch <= '9') {
    let j = sp;
    while (j < firstLine.length && firstLine[j] >= '0' && firstLine[j] <= '9') j++;
    if (j - sp > 9) return null;
    if (firstLine[j] !== '.' && firstLine[j] !== ')') return null;
    marker = firstLine[j];
    ordered = true;
    startNum = firstLine.slice(sp, j);
    sp = j + 1;
  } else {
    return null;
  }
  const afterBullet = firstLine.slice(sp);
  if (afterBullet !== '' && afterBullet[0] !== ' ' && afterBullet[0] !== '\t') return null;
  if (lineIsHr(firstLine)) return null;
  const listStart = i;
  const items = [];
  let loose = false;
  let pFlag = false;
  let e = i;
  while (e < n) {
    const m0 = matchItem(lines[e], ordered, marker);
    if (!m0 || lineIsHr(lines[e])) break;
    const itemStartIdx = e;
    e++;
    const g = m0.rest;
    const b = m0.bulletEnd;
    let m = g;
    const wsm = /^[ \t]+/.exec(g);
    if (wsm) m = tabsToSpaces(wsm[0], b) + g.slice(wsm[0].length);
    let blankItem = m.trim() === '';
    let R;
    const dLines = [];
    if (blankItem) {
      R = b + 1;
    } else {
      let r = m.search(/[^ ]/);
      if (r === -1) r = m.length;
      R = r > 4 ? 1 : r;
      dLines.push(m.slice(R));
      R += b;
    }
    let u = false;
    if (blankItem && e < n && isBlank(lines[e])) {
      e++;
      u = true;
    }
    if (!u) {
      const RL = Math.max(0, Math.min(3, R - 1));
      while (e < n) {
        const U = lines[e];
        const Z = U.indexOf('\t') === -1 ? U : U.replace(/^[ \t]+/, (me) => tabsToSpaces(me, 0));
        if (listInterrupts(U, RL)) break;
        const uBlank = isBlank(U);
        let zi = 0;
        while (zi < Z.length && Z[zi] === ' ') zi++;
        if (zi >= R || uBlank) {
          dLines.push(Z.slice(R));
        } else {
          if (blankItem || firstNonSpaceCol(m) >= 4 || listInterruptsLazy(m, RL)) break;
          let qe = U;
          if (/^ {0,3}(=+|-+) *$/.test(U) && readSetext([m, U], 0)) {
            qe = '    ' + Z.replace(/^ {0,3}/, '');
          }
          dLines.push(qe);
        }
        blankItem = uBlank;
        e++;
        m = Z.slice(R);
      }
    }
    const endsBlank = e > itemStartIdx && isBlank(lines[e - 1]) && e - 1 < n - 1;
    items.push({ dLines, endsBlank });
    if (!loose) {
      if (pFlag) loose = true;
      else if (endsBlank) pFlag = true;
    }
  }
  if (items.length === 0) return null;
  const lastItem = items[items.length - 1];
  while (lastItem.dLines.length > 0 && isBlank(lastItem.dLines[lastItem.dLines.length - 1])) {
    lastItem.dLines.pop();
  }
  if (lastItem.dLines.length > 0) {
    const li = lastItem.dLines.length - 1;
    lastItem.dLines[li] = lastItem.dLines[li].replace(/[ \t]+$/, '');
  }
  let next = e;
  while (next > listStart && isBlank(lines[next - 1])) next--;
  const built = [];
  for (const item of items) {
    const d = item.dLines.join('\n');
    const recs = lexLines(st, item.dLines, false);
    if (!loose) {
      for (const r of recs) {
        if (r[0] === N_SPACE && r[1] >= 2) { loose = true; break; }
      }
    }
    built.push({ d, recs });
  }
  const outItems = [];
  for (const item of built) {
    let checked = null;
    const task = /^\[[ xX]\][ \t]+\S/.test(item.d);
    if (task) {
      const first = item.recs[0];
      if (first && (first[0] === N_TEXT || first[0] === N_PARA)) {
        const mm = /^\[[ xX]\][ \t]+/.exec(first[1]);
        if (mm) {
          checked = first[1].charAt(1) !== ' ';
          first[1] = first[1].replace(/^\[[ xX]\][ \t]+/, '');
        }
      }
    }
    outItems.push([checked, item.recs]);
  }
  if (loose) {
    for (const [, recs] of outItems) {
      for (const r of recs) if (r[0] === N_TEXT) r[0] = N_PARA;
    }
  }
  const rec = [
    N_LIST, ordered, ordered ? parseInt(startNum, 10) : '', loose, outItems,
    lines.slice(listStart, next),
  ];
  return { rec, next };
}

// --- the block loop --------------------------------------------------------

// Lex `lines` into `nodes` (appended). `top` selects paragraph vs text
// as the fallback; `mergeFirst` merges the first paragraph created by
// this call into a trailing paragraph of `nodes` (blockquote frames).
function lexInto(st, lines, top, nodes, mergeFirst) {
  const n = lines.length;
  const startLen = nodes.length;
  let i = 0;
  let seenContent = false;
  while (i < n) {
    if (isBlank(lines[i])) {
      let j = i;
      while (j < n && isBlank(lines[j])) j++;
      nodes.push([N_SPACE, (j - i) + (seenContent ? 1 : 0)]);
      i = j;
      continue;
    }
    const L = lines[i];
    const [ind, fi] = lineIndent(L);
    let handled = false;
    if (ind >= 4) {
      const cd = readCode(lines, i);
      if (cd) {
        const last = nodes[nodes.length - 1];
        if (last && (last[0] === N_PARA || last[0] === N_TEXT)) {
          last[1] += '\n' + cd.text;
        } else {
          nodes.push([N_CODE, cd.text, '']);
          seenContent = true;
        }
        i = cd.next;
        handled = true;
      }
    }
    if (!handled) {
      const ch = L[fi];
      if (ch === '#') {
        const hd = readHeading(lines, i);
        if (hd) {
          nodes.push([N_HEAD, hd.depth, hd.text]);
          seenContent = true;
          i = hd.next;
          handled = true;
        }
      } else if (ch === '`' || ch === '~') {
        const fn = readFence(lines, i);
        if (fn) {
          nodes.push([N_CODE, fn.text, fn.lang]);
          seenContent = true;
          i = fn.next;
          handled = true;
        }
      } else if (ch === '-' || ch === '+' || ch === '*' || ch === '_') {
        if (lineIsHr(L)) {
          nodes.push([N_HR]);
          seenContent = true;
          i++;
          handled = true;
        } else {
          const ls = readList(st, lines, i);
          if (ls) {
            nodes.push(ls.rec);
            seenContent = true;
            i = ls.next;
            handled = true;
          }
        }
      } else if (ch === '>') {
        const bq = readQuote(st, lines, i);
        if (bq) {
          nodes.push(bq.rec);
          seenContent = true;
          i = bq.next;
          handled = true;
        }
      } else if (ch >= '0' && ch <= '9') {
        const ls = readList(st, lines, i);
        if (ls) {
          nodes.push(ls.rec);
          seenContent = true;
          i = ls.next;
          handled = true;
        }
      } else if (ch === '<') {
        const hm = readHtml(lines, i);
        if (hm) {
          nodes.push([N_HTML, hm.text]);
          seenContent = true;
          i = hm.next;
          handled = true;
        }
      } else if (ch === '[') {
        const df = readDef(st, lines, i);
        if (df) {
          const last = nodes[nodes.length - 1];
          if (last && (last[0] === N_PARA || last[0] === N_TEXT)) {
            last[1] += '\n' + df.raw;
          } else if (!st.defs.has(df.tag)) {
            st.defs.set(df.tag, { href: df.href, title: df.title });
          }
          i = df.next;
          handled = true;
        }
      }
      if (!handled) {
        const tb = readTable(lines, i);
        if (tb) {
          nodes.push([N_TABLE, tb.header, tb.align, tb.rows]);
          seenContent = true;
          i = tb.next;
        } else {
          const stx = readSetext(lines, i);
          if (stx) {
            nodes.push([N_HEAD, stx.depth, stx.text]);
            seenContent = true;
            i = stx.next;
          } else if (top) {
            const pg = readPara(lines, i);
            nodes.push([N_PARA, pg.text]);
            seenContent = true;
            i = pg.next;
          } else {
            const last = nodes[nodes.length - 1];
            if (last && last[0] === N_TEXT) last[1] += '\n' + L;
            else {
              nodes.push([N_TEXT, L]);
              seenContent = true;
            }
            i++;
          }
        }
      }
    }
  }
  if (mergeFirst && nodes.length > startLen) {
    const prev = nodes[startLen - 1];
    const firstNew = nodes[startLen];
    if (prev && prev[0] === N_PARA && firstNew && firstNew[0] === N_PARA) {
      prev[1] += '\n' + firstNew[1];
      nodes.splice(startLen, 1);
    }
  }
}

// Lex `lines` into a fresh node array.
function lexLines(st, lines, top) {
  const nodes = [];
  lexInto(st, lines, top, nodes, false);
  return nodes;
}

// --- rendering -------------------------------------------------------------

function checkboxTag(checked) {
  return '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
}

function renderNodes(st, nodes, out, firstCb) {
  let cb = firstCb || null;
  for (const rec of nodes) {
    switch (rec[0]) {
      case N_SPACE:
        break;
      case N_CODE: {
        const langWord = rec[2] ? rec[2].match(/^\S*/)[0] : '';
        const r = rec[1] ? rec[1].replace(/\n$/, '') + '\n' : '';
        const esc = escapeHtml(r, false);
        if (langWord) out.push('<pre><code class="language-' + escapeHtml(langWord, true) + '">' + esc + '</code></pre>\n');
        else out.push('<pre><code>' + esc + '</code></pre>\n');
        break;
      }
      case N_HEAD: {
        const inner = [];
        renderInlineTop(st, inner, rec[2]);
        out.push('<h' + rec[1] + '>' + inner.join('') + '</h' + rec[1] + '>\n');
        break;
      }
      case N_HR:
        out.push('<hr>\n');
        break;
      case N_QUOTE: {
        const inner = [];
        renderNodes(st, rec[1], inner, null);
        out.push('<blockquote>\n' + inner.join('') + '</blockquote>\n');
        break;
      }
      case N_LIST: {
        const ordered = rec[1];
        const start = rec[2];
        const loose = rec[3];
        const items = rec[4];
        const parts = [];
        for (const item of items) {
          const checked = item[0];
          const itemNodes = item[1];
          const inner = [];
          const cbHtml = checked !== null ? checkboxTag(checked) : null;
          if (cbHtml !== null && !loose) inner.push(cbHtml);
          renderNodes(st, itemNodes, inner, loose ? cbHtml : null);
          parts.push('<li>' + inner.join('') + '</li>\n');
        }
        const tag = ordered ? 'ol' : 'ul';
        const startAttr = ordered && start !== 1 ? ' start="' + start + '"' : '';
        out.push('<' + tag + startAttr + '>\n' + parts.join('') + '</' + tag + '>\n');
        break;
      }
      case N_HTML:
        out.push(rec[1]);
        break;
      case N_PARA: {
        const inner = [];
        if (cb !== null) { inner.push(cb); cb = null; }
        renderInlineTop(st, inner, rec[1]);
        out.push('<p>' + inner.join('') + '</p>\n');
        break;
      }
      case N_TEXT: {
        const inner = [];
        if (cb !== null) { inner.push(cb); cb = null; }
        renderInlineTop(st, inner, rec[1]);
        out.push(inner.join(''));
        break;
      }
      case N_TABLE: {
        const headParts = [];
        for (let i = 0; i < rec[1].length; i++) {
          const inner = [];
          renderInlineTop(st, inner, rec[1][i]);
          headParts.push((rec[2][i] ? '<th align="' + rec[2][i] + '">' : '<th>') + inner.join('') + '</th>\n');
        }
        const bodyParts = [];
        for (const row of rec[3]) {
          const rcParts = [];
          for (let i = 0; i < row.length; i++) {
            const inner = [];
            renderInlineTop(st, inner, row[i]);
            rcParts.push((rec[2][i] ? '<td align="' + rec[2][i] + '">' : '<td>') + inner.join('') + '</td>\n');
          }
          bodyParts.push('<tr>\n' + rcParts.join('') + '</tr>\n');
        }
        const body = bodyParts.join('');
        out.push('<table>\n<thead>\n<tr>\n' + headParts.join('') + '</tr>\n</thead>\n'
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
  const src = markdown.indexOf('\r') === -1
    ? markdown
    : markdown.replace(/\r\n|\r/g, '\n');
  const st = { defs: new Map(), inLink: false, inRaw: false, linkEmitted: false };
  const lines = src.split('\n');
  const nodes = lexLines(st, lines, true);
  const out = [];
  renderNodes(st, nodes, out, null);
  return out.join('');
}
