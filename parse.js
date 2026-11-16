// parse.js — round 10 rebuild.
// A fast, dependency-free Markdown renderer whose parse(markdown) returns
// exactly the HTML that marked 18.1.3 renders with its default options
// (GFM on, breaks off, pedantic off, async off).
//
// Design (my own, written fresh for this round):
//   * Block pass: the source is split into lines once. A flat list of
//     small array records is built (no per-block objects): each record is
//     [kind, ...payload]. Link reference definitions are collected in
//     this pass (first definition wins) and are therefore visible to
//     every inline run, even when the definition sits below its use.
//   * Render pass: the records are walked once and HTML is pushed into
//     one output array; nested blockquotes and list items render into a
//     temporary array that is joined once.
//   * Inline pass: one scanner per text run. Runs with no inline syntax
//     take a single escape-and-emit fast path. Otherwise a char-code
//     dispatch loop handles escapes, code spans, tags, autolinks, links
//     and emphasis. Emphasis uses the masked-source technique: links,
//     code spans, tags and escapes are flattened to inert filler of the
//     same length, so delimiters inside them can neither open nor close;
//     the masked copy is only built when the raw text actually holds a
//     possible closer after an opener.
// Where marked departs from the CommonMark/GFM prose, marked wins.

// ---------------------------------------------------------------------------
// A. Character classification (code-unit based; regex only for non-ASCII)
// ---------------------------------------------------------------------------

// Unicode punctuation / symbol test for a single code point string.
const UNICODE_PUNCT = /[\p{P}\p{S}]/u;
const ASCII_PUNCT_STR = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

// True when ch is Unicode whitespace (space separators, line/paragraph
// separators, and the ASCII whitespace characters).
function isWs(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  if (c === 32 || (c >= 9 && c <= 13)) return true;
  return (
    c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000
  );
}

// True when ch is punctuation: any ASCII punctuation character, or a
// non-ASCII character in Unicode categories P (punctuation) or S (symbol).
function isPunct(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return ASCII_PUNCT_STR.indexOf(ch) >= 0;
  return UNICODE_PUNCT.test(ch);
}

// GFM emphasis punctuation: like isPunct, but a tilde does not count
// (so `~` may sit inside an emphasis delimiter run).
function isPunctGfm(ch) {
  return ch !== '' && ch !== '~' && isPunct(ch);
}

// marked's "previous character is punctuation" test for emphasis: a
// whitespace or punctuation character, but never `*` or `_` themselves.
function isPrevPunct(ch) {
  return ch !== '' && ch !== '*' && ch !== '_' && (isWs(ch) || isPunct(ch));
}

// True when ch is a Unicode letter or number (ASCII fast path).
const UNICODE_ALNUM = /[\p{L}\p{N}]/u;
function isAlnum(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return true;
  return UNICODE_ALNUM.test(ch);
}

// True when ch is an ASCII punctuation character.
function isAsciiPunct(ch) {
  return ch !== '' && ASCII_PUNCT_STR.indexOf(ch) >= 0;
}

// True when ch is an ASCII word character [A-Za-z0-9_] (marked's \w).
function isWordCh(ch) {
  if (ch === '' || ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) ||
    (c >= 97 && c <= 122) || c === 95
  );
}

// True when ch may appear in an e-mail address (GFM extended autolinks).
function isEmailCh(ch) {
  if (ch === '') return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
    ch === '.' || ch === '!' || ch === '#' || ch === '$' || ch === '%' ||
    ch === '&' || ch === "'" || ch === '*' || ch === '+' || ch === '/' ||
    ch === '=' || ch === '?' || ch === '^' || ch === '_' || ch === '`' ||
    ch === '{' || ch === '|' || ch === '}' || ch === '~' || ch === '-'
  );
}

// Char-code versions of the e-mail / URL scanner tests (regex-free).
function isLocalCode(c) { // [A-Za-z0-9._+-]
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
    c === 46 || c === 95 || c === 43 || c === 45
  );
}
function isDomainCode(c) { // [A-Za-z0-9-_]
  return (
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
    c === 45 || c === 95
  );
}
function isAlnumCode(c) { // [A-Za-z0-9]
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
function isWordDashCode(c) { // [\w-] = [A-Za-z0-9_-]
  return isAlnumCode(c) || c === 95 || c === 45;
}
function isLabelCode(c) { // [A-Za-z0-9-]
  return isAlnumCode(c) || c === 45;
}

// Number of leading indentation columns of a line (spaces count 1, tabs
// advance to the next multiple of 4).
function leadCols(line) {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') col += 1;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

// Column of the first character of `m` that is neither a space nor a
// tab, counting every tab as four columns (the `replace(/\t/g, '    ')`
// reading), or -1 when `m` holds only spaces and tabs.
function firstNonSpaceExpanded(m) {
  let cols = 0;
  for (let i = 0; i < m.length; i++) {
    const ch = m[i];
    if (ch === ' ') { cols += 1; continue; }
    if (ch === '\t') { cols += 4; continue; }
    return cols;
  }
  return -1;
}

// Index of the first character of a line that is not a space or tab.
function firstNonWs(line) {
  let i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
  return i;
}

// True when the line holds only spaces and tabs.
function blankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}

// Remove `cols` columns of indentation from the front of a line. A tab
// straddling the boundary is replaced by the spaces it has left.
function dropIndent(line, cols) {
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

// Expand tabs in `line` to spaces, counting columns from `base`
// (marked's expandTabs).
function expandTabs(line, base) {
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

// Trim spaces/tabs from both ends of a string.
function trimWs(s) {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === ' ' || s[a] === '\t')) a++;
  while (b > a && (s[b - 1] === ' ' || s[b - 1] === '\t')) b--;
  return s.slice(a, b);
}

// Strip trailing `c` characters.
function rtrimCh(s, c) {
  let i = s.length;
  while (i > 0 && s.charAt(i - 1) === c) i--;
  return i === s.length ? s : s.slice(0, i);
}

// Drop trailing blank lines from a string, keeping at most the final
// newline of the last content line (marked's trimTrailingBlankLines).
function trimTrailBlanks(s) {
  const lines = s.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && /^[ \t]*$/.test(lines[end])) end--;
  if (lines.length - end <= 2) return s;
  return lines.slice(0, end + 1).join('\n');
}

// ---------------------------------------------------------------------------
// B. Escaping, numeric references, URL cleaning, labels
// ---------------------------------------------------------------------------

// Index just past the `;` of a valid character reference starting at the
// `&` at position i, or -1. Matches marked's escape lookahead:
// `(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);`. Note `&#abc;` is not valid
// (letters after `#` need the `x`), while `&foo_bar;` is.
function refEnd(s, i) {
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

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_FIND = /[&<>"']/g;

// Escape `&<>"'`. When `keepRefs` is true, an `&` that starts a valid
// character reference (`&name;`, `&#123;`, `&#x1F;`) is left alone.
function escHtml(s, keepRefs) {
  if (
    s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 &&
    s.indexOf('"') === -1 && s.indexOf("'") === -1
  ) return s;
  let out = '';
  let last = 0;
  ESC_FIND.lastIndex = 0;
  let m;
  while ((m = ESC_FIND.exec(s)) !== null) {
    const ch = m[0];
    if (ch === '&' && keepRefs && refEnd(s, m.index) !== -1) continue;
    out += s.slice(last, m.index) + ESC_MAP[ch];
    last = m.index + 1;
  }
  return last === 0 ? s : out + s.slice(last);
}

// Decode numeric character references in inline text, exactly like
// marked: a decoded character stands for itself (and is re-escaped by
// the caller), values 0 / >0x10FFFF / surrogates become U+FFFD, code 38
// becomes `&amp;`, and a bare `&` that cannot start a valid reference
// becomes `&amp;`.
function decodeRefs(s) {
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
    // Not a numeric reference: a valid `&name;` stays literal, any other
    // `&` is escaped.
    if (refEnd(s, amp) !== -1) { i = amp + 1; continue; }
    out += s.slice(last, amp) + '&amp;';
    last = amp + 1;
    i = amp + 1;
  }
  return last === 0 ? s : out + s.slice(last);
}

// Render one inline text run: decode numeric references, then escape HTML
// (leaving valid references alone). This is what marked's text token plus
// its renderer do, fused into one pass.
function renderText(s) {
  return escHtml(decodeRefs(s), true);
}

// encodeURI, with `%25` folded back to `%`; null when it throws
// (lone surrogate in the URL).
function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// Unescape `\punct` -> punct (any Unicode punctuation after a backslash).
function unescPunct(s) {
  if (s.indexOf('\\') === -1) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && isPunct(s[i + 1])) {
      out += s[i + 1];
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

// Normalise a link label for definition/reference matching: trim, collapse
// runs of whitespace to one space, Unicode case-fold.
function normLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Index of the `)` that closes the paren run starting in `str` (balanced
// parens counted like marked's findClosingBracket): -1 balanced/absent,
// -2 more opens than closes, otherwise the index of the unmatched `)`.
function closeParenIdx(str, b) {
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
// C. Inline scanners: code spans, tags, autolinks, URLs, link labels
// ---------------------------------------------------------------------------

// Match a code span at s[i] (a backtick). Returns { len, text } or null.
// The opener is the whole backtick run; the closer is the first later run
// of the same length not followed by a backtick, whose content does not
// start or end with a backtick.
function matchCode(s, i) {
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
        if (
          /[^ ]/.test(text) && text.length >= 2 &&
          text.charAt(0) === ' ' && text.charAt(text.length - 1) === ' '
        ) text = text.substring(1, text.length - 1);
        return { len: q - i, text };
      }
      p = q;
      continue;
    }
    p = q;
  }
  return null;
}

// Match an inline HTML construct at s[i] (which must be `<`). Returns the
// raw length, or 0. Covers comments, processing instructions,
// declarations, CDATA sections, open tags and closing tags.
function matchTag(s, i) {
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
function matchAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
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
        return { len: m + 1 - i, text, href: text };
      }
      return null;
    }
  }
  // E-mail: local@domain(.domain)+ with the `(?![-_])` tail guard.
  let p = j;
  while (p < n && isEmailCh(s[p])) p++;
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

// --- extended autolinks (GFM) ----------------------------------------------

// Trim trailing punctuation / unbalanced parens the way marked's backpedal
// does: apply the pattern until the result stops changing.
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

// Does an e-mail local part (`[A-Za-z0-9._+-]+@`) start at s[p]?
// Scans the word at p with inlined char-code tests (no per-character
// function calls); it stops at the first character that cannot be in a
// local part, so the work is bounded by the word, not the whole run.
function emailAhead(s, p) {
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
function protocolAhead(s, p) {
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

// Does `www.` start at s[p] where marked's lookbehind allows it (start of
// string, or after whitespace — `\s`, NBSP included — `*`, `_`, `~` or
// `(`)?
function wwwAhead(s, p) {
  if (s[p] !== 'w' || s[p + 1] !== 'w' || s[p + 2] !== 'w' || s[p + 3] !== '.') return false;
  if (p === 0) return true;
  const prev = s[p - 1];
  return isWs(prev) || prev === '*' || prev === '_' || prev === '~' || prev === '(';
}

// Match an extended e-mail address at s[i]: local@domain with a dotted
// domain. Returns the index just past the address, or -1. A dot not
// followed by a label ending in an alnum ends the domain there (so the
// trailing dot of `a@b.c.` stays literal text); only a domain with no
// dotted label at all fails the match.
function matchExtEmail(s, i) {
  let j = i;
  while (j < s.length && isLocalCode(s.charCodeAt(j))) j++;
  if (j === i || s[j] !== '@') return -1;
  j++;
  let d = j;
  if (d >= s.length || !isDomainCode(s.charCodeAt(d))) return -1;
  let sawDot = false;
  for (;;) {
    let labelEnd = d;
    while (labelEnd < s.length && isDomainCode(s.charCodeAt(labelEnd))) labelEnd++;
    if (s[labelEnd] === '.') {
      let nd = labelEnd + 1;
      let ne = nd;
      while (ne < s.length && isDomainCode(s.charCodeAt(ne))) ne++;
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

// Try a GFM extended autolink at s[i]. Returns { len, text, href }.
function matchUrl(s, i) {
  const n = s.length;
  // (1) `mailto:` / `xmpp:` + extended e-mail (lowercase scheme only).
  if (s.startsWith('mailto:', i) || s.startsWith('xmpp:', i)) {
    const schemeLen = s.startsWith('mailto:', i) ? 7 : 5;
    const end = matchExtEmail(s, i + schemeLen);
    if (end !== -1) {
      let extra = end;
      if (s.startsWith('xmpp:', i) && s[extra] === '/') {
        let q = extra + 1;
        while (q < n && (isAlnumCode(s.charCodeAt(q)) || s[q] === '@' || s[q] === '.')) q++;
        extra = q;
      }
      return { len: extra - i, text: s.slice(i, extra), href: s.slice(i, extra) };
    }
  }
  // (2) `http(s)://` / `ftp://` / `www.` + domain + rest.
  let kind = 0; // 1 = protocol, 2 = www.
  let rest = -1;
  if (protocolAhead(s, i)) {
    kind = 1;
    rest = i;
    while (rest < n && s[rest] !== ':') rest++;
    rest += 3; // skip `://`
  } else if (s.startsWith('www.', i)) {
    kind = 2;
    rest = i + 4;
  }
  if (kind !== 0) {
    let d = rest;
    let ok = false;
    while (d < n) {
      let labelEnd = d;
      while (labelEnd < n && isLabelCode(s.charCodeAt(labelEnd))) labelEnd++;
      if (labelEnd === d) break;
      ok = true;
      d = labelEnd;
      if (s[d] === '.') { d++; continue; }
      break;
    }
    if (ok) {
      let m = d;
      while (m < n && s[m] !== ' ' && s[m] !== '\t' && s[m] !== '\n' && s[m] !== '\r' && s[m] !== '<') m++;
      const text = backpedal(s.slice(i, m));
      if (text.length > 0) {
        return {
          len: text.length,
          text,
          href: kind === 2 ? 'http://' + text : text,
        };
      }
    }
  }
  // (3) Bare e-mail.
  const end = matchExtEmail(s, i);
  if (end !== -1) {
    const text = s.slice(i, end);
    return { len: end - i, text, href: 'mailto:' + text };
  }
  return null;
}

// Match a hard break at s[i]: ` {2,}\n` or `\\\n`, not followed by only
// whitespace to the end, plus trailing `[ \t]*`. Returns the raw length
// or 0.
function matchHardBreak(s, i) {
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
  while (k < n && isWs(s[k])) k++;
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
function labelCandidates(s, i) {
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
function labelEndInToken(s, label, labelStart) {
  if (label.indexOf('<') === -1) return false;
  const labelEnd = labelStart + label.length;
  for (let i = 0; i < label.length; i++) {
    const c = label[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') {
      const cs = matchCode(s, labelStart + i);
      if (cs) { i += cs.len - 1; continue; }
    }
    if (c !== '<') continue;
    const p = labelStart + i;
    const tagLen = matchTag(s, p);
    if (tagLen > 0) {
      if (p + tagLen > labelEnd) return true;
      i += tagLen - 1;
      continue;
    }
    const al = matchAutolink(s, p);
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
function parseLinkSuffix(s, k) {
  const n = s.length;
  let p = k;
  while (p < n && (s[p] === ' ' || s[p] === '\t' || s[p] === '\n')) p++;
  if (s[p] === ')') return { href: '', title: undefined, end: p + 1 };
  // Destination: angle-bracket form first; when it cannot parse (empty
  // `<>`, a newline or `<` before the `>`), the bare form is tried,
  // exactly like the alternation in marked's destination regex.
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
  // Optional title, preceded by spaces (with an optional newline) or a
  // newline.
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
function parseInlineLink(s, i, parenOk) {
  const n = s.length;
  let isImage = false;
  let j = i;
  if (s[j] === '!') { isImage = true; j++; }
  if (s[j] !== '[') return null;
  if (!parenOk) return null;
  // Try each label candidate in marked's backtracking order: the first
  // candidate whose `](` + destination parses wins the link.
  const cands = labelCandidates(s, j);
  for (const cand of cands) {
    if (labelEndInToken(s, cand.label, j + 1)) continue;
    const k = cand.end;
    if (s[k] !== '(') continue;
    const suf = parseLinkSuffix(s, k + 1);
    if (!suf) continue;
    let href = suf.href;
    let title = suf.title !== undefined ? suf.title : '';
    let rawLen = (k + 1 - i) + (suf.end - (k + 1));
    // Angle-bracket href checks / paren balancing.
    const trimmed = href.trim();
    if (trimmed.startsWith('<')) {
      if (!trimmed.endsWith('>')) continue;
      const inner = trimmed.slice(0, -1);
      if ((trimmed.length - rtrimCh(inner, '\\').length) % 2 === 0) continue;
    } else {
      const lastParen = closeParenIdx(href, '()');
      if (lastParen === -2) continue;
      if (lastParen > -1) {
        rawLen = (isImage ? 5 : 4) + cand.label.length + lastParen;
        href = href.slice(0, lastParen);
        title = '';
      }
    }
    // The raw text must not end with an odd number of backslashes.
    const rawText = s.slice(i, i + rawLen);
    if ((rawText.length - rtrimCh(rawText.slice(0, -1), '\\').length) % 2 === 0) continue;
    href = href.trim();
    if (trimmed.startsWith('<')) href = href.slice(1, -1);
    return {
      len: rawLen,
      isImage,
      href: unescPunct(href),
      title: unescPunct(title),
      label: cand.label.replace(/\\([\[\]])/g, '$1'),
    };
  }
  return null;
}

// Scan a reference label (marked's _blockLabel) starting at s[i] (s[i]
// is the first ref character). Returns { ref, end } (end = index just
// past `]`) or null.
function scanRefLabel(s, i) {
  const n = s.length;
  // `(?!\s*\])` — the ref cannot be empty or all whitespace.
  let j = i;
  while (j < n && isWs(s[j])) j++;
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

// Parse a reference link / shortcut link at s[i] (`[` or `![`).
// Returns { kind, isImage, label, ref, len } or null. The caller looks
// the ref up in the definitions; an unresolved reference is handled by
// the inline loop.
function parseRefLink(s, i) {
  const n = s.length;
  let isImage = false;
  let j = i;
  if (s[j] === '!') { isImage = true; j++; }
  if (s[j] !== '[') return null;
  // Full reference: [label][ref]. Try each label candidate in marked's
  // backtracking order.
  const cands = labelCandidates(s, j);
  for (const cand of cands) {
    const k = cand.end;
    if (s[k] === '[') {
      const ref = scanRefLabel(s, k + 1);
      if (ref && !labelEndInToken(s, cand.label, j + 1)) {
        return { kind: 'reflink', isImage, label: cand.label, ref: ref.ref, len: ref.end - i };
      }
    }
  }
  // Shortcut reference: [ref], optionally followed by `[]`.
  const ref = scanRefLabel(s, j + 1);
  if (ref) {
    let end = ref.end;
    if (s[end] === '[' && s[end + 1] === ']') end += 2;
    return { kind: 'nolink', isImage, label: ref.ref, ref: ref.ref, len: end - i };
  }
  return null;
}

// Parse a (possibly multi-line) link title at s[i] (`"`, `'` or `(`).
// Returns { title, end } or null. Used for link reference definitions.
function parseDefTitle(s, i) {
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

// ---------------------------------------------------------------------------
// D. Emphasis / strong / strikethrough: masked source + closer search
// ---------------------------------------------------------------------------

// Masking patterns. A masked copy of an inline run hides the delimiters
// that live inside links, code spans, HTML tags and escapes, so they can
// neither open nor close emphasis. Every replacement keeps its length,
// so indices in the masked source line up with the raw source.

// `\punct` escapes, and the backticks inside code spans.
const RE_MASK_ESCAPES = /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu;
// Inline links, code spans and HTML tags.
const RE_MASK_BLOCKS = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)|(?<!`)()(?<b>`+)[^`]+\k<b>(?!`)|<(?! )[^<>]*?>/g;
// Reference links (full `[label][ref]` and shortcut `[ref]`, the latter
// not followed by `(`).
const RE_BOUNDED_LABEL = /(?:[^\[\]\\`]*(?:\[(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/;
const RE_BLOCK_LABEL = /(?:(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999})/;
const RE_REFLINK = new RegExp(
  '!?\\[(' + RE_BOUNDED_LABEL.source + ')\\]\\[(' + RE_BLOCK_LABEL.source + ')\\]' +
  '|!?\\[(' + RE_BLOCK_LABEL.source + ')\\](?:\\[\\])?(?!\\()',
  'g',
);

// Does this link text hold a link already? (Images do not count: an image
// may hold a link, a link may not.) Used while masking reflinks.
function linkInText(ctx, text, parenOk) {
  if (text.indexOf('[') === -1) return false;
  for (const m of text.matchAll(RE_MASK_BLOCKS)) {
    if (parseInlineLink(m[0], 0, parenOk) && text.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of text.matchAll(RE_REFLINK)) {
    const m0 = m[0];
    const refStart = m0.lastIndexOf('[');
    if (m0.charAt(0) === '!' || !ctx.defs.has(normLabel(m0.slice(refStart + 1, -1)))) continue;
    if (refStart > 1 && linkInText(ctx, m0.slice(1, refStart - 1), parenOk)) continue;
    return true;
  }
  return false;
}

// Build the masked source for one inline run.
function maskRun(ctx, s, parenOk) {
  let masked = s;
  if (s.indexOf('[') !== -1) {
    const maskOne = (m0) => {
      const refStart = m0.lastIndexOf('[');
      if (!ctx.defs.has(normLabel(m0.slice(refStart + 1, -1)))) return m0;
      if (refStart > 1 && m0.charAt(0) !== '!') {
        const text = m0.slice(1, refStart - 1);
        if (linkInText(ctx, text, parenOk)) {
          return '[' + text.replace(RE_REFLINK, maskOne)
            + '][' + 'a'.repeat(m0.length - refStart - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(m0.length - 2) + ']';
    };
    masked = masked.replace(RE_REFLINK, maskOne);
  }
  masked = masked.replace(RE_MASK_ESCAPES, (m0, code, punct) => {
    if (punct) return '+'.repeat(m0.length);
    if (code) return code + m0.slice(code.length, -code.length).replace(/`/g, '+') + code;
    return m0;
  });
  masked = masked.replace(RE_MASK_BLOCKS, (m0) => '[' + 'a'.repeat(m0.length - 2) + ']');
  return masked;
}

// Last `*` / `_` / `~` run in `src` that can close emphasis/strong/del:
// a run whose preceding character is not ASCII whitespace (a run at
// position 0 never counts). -1 when there is none.
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
function classifyDelim(masked, p, len, delim, gfm) {
  const prev = p === 0 ? '' : masked[p - 1];
  const next = p + len >= masked.length ? '' : masked[p + len];
  if (prev === '') return 0;
  const punct = gfm ? isPunctGfm : isPunct;
  const prevIsPunct = prev !== delim && punct(prev);
  const prevIsSpace = isWs(prev);
  const prevIsOther = !prevIsPunct && !prevIsSpace && prev !== delim;
  const nextIsSpace = next === '' || isWs(next);
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
function delimRunLen(s, p) {
  const ch = s[p];
  let j = p + 1;
  while (j < s.length && s[j] === ch) j++;
  return j - p;
}

// Orphan-skip pattern for `*`: `[^_*]*?__[^_*]*?\*[^_*]*?(?=__)` at the
// start of the closer window. Returns the index just before the final
// `__`, or -1.
function orphanAst(masked, start) {
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
function orphanUnd(masked, start) {
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

// Try to open emphasis/strong at absolute position `pos` in the inline
// run `s` (masked source `masked`, closer hints `closers`). Returns
// { len, kind, text } or null.
function tryEmphasis(s, masked, closers, pos, prevChar) {
  const delim = s[pos];
  // Left-delimiter match: the whole run, then the character after it.
  let p = pos;
  while (p < s.length && s[p] === delim) p++;
  const lLen = p - pos;
  if (p >= s.length) return null;
  const after = s[p];
  let nextPunct = '';
  let nextOther = '';
  if (after !== delim) {
    if (isPunctGfm(after)) nextPunct = after;
    else if (!isWs(after)) nextOther = after;
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
  const runLength = pos - runStart + lLen;
  const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || isPrevPunct(runPrevChar);
  const openerCanClose = runPrevChar.trim() !== ''
    && (nextChar !== '' || (delim === '*' && !runPrevPunct));
  const lastPossible = closers[delim];
  const windowStart = pos + lLen;
  if (lastPossible < windowStart) return null;
  // Orphan skip: only at the very start of the closer window.
  let searchFrom = windowStart;
  let orphanSkipped = false;
  if (delim === '*') {
    const orphan = orphanAst(masked, windowStart);
    if (orphan !== -1) { searchFrom = orphan; orphanSkipped = true; }
  } else if (delim === '_') {
    const orphan = orphanUnd(masked, windowStart);
    if (orphan !== -1) { searchFrom = orphan; orphanSkipped = true; }
  }
  let delimTotal = lLen;
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
    const rLen = delimRunLen(masked, q);
    q = rp + rLen;
    // Cutoff: no qualifying closer at or beyond this run.
    if (rp - 1 > lastPossible) break;
    const group = classifyDelim(masked, rp, rLen, delim, true);
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
function tryStrikethrough(s, masked, closers, pos, prevChar) {
  let p = pos;
  while (p < s.length && s[p] === '~') p++;
  const lLen = p - pos;
  if (lLen > 2) return null;
  if (p >= s.length) return null;
  const after = s[p];
  let nextPunct = '';
  let nextOther = '';
  if (after !== '~') {
    if (isPunct(after)) nextPunct = after;
    else if (!isWs(after)) nextOther = after;
  }
  if (nextPunct === '' && nextOther === '') return null;
  if (nextPunct !== '' && prevChar !== '' && !isPrevPunct(prevChar)) return null;
  const lastPossible = closers['~'];
  const windowStart = pos + lLen;
  if (lastPossible < windowStart) return null;
  let delimTotal = lLen;
  let q = windowStart;
  const n = masked.length;
  while (q < n) {
    while (q < n && !(masked[q] === '~' && masked[q - 1] !== '~')) q++;
    if (q >= n) break;
    const rp = q;
    const rLen = delimRunLen(masked, q);
    q = rp + rLen;
    if (rp - 1 > lastPossible) break;
    if (rLen !== lLen) continue;
    const group = classifyDelim(masked, rp, rLen, '~', false);
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

// ---------------------------------------------------------------------------
// E. The inline loop (direct render) and link emission
// ---------------------------------------------------------------------------

// Is there a hard break (` {2,}\n`) starting at s[p]?
function hardBreakAhead(s, p) {
  let j = p;
  while (s[j] === ' ') j++;
  return j >= p + 2 && s[j] === '\n';
}

// Length of the plain-text run starting at s[i], mirroring marked's GFM
// inline text token. The run stops where a construct may begin: a
// backslash, `<`, `![`, `[`, backtick/tilde run, `*`/`_`, a hard break,
// an e-mail local part, a `www.`/protocol URL, or `mailto:`/`xmpp:`.
function scanTextLen(s, i) {
  const n = s.length;
  // A lone non-alphanumeric character right before `mailto:` / `xmpp:` is
  // its own run, so the url matcher sees the protocol at the start.
  if (i < n && !isAlnum(s[i])) {
    if (s.startsWith('mailto:', i + 1) || s.startsWith('xmpp:', i + 1)) return 1;
  }
  // First character: a backtick run, a tilde run, or any single character.
  let j = i;
  const c = s[j];
  if (c === '`') { while (j < n && s[j] === '`') j++; }
  else if (c === '~') { while (j < n && s[j] === '~') j++; }
  else j++;
  // Immediately after the first character(s): stop at a backtick/tilde
  // run, a hard break, or an e-mail local part.
  if (j < n && (s[j] === '`' || s[j] === '~')) return j - i;
  if (hardBreakAhead(s, j)) return j - i;
  if (emailAhead(s, j)) return j - i;
  // Lazy scan: at each position try the zero-width stops first, then
  // consume one character and check the consume-one-and-stop patterns.
  // The expensive lookaheads are gated on their possible first
  // character, and the alnum / e-mail-char tests are inlined char-code
  // ranges (a non-ASCII letter still takes the Unicode test).
  while (j < n) {
    const code = s.charCodeAt(j);
    if (code === 92 || code === 60 || code === 33 || code === 91 || code === 96
      || code === 42 || code === 126 || code === 95) return j - i;
    if (code === 119 && wwwAhead(s, j)) return j - i;
    if ((code === 104 || code === 72 || code === 102 || code === 70) && protocolAhead(s, j)) return j - i;
    j++;
    if (code !== 32 && s[j] === ' ' && s[j + 1] === ' ' && hardBreakAhead(s, j)) return j - i;
    const prevAlnum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (code >= 128 && UNICODE_ALNUM.test(s[j - 1]));
    if (!prevAlnum) {
      const nj = s[j];
      if ((nj === 'm' || nj === 'x') && (s.startsWith('mailto:', j) || s.startsWith('xmpp:', j))) return j - i;
    }
    const prevEmail = (code >= 48 && code <= 57) || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122) || code === 46 || code === 33 || code === 35
      || code === 36 || code === 37 || code === 38 || code === 39 || code === 42
      || code === 43 || code === 47 || code === 61 || code === 63 || code === 94
      || code === 95 || code === 96 || code === 123 || code === 124 || code === 125
      || code === 126 || code === 45;
    if (!prevEmail && emailAhead(s, j)) return j - i;
  }
  return n - i;
}

// Render an autolink / GFM url token: `<a href="...">text</a>` with both
// parts escaped fully; when the href cannot be cleaned, just the text.
function emitAutolink(out, tok) {
  const clean = cleanUrl(tok.href);
  if (clean === null) { out.push(escHtml(tok.text, false)); return; }
  out.push('<a href="' + escHtml(clean, false) + '">' + escHtml(tok.text, false) + '</a>');
}

// Emit a link/image into `out` (or its plain text when `mode === 'text'`).
// `lk` has { href, title, label, isImage }. Returns true when the token
// was emitted, false when the link must bail (a non-image link whose label
// already holds a link) — the caller then falls through to plain text.
function emitLink(ctx, out, lk, mode, parenOk) {
  const outerInLink = ctx.inLink;
  const outerEmitted = ctx.linkEmitted;
  const outerInRaw = ctx.inRaw;
  ctx.inLink = true;
  ctx.linkEmitted = false;
  const labelText = lk.label.replace(/\\([\[\]])/g, '$1');
  const labelMode = lk.isImage ? 'text' : mode;
  const labelOut = [];
  inlineTo(ctx, labelOut, labelText, labelMode, parenOk);
  const textHasLink = ctx.linkEmitted;
  ctx.linkEmitted = outerEmitted;
  ctx.inLink = outerInLink;
  if (!lk.isImage) {
    if (textHasLink) { ctx.inRaw = outerInRaw; return false; }
    ctx.linkEmitted = true;
  }
  if (mode === 'text') {
    for (const part of labelOut) out.push(part);
    return true;
  }
  const clean = cleanUrl(lk.href);
  if (lk.isImage) {
    const alt = labelOut.join('');
    if (clean === null) { out.push(escHtml(alt, true)); return true; }
    out.push('<img src="' + escHtml(clean, true) + '" alt="' + escHtml(alt, true) + '"');
    if (lk.title) out.push(' title="' + escHtml(lk.title, true) + '"');
    out.push('>');
    return true;
  }
  if (clean === null) {
    for (const part of labelOut) out.push(part);
    return true;
  }
  out.push('<a href="' + escHtml(clean, true) + '"');
  if (lk.title) out.push(' title="' + escHtml(lk.title, true) + '"');
  out.push('>');
  for (const part of labelOut) out.push(part);
  out.push('</a>');
  return true;
}

// Anything that can start inline syntax, an autolink, or a hard break:
// backslash, `<`, `[`, `*`, `_`, backtick, `~`, `@` (e-mail), `![`,
// `www.`, `://`, or two spaces before a newline. A run containing none
// of these is plain text: one escaped/decoded push, no per-char loop.
const RE_INLINE_SYNTAX = /[\\<\[*_`~@]|!\[|www\.|:\/\/|  \n/;
const RE_TEXT_ESC = /[&<>"']/;

// Render one inline run `s` into `out`. `mode` is 'html' (normal output)
// or 'text' (plain-text flattening, like marked's TextRenderer for image
// alt text). `parenOk` is the outer run's link-paren state: a link is
// only attempted when the run contains `)`.
function inlineTo(ctx, out, s, mode, parenOk) {
  const n = s.length;
  if (n === 0) return;
  // Fast path: no inline syntax anywhere in the run — a single text push.
  // No `<` means no tag can flip inLink/inRaw, and no `*`/`_`/`~` means
  // no emphasis state is needed, so the run state is untouched.
  if (!RE_INLINE_SYNTAX.test(s)) {
    if (mode === 'text') out.push(ctx.inRaw ? s : decodeRefs(s));
    else out.push(ctx.inRaw ? s : renderText(s));
    return;
  }
  const runParenOk = parenOk && s.indexOf(')') !== -1;
  let masked = null;
  let closers = null;
  let rawClosers = null;
  const ensureMask = () => {
    if (masked === null) {
      masked = maskRun(ctx, s, runParenOk);
      closers = scanClosers(masked);
    }
  };
  const ensureRawClosers = () => {
    if (rawClosers === null) rawClosers = scanClosers(s);
  };
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
        out.push(mode === 'text' ? nx : renderText(nx));
        i += 2;
        continue;
      }
      const brLen = matchHardBreak(s, i);
      if (brLen > 0) {
        if (mode === 'html') out.push('<br>');
        i += brLen;
        continue;
      }
    } else if (c === '<') {
      const tagLen = matchTag(s, i);
      if (tagLen > 0) {
        const raw = s.slice(i, i + tagLen);
        if (!ctx.inLink && /^<a /i.test(raw)) ctx.inLink = true;
        else if (ctx.inLink && /^<\/a>/i.test(raw)) ctx.inLink = false;
        if (!ctx.inRaw && /^<(pre|code|kbd|script)(\s|>)/i.test(raw)) ctx.inRaw = true;
        else if (ctx.inRaw && /^<\/(pre|code|kbd|script)(\s|>)/i.test(raw)) ctx.inRaw = false;
        out.push(raw);
        i += tagLen;
        continue;
      }
      const al = matchAutolink(s, i);
      if (al) {
        if (mode === 'text') out.push(al.text);
        else emitAutolink(out, al);
        i += al.len;
        continue;
      }
    } else if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      if (runParenOk) {
        const lk = parseInlineLink(s, i, runParenOk);
        if (lk && emitLink(ctx, out, lk, mode, runParenOk)) { i += lk.len; continue; }
      }
      const rl = parseRefLink(s, i);
      if (rl) {
        const def = ctx.defs.get(normLabel(rl.ref));
        if (def) {
          if (emitLink(ctx, out, { href: def.href, title: def.title, label: rl.label, isImage: rl.isImage }, mode, runParenOk)) {
            i += rl.len;
            continue;
          }
        } else {
          // Unresolved reference: just the first character, as text.
          out.push(mode === 'text' ? s[i] : renderText(s[i]));
          if (s[i] !== '_') prevChar = s[i];
          prevWasText = true;
          i += 1;
          continue;
        }
      }
    } else if (c === '*' || c === '_') {
      const runLen = delimRunLen(s, i);
      ensureRawClosers();
      // Masking only removes closers, so when the raw text holds no
      // closer at or after this opener, emphasis cannot match: skip the
      // mask build entirely and fall through to the URL check.
      if (rawClosers[c] >= i + runLen) {
        ensureMask();
        const em = tryEmphasis(s, masked, closers, i, prevChar);
        if (em) {
          if (mode === 'html') {
            out.push(em.kind === 'strong' ? '<strong>' : '<em>');
            inlineTo(ctx, out, em.text, mode, runParenOk);
            out.push(em.kind === 'strong' ? '</strong>' : '</em>');
          } else {
            inlineTo(ctx, out, em.text, mode, runParenOk);
          }
          i += em.len;
          continue;
        }
      }
      // A failed emphasis may still be the start of an e-mail address
      // (e.g. `__a@b.co` links the whole address).
      if (!ctx.inLink) {
        const u = matchUrl(s, i);
        if (u) {
          if (mode === 'text') out.push(u.text);
          else emitAutolink(out, u);
          i += u.len;
          continue;
        }
      }
    } else if (c === '`') {
      const cs = matchCode(s, i);
      if (cs) {
        if (mode === 'html') out.push('<code>' + escHtml(cs.text, false) + '</code>');
        else out.push(cs.text);
        i += cs.len;
        continue;
      }
    } else if (c === ' ') {
      const brLen = matchHardBreak(s, i);
      if (brLen > 0) {
        if (mode === 'html') out.push('<br>');
        i += brLen;
        continue;
      }
    } else if (c === '~') {
      const runLen = delimRunLen(s, i);
      ensureRawClosers();
      if (rawClosers['~'] >= i + runLen) {
        ensureMask();
        const d = tryStrikethrough(s, masked, closers, i, prevChar);
        if (d) {
          if (mode === 'html') {
            out.push('<del>');
            inlineTo(ctx, out, d.text, mode, runParenOk);
            out.push('</del>');
          } else {
            inlineTo(ctx, out, d.text, mode, runParenOk);
          }
          i += d.len;
          continue;
        }
      }
    } else if (!ctx.inLink && isEmailCh(c)) {
      // A URL or e-mail can only start on an e-mail character (every
      // scheme/protocol/www start is one); anything else is plain text.
      const u = matchUrl(s, i);
      if (u) {
        if (mode === 'text') out.push(u.text);
        else emitAutolink(out, u);
        i += u.len;
        continue;
      }
    }
    // Plain text run.
    const len = scanTextLen(s, i);
    const raw = s.slice(i, i + len);
    if (mode === 'text') out.push(ctx.inRaw ? raw : decodeRefs(raw));
    // A run with no escapable character renders as-is: one regex test
    // replaces the decode + escape passes over it.
    else if (ctx.inRaw || !RE_TEXT_ESC.test(raw)) out.push(raw);
    else out.push(renderText(raw));
    const lastCh = raw.charAt(raw.length - 1);
    if (lastCh !== '_') prevChar = lastCh;
    prevWasText = true;
    i += len;
  }
}

// Render one top-level inline run (a block's text): the raw-block state is
// reset first, exactly as marked does before each inline run.
function inlineTop(ctx, out, s) {
  ctx.inRaw = false;
  inlineTo(ctx, out, s, 'html', true);
}

// ---------------------------------------------------------------------------
// F. Block layer: line classifiers, leaf rules, containers
// ---------------------------------------------------------------------------

// Block record kinds (flat arrays: [kind, ...payload]).
const R_SPACE = 0; // [0, blankCount]
const R_CODE = 1; // [1, text, lang]
const R_HEAD = 2; // [2, depth, text]
const R_HR = 3; // [3]
const R_QUOTE = 4; // [4, innerRecords, rawLines, strippedLines]
const R_LIST = 5; // [5, ordered, start, loose, items, srcLines]
const R_HTML = 6; // [6, text]
const R_PARA = 7; // [7, text]
const R_TEXT = 8; // [8, text]
const R_TABLE = 9; // [9, headerCells, align, rows]

// Block-level HTML tags (marked's list K) for the html interrupt
// (types 1-6) and the html block rule.
const HTML_BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const RE_HTML_INTERRUPT = new RegExp('^ {0,3}(?:</?(?:' + HTML_BLOCK_TAGS + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)');
const RE_TABLE_DELIM = /^ {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?$/;
const RE_TABLE_DELIM_PIPE = /^ {0,3}\|?(?:[:\- ]*\|)+[:\- ]*$/;
const RE_SETEXT_UNDER = /^ {0,3}(=+|-+)[ \t]*$/;

// [indentCols, firstNonWsIdx] of a line (leading whitespace is spaces
// only whenever the column count is below 4: any tab pushes it to 4).
function indentOf(line) {
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
function isHr(line) {
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
function isHeadingStart(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 3) i++;
  let j = i;
  while (j < line.length && line[j] === '#') j++;
  const d = j - i;
  if (d === 0 || d > 6) return false;
  return j >= line.length || isWs(line[j]);
}

// Is `line` a fenced-code opening? Backtick run 3+ with no backtick in
// the rest of the line, or a tilde run 3+.
function isFenceStart(line) {
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
function isBqLine(line) {
  return /^ {0,3}>/.test(line);
}

// Is `line` a list item start? GFM paragraph variant: bullet +
// whitespace + a non-space character (only `1.` interrupts paragraphs).
function isListGfm(line) {
  return /^ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t]/.test(line);
}

// Ke (blockquote/list) variant: any bullet + space/tab/end.
function isListKe(line) {
  return /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/.test(line);
}

// Is `line` an html-block interrupt (types 1-6) for a paragraph?
function isHtmlInterrupt(line) {
  return RE_HTML_INTERRUPT.test(line);
}

// Is `line` an indented-code line? ` {4}` or ` {0,3}\t`, then a
// character.
function isCodeLine(line) {
  let i = 0;
  while (i < line.length && line[i] === ' ' && i < 4) i++;
  if (i === 4) return line.length > 4;
  return line[i] === '\t' && line.length > i + 1;
}

// Does the line at `j` start a table (header line + delimiter line)?
// This is the paragraph-continuation interrupt: any delimiter-shaped
// next line stops the paragraph — even a bare `---` (the table rule may
// still reject it, and then it becomes a setext underline instead).
function isTableStart(lines, j) {
  if (blankLine(lines[j])) return false;
  if (j + 1 >= lines.length) return false;
  return RE_TABLE_DELIM.test(lines[j + 1]);
}

// Split a table row/header line into cells (marked's splitCells): split
// on unescaped ` |`, drop an empty first/last cell (leading/trailing
// pipe), pad/truncate to `count`, trim, unescape `\|`.
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

// --- leaf block rules (each returns null or { next, ... }) ---------------

// Indented code block at lines[i]. Returns { text, next } where next is
// the index just past the last code line (trailing blank lines are not
// consumed: they belong to the following space run).
function lexCode(lines, i) {
  const n = lines.length;
  let lastCode = -1;
  let j = i;
  while (j < n) {
    if (isCodeLine(lines[j])) { lastCode = j; j++; continue; }
    if (blankLine(lines[j])) {
      let k = j;
      while (k < n && blankLine(lines[k])) k++;
      if (k < n && isCodeLine(lines[k])) { j = k; continue; }
    }
    break;
  }
  if (lastCode < 0) return null;
  let text = lines.slice(i, lastCode + 1).map((line) => dropIndent(line, 4)).join('\n');
  // marked's code token keeps the newline ending the last content line,
  // unless a blank line follows it with more content after that (its
  // trimTrailingBlankLines drops those). A lone blank final line is
  // just the source's own trailing newline, which is kept.
  const after = lastCode + 1;
  if (after < n && !(blankLine(lines[after]) && after < n - 1)) text += '\n';
  return { text, next: lastCode + 1 };
}

// Fenced code block at lines[i]. Returns { text, lang, next }.
function lexFence(lines, i) {
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
  // Indent compensation (backtick fences only): lines are dedented by the
  // opening fence's leading whitespace.
  if (ch === '`' && sp > 0) {
    text = text.split('\n').map((line) => {
      const m = /^\s+/.exec(line);
      if (!m) return line;
      return line.slice(Math.min(m[0].length, sp));
    }).join('\n');
  }
  const lang = info.trim() ? unescPunct(info.trim()) : info;
  return { text, lang, next: contentEnd === n ? n : closeIdx + 1 };
}

// ATX heading at lines[i]. Returns { depth, text, next }.
function lexHeading(lines, i) {
  const line = lines[i];
  let sp = 0;
  while (sp < line.length && line[sp] === ' ' && sp < 3) sp++;
  let j = sp;
  while (j < line.length && line[j] === '#') j++;
  const depth = j - sp;
  if (depth === 0 || depth > 6) return null;
  if (j < line.length && !isWs(line[j])) return null;
  let text = line.slice(j).trim();
  if (text.endsWith('#')) {
    const s = rtrimCh(text, '#');
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
function lexDef(ctx, lines, i) {
  const tail = lines.slice(i).join('\n');
  const n = tail.length;
  let p = 0;
  while (p < n && tail[p] === ' ' && p < 3) p++;
  if (tail[p] !== '[') return null;
  const lab = scanRefLabel(tail, p + 1);
  if (!lab) return null;
  let k = lab.end;
  if (tail[k] !== ':') return null;
  k++;
  while (tail[k] === ' ') k++;
  if (tail[k] === '\n') { k++; while (tail[k] === ' ' || tail[k] === '\t') k++; }
  // Href: `<...>` (same line) or a run of non-whitespace.
  let href = '';
  if (tail[k] === '<') {
    const end = tail.indexOf('>', k + 1);
    const nl = tail.indexOf('\n', k);
    if (end === -1 || (nl !== -1 && end > nl)) return null;
    href = tail.slice(k + 1, end);
    k = end + 1;
  } else {
    let m = k;
    while (m < n && !isWs(tail[m])) m++;
    if (m === k) return null;
    href = tail.slice(k, m);
    k = m;
  }
  // A non-angle href with an unmatched `)` is not a definition.
  if (!href.startsWith('<') && closeParenIdx(href, '()') !== -1) return null;
  const cleanHref = href.startsWith('<') && href.endsWith('>')
    ? unescPunct(href.slice(1, -1))
    : unescPunct(href);
  // End of the definition line: only spaces, then a line end or EOF.
  const lineEndOk = (q) => {
    let e = q;
    while (tail[e] === ' ') e++;
    return tail[e] === '\n' || e >= n ? e : -1;
  };
  const makeDef = (rawEnd, title) => {
    // Lines consumed: the raw text spans rawEnd chars of the tail.
    const rawLines = tail.slice(0, rawEnd).split('\n').length;
    return {
      tag: normLabel(lab.ref),
      href: cleanHref,
      title: title !== undefined ? unescPunct(title) : undefined,
      next: i + rawLines - (tail.slice(0, rawEnd).endsWith('\n') ? 1 : 0),
      raw: tail.slice(0, rawEnd),
    };
  };
  // Try with a title: separator ` +(?:\n[ \t]*)?` or ` *\n[ \t]*`.
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
    const t = parseDefTitle(tail, u);
    if (t) {
      const e = lineEndOk(t.end);
      if (e !== -1) return makeDef(e, t.title);
    }
  }
  // Fall back to a title-less definition.
  const e = lineEndOk(k);
  if (e !== -1) return makeDef(e, undefined);
  return null;
}

// HTML block at lines[i]. Returns { text, next } or null.
function lexHtml(lines, i) {
  const first = lines[i];
  let sp = 0;
  while (sp < first.length && first[sp] === ' ' && sp < 3) sp++;
  if (first[sp] !== '<') return null;
  const rest = first.slice(sp);
  const lower = rest.toLowerCase();
  const tail = lines.slice(i).join('\n');
  const n = tail.length;
  // How many lines does a text of this length cover? The text covers
  // lines up to its last newline, plus one more line when it does not
  // end with a newline.
  const coverLines = (text) => {
    let c = 0;
    for (let q = 0; q < text.length; q++) if (text[q] === '\n') c++;
    return text.endsWith('\n') ? c : c + 1;
  };
  // matchEnd for a terminator search: end of the line holding the
  // terminator, plus any following newlines.
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
    // Type 1: <script|pre|style|textarea ...> ... </name>
    const closeRe = new RegExp('</' + m1[1] + '>', 'i');
    const cm = closeRe.exec(tail);
    matchEnd = cm ? endAfter(cm.index + cm[0].length) : n;
  } else if (rest.startsWith('<!--')) {
    // Type 2: comment.
    if (rest.startsWith('<!-->') || rest.startsWith('<!--->')) {
      matchEnd = endAfter(0);
    } else {
      const end = tail.indexOf('-->', 4);
      matchEnd = end === -1 ? n : endAfter(end + 3);
    }
  } else if (rest.startsWith('<?')) {
    // Type 3: processing instruction.
    const end = tail.indexOf('?>', 2);
    matchEnd = end === -1 ? n : endAfter(end + 2);
  } else if (/^<![A-Z]/.test(rest)) {
    // Type 4: declaration.
    const end = tail.indexOf('>', 2);
    matchEnd = end === -1 ? n : endAfter(end + 1);
  } else if (rest.startsWith('<![CDATA[')) {
    // Type 5: CDATA.
    const end = tail.indexOf(']]>', 9);
    matchEnd = end === -1 ? n : endAfter(end + 3);
  } else {
    // Type 6: block-level tag, or type 7: any other tag alone on its
    // line. Both end at the first blank line.
    const tagRe = new RegExp('^</?(?:' + HTML_BLOCK_TAGS + ')(?:[ \\t]+|$|/?>)', 'i');
    const openRe = /^<(?!script|pre|style|textarea)([a-z][a-z0-9-]*)(?: +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?)* *\/?>(?=[ \t]*(?:\n|$))/i;
    const closeRe = /^<\/[a-z][a-z0-9-]*\s*>(?=[ \t]*(?:\n|$))/i;
    if (!tagRe.test(rest) && !openRe.test(rest) && !closeRe.test(rest)) return null;
    // Consume lines until a blank line (consuming exactly one blank
    // line: matchEnd sits just past its newline, or at EOF).
    let p = i + 1;
    let end = n;
    while (p < lines.length) {
      if (blankLine(lines[p])) {
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
  const text = trimTrailBlanks(tail.slice(0, matchEnd));
  return { text, next: i + coverLines(text) };
}

// Table at lines[i]. Returns { header, align, rows, next } or null.
function lexTable(lines, i) {
  const headerLine = lines[i];
  if (blankLine(headerLine)) return null;
  if (i + 1 >= lines.length) return null;
  const delimLine = lines[i + 1];
  if (!RE_TABLE_DELIM.test(delimLine)) return null;
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
  // ends only at a spaces-only line: a tab-only line is itself a row of
  // empty cells, as are lines like a setext underline.
  const rows = [];
  let p = i + 2;
  while (p < lines.length) {
    const ln = lines[p];
    if (/^ *$/.test(ln) || isHr(ln) || isHeadingStart(ln) || isBqLine(ln)
      || isCodeLine(ln) || isFenceStart(ln) || isListGfm(ln) || isHtmlInterrupt(ln)) break;
    rows.push(ln);
    p++;
  }
  return {
    header: headerCells,
    align,
    rows: rows.map((r) => splitCells(r, headerCells.length)),
    next: p,
  };
}

// Setext heading at lines[i]. Returns { depth, text, next } or null.
function lexSetext(lines, i) {
  const first = lines[i];
  // An empty first line can never head a setext heading (marked's
  // lheading needs at least one character of text before the
  // underline); this only arises from the list lazy-line test, where
  // the previous line's dedented rest may be empty.
  if (first === '') return null;
  if (setextExcludedFirst(first)) return null;
  const collected = [first];
  let j = i + 1;
  while (j < lines.length) {
    const ln = lines[j];
    const um = RE_SETEXT_UNDER.exec(ln);
    if (um) {
      return {
        depth: ln.trimStart().charAt(0) === '=' ? 1 : 2,
        text: collected.join('\n').trim(),
        next: j + 1,
      };
    }
    if (blankLine(ln) || setextExcludedCont(ln)) return null;
    collected.push(ln);
    j++;
  }
  return null;
}

// First line of a setext heading may not be a bullet, indented code,
// fence, blockquote, heading, html tag line, or table delimiter line.
function setextExcludedFirst(line) {
  if (/^ {0,3}(?:[*+-]|\d{1,9}[.)]) /.test(line)) return true;
  if (isCodeLine(line)) return true;
  if (isFenceStart(line)) return true;
  if (isBqLine(line)) return true;
  if (isHeadingStart(line)) return true;
  if (/^ {0,3}<[^>\n]+>$/.test(line)) return true;
  if (RE_TABLE_DELIM_PIPE.test(line)) return true;
  return false;
}

// Continuation lines of a setext heading may not be blank or a bullet,
// fence, blockquote, heading, hr, html tag line, or table delimiter line.
function setextExcludedCont(line) {
  if (/^ {0,3}(?:[*+-]|\d{1,9}[.)]) /.test(line)) return true;
  if (isFenceStart(line)) return true;
  if (isBqLine(line)) return true;
  if (isHeadingStart(line)) return true;
  if (isHr(line)) return true;
  if (/^ {0,3}<[^>\n]+>$/.test(line)) return true;
  if (RE_TABLE_DELIM_PIPE.test(line)) return true;
  return false;
}

// Does line `lines[j]` interrupt a paragraph? (hr, heading, blockquote,
// fences, list, html, table start — no indented code, no setext, no def.)
// The table-start check applies to every line: a header-looking line
// whose next line is a delimiter stops the paragraph whatever it starts
// with.
function paraInterrupt(lines, j) {
  const ln = lines[j];
  if (blankLine(ln)) return true;
  const [ind, fi] = indentOf(ln);
  if (ind >= 4) return false;
  const ch = ln[fi];
  if (ch === '#') { if (isHeadingStart(ln)) return true; }
  else if (ch === '`' || ch === '~') { if (isFenceStart(ln)) return true; }
  else if (ch === '>') return true;
  else if (ch === '-' || ch === '+' || ch === '*' || ch === '_') {
    if (isHr(ln) || isListGfm(ln)) return true;
  }
  else if (ch >= '0' && ch <= '9') { if (isListGfm(ln)) return true; }
  else if (ch === '<') { if (isHtmlInterrupt(ln)) return true; }
  return isTableStart(lines, j);
}

// Paragraph at lines[i]. Returns { text, next }.
function lexPara(lines, i) {
  const n = lines.length;
  const collected = [lines[i]];
  let j = i + 1;
  while (j < n) {
    const ln = lines[j];
    if (blankLine(ln)) {
      // A spaces-only line ends the paragraph, unless it is the final
      // line of the input (no newline after it): marked's paragraph
      // rule only refuses a continuation followed by spaces+newline.
      if (j === n - 1) { collected.push(ln); j = n; }
      break;
    }
    if (paraInterrupt(lines, j)) break;
    collected.push(ln);
    j++;
  }
  // marked's paragraph tokenizer drops exactly one trailing newline
  // from the paragraph text (a spaces-only final line keeps its spaces).
  let text = collected.join('\n');
  if (text.charCodeAt(text.length - 1) === 10) text = text.slice(0, -1);
  return { text, next: j };
}

// --- blockquote ------------------------------------------------------------

// Is the line at `lines[j]` an interrupt for a lazy blockquote
// continuation (hr, heading, blockquote, fences, list, html, blank —
// no indented code, no setext, and no table: marked's blockquote
// regex lets a table-looking line continue the lazy paragraph).
function isLazyInterrupt(lines, j) {
  const ln = lines[j];
  return blankLine(ln) || isHr(ln) || isHeadingStart(ln) || isBqLine(ln)
    || isFenceStart(ln) || isListKe(ln) || isHtmlInterrupt(ln);
}

// Strip one blockquote marker from a line (no-op when there is none).
function stripBqMarker(line) {
  return line.replace(/^ {0,3}>[ \t]?/, '');
}

// Strip the markers of one collected frame (array of lines) into the
// frame's content lines, applying marked's tab-expansion after the
// marker and the setext-underline indentation on the way.
function stripFrame(frame) {
  const out = [];
  for (let idx = 0; idx < frame.length; idx++) {
    const line = frame[idx];
    const m = /^( {0,3}>)([ \t]+)/.exec(line);
    if (m) {
      const rest = line.slice(m[0].length);
      out.push(m[1] + expandTabs(m[2], m[1].length) + rest);
      continue;
    }
    // Lazy lines: a setext-underline-shaped line is indented 4 spaces
    // (it must not form a heading from the previous line).
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
function parseQuote(ctx, lines, i) {
  const n = lines.length;
  if (!isBqLine(lines[i])) return null;
  // Collect the blockquote lines: `>` lines, each pulling in its lazy
  // paragraph-continuation lines.
  const collected = [];
  let p = i;
  while (p < n) {
    const ln = lines[p];
    if (!isBqLine(ln)) break;
    collected.push(ln);
    p++;
    const content = ln.replace(/^ {0,3}> ?/, '');
    if (content.trim() !== '') {
      while (p < n && !isLazyInterrupt(lines, p)) {
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
    // One frame: lazy lines, then `>` lines.
    let seen = false;
    const frame = [];
    let q = 0;
    for (; q < rest.length; q++) {
      if (isBqLine(rest[q])) { frame.push(rest[q]); seen = true; }
      else if (!seen) frame.push(rest[q]);
      else break;
    }
    const frameLines = stripFrame(frame);
    lexInto(ctx, frameLines, true, inner, true);
    rawLines = rawLines.concat(frame);
    strippedLines = strippedLines.concat(frameLines);
    consumed += q;
    rest = rest.slice(q);
    if (rest.length === 0) break;
    const last = inner[inner.length - 1];
    if (last && (last[0] === R_CODE || last[0] === R_HEAD || last[0] === R_HR
      || last[0] === R_HTML || last[0] === R_TABLE)) break;
    if (last && last[0] === R_QUOTE) {
      // The frame ended in a nested blockquote: re-parse the inner
      // quote's raw text plus the remaining lines (markers stripped)
      // as one blockquote, so its content continues into them.
      const g = last;
      const restStripped = rest.map(stripBqMarker);
      const combined = g[2].concat(restStripped);
      const reparsed = parseQuote(ctx, combined, 0);
      inner[inner.length - 1] = reparsed.rec;
      const usedRest = reparsed.next - g[2].length;
      strippedLines = strippedLines.slice(0, strippedLines.length - g[3].length)
        .concat(reparsed.rec[3]);
      rawLines = rawLines.concat(rest.slice(0, usedRest));
      consumed += usedRest;
      rest = rest.slice(usedRest);
      if (rest.length > 0 && isBqLine(rest[0])) continue;
      break;
    } else if (last && last[0] === R_LIST) {
      // The frame ended in a list: re-parse the list's source plus the
      // remaining lines, so its last item continues into them.
      const g = last;
      const combined = g[5].concat(rest);
      const reparsed = parseList(ctx, combined, 0);
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
  const rec = [R_QUOTE, inner, rawLines, strippedLines];
  return { rec, next: i + consumed };
}

// --- list ------------------------------------------------------------------

// Interrupt patterns for list-item continuation lines, built once per
// content-indent limit RL (0-3) and cached.
const LIST_INTERRUPT_CACHE = [];
function listInterruptRes(RL) {
  let r = LIST_INTERRUPT_CACHE[RL];
  if (!r) {
    r = {
      bullet: new RegExp('^ {0,' + RL + '}(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))'),
      hr: new RegExp('^ {0,' + RL + '}((?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)'),
      fences: new RegExp('^ {0,' + RL + '}(?:```|~~~)'),
      heading: new RegExp('^ {0,' + RL + '}#{1,6}(?:\\s|$)'),
      html: new RegExp('^ {0,' + RL + '}(?:</?(?:' + HTML_BLOCK_TAGS + ')(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)', 'i'),
      blockquote: new RegExp('^ {0,' + RL + '}>'),
    };
    LIST_INTERRUPT_CACHE[RL] = r;
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
  const res = listInterruptRes(RL);
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
  const res = listInterruptRes(RL);
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
// ordered ones. Returns { bulletEnd, rest } (rest = text after the
// bullet) or null.
function matchItemLine(line, ordered, marker) {
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
function parseList(ctx, lines, i) {
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
  if (isHr(firstLine)) return null;
  const listStart = i;
  const items = [];
  let loose = false;
  let pFlag = false;
  let e = i;
  while (e < n) {
    const m0 = matchItemLine(lines[e], ordered, marker);
    if (!m0 || isHr(lines[e])) break;
    const itemStartIdx = e;
    e++;
    const g = m0.rest;
    const b = m0.bulletEnd;
    // m = the remainder with its leading whitespace tab-expanded
    // (counting columns from the bullet width).
    let m = g;
    const wsm = /^[ \t]+/.exec(g);
    if (wsm) m = expandTabs(wsm[0], b) + g.slice(wsm[0].length);
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
    if (blankItem && e < n && blankLine(lines[e])) {
      e++;
      u = true;
    }
    if (!u) {
      // A nested block may sit one column deeper than the interrupt
      // limit, so it belongs to the item.
      const RL = Math.max(0, Math.min(3, R - 1));
      while (e < n) {
        const U = lines[e];
        // Tab expansion of the leading whitespace only matters when
        // the line holds a tab at all (spaces expand to themselves).
        const Z = U.indexOf('\t') === -1 ? U : U.replace(/^[ \t]+/, (me) => expandTabs(me, 0));
        if (listInterrupts(U, RL)) break;
        const uBlank = blankLine(U);
        let zi = 0;
        while (zi < Z.length && Z[zi] === ' ') zi++;
        if (zi >= R || uBlank) {
          dLines.push(Z.slice(R));
        } else {
          if (blankItem || firstNonSpaceExpanded(m) >= 4 || listInterruptsLazy(m, RL)) break;
          let qe = U;
          if (/^ {0,3}(=+|-+) *$/.test(U) && lexSetext([m, U], 0)) {
            qe = '    ' + Z.replace(/^ {0,3}/, '');
          }
          dLines.push(qe);
        }
        blankItem = uBlank;
        e++;
        m = Z.slice(R);
      }
    }
    // The item's raw ends with a blank line when its last consumed line
    // is blank and terminated.
    const endsBlank = e > itemStartIdx && blankLine(lines[e - 1]) && e - 1 < n - 1;
    items.push({ dLines, endsBlank });
    if (!loose) {
      if (pFlag) loose = true;
      else if (endsBlank) pFlag = true;
    }
  }
  if (items.length === 0) return null;
  // Trim trailing blank lines from the last item, and trailing spaces
  // from its last line (marked trims the last item's raw and text).
  const lastItem = items[items.length - 1];
  while (lastItem.dLines.length > 0 && blankLine(lastItem.dLines[lastItem.dLines.length - 1])) {
    lastItem.dLines.pop();
  }
  if (lastItem.dLines.length > 0) {
    const li = lastItem.dLines.length - 1;
    lastItem.dLines[li] = lastItem.dLines[li].replace(/[ \t]+$/, '');
  }
  // The list's consumed range excludes trailing blank lines.
  let next = e;
  while (next > listStart && blankLine(lines[next - 1])) next--;
  // Lex each item's text (non-top) and check looseness via space records.
  const built = [];
  for (const item of items) {
    const d = item.dLines.join('\n');
    const recs = lexLines(ctx, item.dLines, false);
    if (!loose) {
      for (const r of recs) {
        if (r[0] === R_SPACE && r[1] >= 2) { loose = true; break; }
      }
    }
    built.push({ d, recs });
  }
  // Task checkboxes: strip `[ ]`/`[x]` from the item and its first token,
  // and surface a checkbox flag.
  const outItems = [];
  for (const item of built) {
    let checked = null;
    const task = /^\[[ xX]\][ \t]+\S/.test(item.d);
    if (task) {
      const first = item.recs[0];
      if (first && (first[0] === R_TEXT || first[0] === R_PARA)) {
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
      for (const r of recs) if (r[0] === R_TEXT) r[0] = R_PARA;
    }
  }
  const rec = [
    R_LIST, ordered, ordered ? parseInt(startNum, 10) : '', loose, outItems,
    lines.slice(listStart, next),
  ];
  return { rec, next };
}

// --- the block loop --------------------------------------------------------

// Lex `lines` into `recs` (appended). `top` selects paragraph vs text as
// the fallback; `mergeFirst` merges the first paragraph created by this
// call into a trailing paragraph of `recs` (blockquote frames).
function lexInto(ctx, lines, top, recs, mergeFirst) {
  const n = lines.length;
  const startLen = recs.length;
  let i = 0;
  let seenContent = false;
  while (i < n) {
    if (blankLine(lines[i])) {
      let j = i;
      while (j < n && blankLine(lines[j])) j++;
      // A blank run holds k newlines of its own, plus one more when it
      // follows a block in this same lexing (the newline ending that
      // block's last line).
      recs.push([R_SPACE, (j - i) + (seenContent ? 1 : 0)]);
      i = j;
      continue;
    }
    const L = lines[i];
    const [ind, fi] = indentOf(L);
    let handled = false;
    if (ind >= 4) {
      const cd = lexCode(lines, i);
      if (cd) {
        const last = recs[recs.length - 1];
        if (last && (last[0] === R_PARA || last[0] === R_TEXT)) {
          last[1] += '\n' + cd.text;
        } else {
          recs.push([R_CODE, cd.text, '']);
          seenContent = true;
        }
        i = cd.next;
        handled = true;
      }
    }
    if (!handled) {
      const ch = L[fi];
      if (ch === '#') {
        const hd = lexHeading(lines, i);
        if (hd) {
          recs.push([R_HEAD, hd.depth, hd.text]);
          seenContent = true;
          i = hd.next;
          handled = true;
        }
      } else if (ch === '`' || ch === '~') {
        const fn = lexFence(lines, i);
        if (fn) {
          recs.push([R_CODE, fn.text, fn.lang]);
          seenContent = true;
          i = fn.next;
          handled = true;
        }
      } else if (ch === '-' || ch === '+' || ch === '*' || ch === '_') {
        if (isHr(L)) {
          recs.push([R_HR]);
          seenContent = true;
          i++;
          handled = true;
        } else {
          const ls = parseList(ctx, lines, i);
          if (ls) {
            recs.push(ls.rec);
            seenContent = true;
            i = ls.next;
            handled = true;
          }
        }
      } else if (ch === '>') {
        const bq = parseQuote(ctx, lines, i);
        if (bq) {
          recs.push(bq.rec);
          seenContent = true;
          i = bq.next;
          handled = true;
        }
      } else if (ch >= '0' && ch <= '9') {
        const ls = parseList(ctx, lines, i);
        if (ls) {
          recs.push(ls.rec);
          seenContent = true;
          i = ls.next;
          handled = true;
        }
      } else if (ch === '<') {
        const hm = lexHtml(lines, i);
        if (hm) {
          recs.push([R_HTML, hm.text]);
          seenContent = true;
          i = hm.next;
          handled = true;
        }
      } else if (ch === '[') {
        const df = lexDef(ctx, lines, i);
        if (df) {
          const last = recs[recs.length - 1];
          if (last && (last[0] === R_PARA || last[0] === R_TEXT)) {
            last[1] += '\n' + df.raw;
          } else if (!ctx.defs.has(df.tag)) {
            ctx.defs.set(df.tag, { href: df.href, title: df.title });
          }
          i = df.next;
          handled = true;
        }
      }
      if (!handled) {
        const tb = lexTable(lines, i);
        if (tb) {
          recs.push([R_TABLE, tb.header, tb.align, tb.rows]);
          seenContent = true;
          i = tb.next;
        } else {
          const st = lexSetext(lines, i);
          if (st) {
            recs.push([R_HEAD, st.depth, st.text]);
            seenContent = true;
            i = st.next;
          } else if (top) {
            const pg = lexPara(lines, i);
            recs.push([R_PARA, pg.text]);
            seenContent = true;
            i = pg.next;
          } else {
            // Single text line (non-top fallback), merged with a
            // preceding text record.
            const last = recs[recs.length - 1];
            if (last && last[0] === R_TEXT) last[1] += '\n' + L;
            else {
              recs.push([R_TEXT, L]);
              seenContent = true;
            }
            i++;
          }
        }
      }
    }
  }
  // Merge the first paragraph this call created into a trailing
  // paragraph of the shared records (blockquote frames).
  if (mergeFirst && recs.length > startLen) {
    const prev = recs[startLen - 1];
    const firstNew = recs[startLen];
    if (prev && prev[0] === R_PARA && firstNew && firstNew[0] === R_PARA) {
      prev[1] += '\n' + firstNew[1];
      recs.splice(startLen, 1);
    }
  }
}

// Lex `lines` into a fresh records array.
function lexLines(ctx, lines, top) {
  const recs = [];
  lexInto(ctx, lines, top, recs, false);
  return recs;
}

// --- rendering -------------------------------------------------------------

function checkboxHtml(checked) {
  return '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
}

function renderRecs(ctx, recs, out, firstCb) {
  let cb = firstCb || null;
  for (const rec of recs) {
    switch (rec[0]) {
      case R_SPACE:
        break;
      case R_CODE: {
        const langWord = rec[2] ? rec[2].match(/^\S*/)[0] : '';
        const r = rec[1] ? rec[1].replace(/\n$/, '') + '\n' : '';
        const esc = escHtml(r, false);
        if (langWord) out.push('<pre><code class="language-' + escHtml(langWord, true) + '">' + esc + '</code></pre>\n');
        else out.push('<pre><code>' + esc + '</code></pre>\n');
        break;
      }
      case R_HEAD: {
        const inner = [];
        inlineTop(ctx, inner, rec[2]);
        out.push('<h' + rec[1] + '>' + inner.join('') + '</h' + rec[1] + '>\n');
        break;
      }
      case R_HR:
        out.push('<hr>\n');
        break;
      case R_QUOTE: {
        const inner = [];
        renderRecs(ctx, rec[1], inner, null);
        out.push('<blockquote>\n' + inner.join('') + '</blockquote>\n');
        break;
      }
      case R_LIST: {
        const ordered = rec[1];
        const start = rec[2];
        const loose = rec[3];
        const items = rec[4];
        let s = '';
        for (const item of items) {
          const checked = item[0];
          const itemRecs = item[1];
          const inner = [];
          const cbHtml = checked !== null ? checkboxHtml(checked) : null;
          if (cbHtml !== null && !loose) inner.push(cbHtml);
          renderRecs(ctx, itemRecs, inner, loose ? cbHtml : null);
          s += '<li>' + inner.join('') + '</li>\n';
        }
        const tag = ordered ? 'ol' : 'ul';
        const startAttr = ordered && start !== 1 ? ' start="' + start + '"' : '';
        out.push('<' + tag + startAttr + '>\n' + s + '</' + tag + '>\n');
        break;
      }
      case R_HTML:
        out.push(rec[1]);
        break;
      case R_PARA: {
        const inner = [];
        if (cb !== null) { inner.push(cb); cb = null; }
        inlineTop(ctx, inner, rec[1]);
        out.push('<p>' + inner.join('') + '</p>\n');
        break;
      }
      case R_TEXT: {
        const inner = [];
        if (cb !== null) { inner.push(cb); cb = null; }
        inlineTop(ctx, inner, rec[1]);
        out.push(inner.join(''));
        break;
      }
      case R_TABLE: {
        let head = '';
        for (let i = 0; i < rec[1].length; i++) {
          const inner = [];
          inlineTop(ctx, inner, rec[1][i]);
          head += (rec[2][i] ? '<th align="' + rec[2][i] + '">' : '<th>') + inner.join('') + '</th>\n';
        }
        let body = '';
        for (const row of rec[3]) {
          let rc = '';
          for (let i = 0; i < row.length; i++) {
            const inner = [];
            inlineTop(ctx, inner, row[i]);
            rc += (rec[2][i] ? '<td align="' + rec[2][i] + '">' : '<td>') + inner.join('') + '</td>\n';
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
  const src = markdown.indexOf('\r') === -1
    ? markdown
    : markdown.replace(/\r\n|\r/g, '\n');
  const ctx = { defs: new Map(), inLink: false, inRaw: false, linkEmitted: false };
  const lines = src.split('\n');
  const recs = lexLines(ctx, lines, true);
  const out = [];
  renderRecs(ctx, recs, out, null);
  return out.join('');
}
