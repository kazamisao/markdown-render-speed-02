// Round 13 blind rewrite: a from-scratch CommonMark 0.31.2 + GFM renderer
// byte-identical to marked 18.1.3 (default options). No dependencies.

// ---------------------------------------------------------------- entities
// Named HTML entities, written out as name=codepoint pairs. The lookup is
// built once; only entities with a trailing semicolon are recognised.
const ENT_SRC =
  'nbsp=160 iexcl=161 cent=162 pound=163 curren=164 yen=165 brvbar=166 sect=167 uml=168 copy=169 ordf=170 laquo=171 not=172 shy=173 reg=174 macr=175 deg=176 plusmn=177 sup2=178 sup3=179 acute=180 micro=181 para=182 middot=183 cedil=184 sup1=185 ordm=186 raquo=187 frac14=188 frac12=189 frac34=190 iquest=191 ' +
  'Agrave=192 Aacute=193 Acirc=194 Atilde=195 Auml=196 Aring=197 AElig=198 Ccedil=199 Egrave=200 Eacute=201 Ecirc=202 Euml=203 Igrave=204 Iacute=205 Icirc=206 Iuml=207 ETH=208 Ntilde=209 Ograve=210 Oacute=211 Ocirc=212 Otilde=213 Ouml=214 times=215 Oslash=216 Ugrave=217 Uacute=218 Ucirc=219 Uuml=220 Yacute=221 THORN=222 szlig=223 agrave=224 aacute=225 acirc=226 atilde=227 auml=228 aring=229 aelig=230 ccedil=231 egrave=232 eacute=233 ecirc=234 euml=235 igrave=236 iacute=237 icirc=238 iuml=239 eth=240 ntilde=241 ograve=242 oacute=243 ocirc=244 otilde=245 ouml=246 divide=247 oslash=248 ugrave=249 uacute=250 ucirc=251 uuml=252 yacute=253 thorn=254 yuml=255 ' +
  'Amacr=256 amacr=257 Abreve=258 abreve=259 Aogon=260 aogon=261 Cacute=262 cacute=263 Ccaron=268 ccaron=269 Dcaron=270 dcaron=271 Emacr=274 emacr=275 Edot=278 edot=279 Eogon=280 eogon=281 Ecaron=282 ecaron=283 Gbreve=286 gbreve=287 Gdot=288 gdot=289 Hcirc=292 hcirc=293 Hstrok=294 hstrok=295 Idot=304 imacr=299 Imacr=298 inodot=305 Iogon=302 iogon=303 Iuml2=207 Jcirc=308 jcirc=309 Kcedil=310 kcedil=311 kgreen=312 Lacute=313 lacute=314 Lcaron=317 lcaron=318 Lmidot=319 lmidot=320 Lstrok=321 lstrok=322 Nacute=323 nacute=324 Ncaron=327 ncaron=328 Ncedil=325 ncedil=326 napos=329 Omacr=332 omacr=333 Odblac=336 odblac=337 OElig=338 oelig=339 Racute=340 racute=341 Rcaron=344 rcaron=345 Rcedil=342 rcedil=343 Sacute=346 sacute=347 Scirc=348 scirc=349 Scedil=350 scedil=351 Scaron=352 scaron=353 Tcedil=354 tcedil=355 Tcaron=356 tcaron=357 Tstrok=358 tstrok=359 Ubreve=364 ubreve=365 Uacute2=218 Ucirc2=219 Udblac=368 udblac=369 Uogon=370 uogon=371 Uring=366 uring=367 Uuml2=220 Yuml2=376 Zacute=377 zacute=378 Zcaron=381 zcaron=382 Zdot=379 zdot=380 ' +
  'fnof=402 circ=710 tilde=732 Alpha=913 Beta=914 Gamma=915 Delta=916 Epsilon=917 Zeta=918 Eta=919 Theta=920 Iota=921 Kappa=922 Lambda=923 Mu=924 Nu=925 Xi=926 Omicron=927 Pi=928 Rho=929 Sigma=931 Tau=932 Upsilon=933 Phi=934 Chi=935 Psi=936 Omega=937 alpha=945 beta=946 gamma=947 delta=948 epsilon=949 zeta=950 eta=951 theta=952 iota=953 kappa=954 lambda=955 mu=956 nu=957 xi=958 omicron=959 pi=960 rho=961 sigmaf=962 sigma=963 tau=964 upsilon=965 phi=966 chi=967 psi=968 omega=969 thetasym=977 upsih=978 piv=982 ' +
  'ensp=8194 emsp=8195 thinsp=8201 zwnj=8204 zwj=8205 lrm=8206 rlm=8207 ndash=8211 mdash=8212 lsquo=8216 rsquo=8217 sbquo=8218 ldquo=8220 rdquo=8221 bdquo=8222 dagger=8224 Dagger=8225 bull=8226 hellip=8230 permil=8240 prime=8242 Prime=8243 lsaquo=8249 rsaquo=8250 oline=8254 frasl=8260 euro=8364 ' +
  'image=8465 weierp=8472 real=8476 trade=8482 alefsym=8501 larr=8592 uarr=8593 rarr=8594 darr=8595 harr=8596 crarr=8629 lArr=8656 uArr=8657 rArr=8658 dArr=8659 hArr=8660 forall=8704 part=8706 exist=8707 empty=8709 nabla=8711 isin=8712 notin=8713 ni=8715 prod=8719 sum=8721 minus=8722 lowast=8727 radic=8730 prop=8733 infin=8734 ang=8736 and=8743 or=8744 cap=8745 cup=8746 int=8747 there4=8756 sim=8764 cong=8773 asymp=8776 ne=8800 equiv=8801 le=8804 ge=8805 sub=8834 sup=8835 nsub=8836 sube=8838 supe=8839 oplus=8853 otimes=8855 perp=8869 sdot=8901 lceil=8968 rceil=8969 lfloor=8970 rfloor=8971 lang=10216 rang=10217 loz=9674 spades=9824 clubs=9827 hearts=9829 diams=9830 ' +
  'quot=34 amp=38 lt=60 gt=62 apos=39 Tab=9 NewLine=10 colon=58 semi=59 comma=44 period=46 sol=47 bsol=92 equals=61 plus=43 quest=63 commat=64 dollar=36 percnt=37 num=35 ast=42 lpar=40 rpar=41 lsqb=91 rsqb=93 lcub=123 rcub=125 lowbar=95 grave=96 hat=94 tilde2=126 vert=124 check=10003 cross=10007 star=9733 phone=9742 female=9792 male=9794 sung=9834 flat=9837 natur=9838 sharp=9839 ' +
  'Hopf=8461 Eopf=120174 Aopf=120120 Bopf=120121 Copf=120122 Dopc=120123 Fopf=120125 Gopf=120126 Iopf=120128 Jopf=120129 Kopf=120130 Lopf=120131 Mopf=120132 Nopf=120133 Oopf=120134 Popf=120135 Qopf=120136 Ropf=120137 Sopf=120138 Topf=120139 Uopf=120140 Vopf=120141 Wopf=120142 Xopf=120143 Yopf=120144 Zopf=120145 aopf=120146 bopf=120147 copf=120148 dopf=120149 eopf=120150 fopf=120151 gopf=120152 hopf=120153 iopf=120154 jopf=120155 kopf=120156 lopf=120157 mopf=120158 nopf=120159 oopf=120160 popf=120161 qopf=120162 ropf=120163 sopf=120164 topf=120165 uopf=120166 vopf=120167 wopf=120168 xopf=120169 yopf=120170 zopf=120171 ' +
  'Amacr2=256 afr=120072 bfr=120073 cfr=120074 dfr=120075 efr=120076 ffr=120077 gfr=120078 hfr=120079 ifr=120080 jfr=120081 kfr=120082 lfr=120083 mfr=120084 nfr=120085 ofr=120086 pfr=120087 qfr=120088 rfr=120089 sfr=120090 tfr=120091 ufr=120092 vfr=120093 wfr=120094 xfr=120095 yfr=120096 zfr=120097 Afr=120068 Bfr=120069 Cfr=120070 Dfr=120071 Efr=120072 Ffr=120074 Gfr=120075 Hfr=120076 Ifr=120077 Jfr=120078 Kfr=120079 Lfr=120080 Mfr=120081 Nfr=120082 Ofr=120083 Pfr=120084 Qfr=120085 Rfr=120086 Sfr=120087 Tfr=120088 Ufr=120089 Vfr=120090 Wfr=120091 Xfr=120092 Yfr=120093 Zfr=120094 ' +
  'fjlig=102 fjlig2=102 lig=102';

const ENTITIES = new Map();
for (const pair of ENT_SRC.split(' ')) {
  const eq = pair.indexOf('=');
  if (eq > 0) ENTITIES.set(pair.slice(0, eq), String.fromCodePoint(Number(pair.slice(eq + 1))));
}

// ------------------------------------------------------------ char helpers
const SPACE = 32;
const TAB = 9;
const LF = 10;

function isSpaceCh(c) {
  return c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
}
function isAsciiPunct(c) {
  return (
    (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126)
  );
}
// CommonMark's "Unicode punctuation character" is an ASCII punctuation
// character or anything in the Unicode P (punctuation) or S (symbol)
// general categories: currency signs and the like count as punctuation
// for emphasis flanking.
const PUNCT_RE = /[\p{P}\p{S}]/u;
function isPunctCh(ch) {
  if (ch.length === 1) {
    const c = ch.charCodeAt(0);
    if (c < 128) return isAsciiPunct(c);
  }
  return PUNCT_RE.test(ch);
}
function isLetterDigit(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c >= 128;
}

// ---------------------------------------------------------------- escaping
// Text content: escape & < > " '. A & is left alone when it starts a named
// entity reference (&name;), matching marked's escape behaviour; anything
// else is escaped.
function escText(s) {
  if (!/[&<>"']/.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') {
      const semi = s.indexOf(';', i + 1);
      let keep = false;
      if (semi > 0 && semi - i <= 32) {
        const body = s.slice(i + 1, semi);
        if (/^[A-Za-z][A-Za-z0-9_]*$/.test(body)) keep = true;
      }
      out += keep ? '&' : '&amp;';
    } else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else if (c === '"') out += '&quot;';
    else if (c === "'") out += '&#39;';
    else out += c;
  }
  return out;
}

// Attribute value where a valid named entity reference is left alone (marked's
// behaviour for link titles and fenced-code info strings).
function escAttrKeepEnt(s) {
  if (!/[&<>"']/.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '&') {
      const semi = s.indexOf(';', i + 1);
      let keep = false;
      if (semi > 0 && semi - i <= 32) {
        const body = s.slice(i + 1, semi);
        if (/^[A-Za-z][A-Za-z0-9_]*$/.test(body)) keep = true;
      }
      out += keep ? '&' : '&amp;';
    } else if (c === '"') out += '&quot;';
    else if (c === "'") out += '&#39;';
    else if (c === '<') out += '&lt;';
    else if (c === '>') out += '&gt;';
    else out += c;
  }
  return out;
}

// Code content: escape & < > " ' unconditionally (no entity handling).
function escCode(s) {
  if (!/[&<>"']/.test(s)) return s;
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Link href: marked percent-encodes like encodeURI and does not escape &.
function encodeHref(s) {
  try {
    return encodeURI(s);
  } catch (_e) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      out += c.charCodeAt(0) < 128 ? encodeURIComponent(c) : c;
    }
    return out;
  }
}

// Decode one NUMERIC entity reference starting at s[i] === '&'. Named
// entities are not decoded (marked passes &name; through verbatim). Returns
// {ch, next} or null when there is no valid numeric entity here.
function parseEntity(s, i) {
  const semi = s.indexOf(';', i + 1);
  if (semi < 0 || semi - i > 32) return null;
  const body = s.slice(i + 1, semi);
  if (body.length < 2 || body[0] !== '#') return null;
  let numStr;
  let base = 10;
  if (body[1] === 'x' || body[1] === 'X') {
    numStr = body.slice(2);
    base = 16;
  } else {
    numStr = body.slice(1);
  }
  if (numStr.length === 0 || numStr.length > 8) return null;
  if (base === 10 ? !/^[0-9]+$/.test(numStr) : !/^[0-9a-fA-F]+$/.test(numStr)) return null;
  const cp = parseInt(numStr, base);
  if (cp > 0x10ffff) return null;
  if (cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) return { ch: '\uFFFD', next: semi + 1 };
  return { ch: String.fromCodePoint(cp), next: semi + 1 };
}

// ------------------------------------------------------- link label / dest
function normalizeLabel(label) {
  return label.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Parse a link destination starting at s[i] (after '(' or after '[label]:').
// Returns {dest, next} where next is the index just past the destination,
// or null. Handles <...> and bare destinations with balanced parens.
function parseLinkDest(s, i) {
  const n = s.length;
  if (i >= n) return { dest: '', next: i };
  if (s[i] === '<') {
    let j = i + 1;
    let dest = '';
    while (j < n) {
      const c = s[j];
      if (c === '\n' || c === '<') return null;
      if (c === '>') return { dest, next: j + 1 };
      if (c === '\\' && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) {
        dest += s[j + 1];
        j += 2;
      } else {
        dest += c;
        j++;
      }
    }
    return null;
  }
  let j = i;
  let dest = '';
  let depth = 0;
  while (j < n) {
    const c = s[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
    if (c === '\\' && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) {
      dest += s[j + 1];
      j += 2;
      continue;
    }
    if (c === '(') {
      depth++;
      dest += c;
      j++;
      continue;
    }
    if (c === ')') {
      if (depth === 0) break;
      depth--;
      dest += c;
      j++;
      continue;
    }
    const code = s.charCodeAt(j);
    if (code < 32 || code === 127) break;
    dest += c;
    j++;
  }
  return { dest, next: j };
}

// Skip spaces, tabs and newlines. Returns new index.
function skipWs(s, i) {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
  return i;
}

// Parse a link title starting at s[i]. Returns {title, next} or null.
function parseLinkTitle(s, i) {
  if (i >= s.length) return null;
  const q = s[i];
  if (q === '"' || q === "'") {
    let j = i + 1;
    let title = '';
    while (j < s.length) {
      const c = s[j];
      if (c === '\n' && s[j + 1] === '\n') return null; // No blank line in a title.
      if (c === q) return { title, next: j + 1 };
      if (c === '\\' && j + 1 < s.length && isAsciiPunct(s.charCodeAt(j + 1))) {
        title += s[j + 1];
        j += 2;
      } else {
        title += c;
        j++;
      }
    }
    return null;
  }
  if (q === '(') {
    let j = i + 1;
    let title = '';
    let depth = 1;
    while (j < s.length) {
      const c = s[j];
      if (c === '\n' && s[j + 1] === '\n') return null; // No blank line in a title.
      if (c === '\\' && j + 1 < s.length && isAsciiPunct(s.charCodeAt(j + 1))) {
        title += s[j + 1];
        j += 2;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) return { title, next: j + 1 };
      }
      title += c;
      j++;
    }
    return null;
  }
  return null;
}

// ------------------------------------------------------------ line columns
// Visual column of character index idx in line (tab stops every 4).
function colAt(line, idx) {
  let col = 0;
  for (let k = 0; k < idx && k < line.length; k++) {
    col += line[k] === '\t' ? 4 - (col % 4) : 1;
  }
  return col;
}

// Advance from index idx by `cols` visual columns starting at column
// startCol. Returns {idx, extra}: idx is the first unconsumed character,
// extra is the number of spaces a partially-consumed tab leaves behind.
function stripCols(line, idx, cols, startCol) {
  let col = startCol || 0;
  let k = idx;
  const target = (startCol || 0) + cols;
  while (k < line.length && col < target && (line[k] === ' ' || line[k] === '\t')) {
    if (line[k] === '\t') {
      const w = 4 - (col % 4);
      if (col + w > target) return { idx: k + 1, extra: col + w - target };
      col += w;
      k++;
    } else {
      col++;
      k++;
    }
  }
  return { idx: k, extra: 0 };
}

// Number of leading whitespace columns of line starting at idx, where the
// visual column at idx is startCol.
function indentCols(line, idx, startCol) {
  let col = startCol || 0;
  let k = idx;
  let count = 0;
  while (k < line.length && (line[k] === ' ' || line[k] === '\t')) {
    const w = line[k] === '\t' ? 4 - (col % 4) : 1;
    col += w;
    count += w;
    k++;
  }
  return count;
}

function isBlankLine(line) {
  for (let k = 0; k < line.length; k++) {
    if (line[k] !== ' ' && line[k] !== '\t') return false;
  }
  return true;
}


// ------------------------------------------------- link reference definitions
// Try to parse one link reference definition starting at lines[li].
// Returns {linesUsed, label, dest, title} or null.
// Skip spaces and tabs, then optionally one newline plus spaces/tabs.
// Returns the new position, or -1 when a blank line would be crossed.
function skipWsNoBlank(s, p) {
  while (p < s.length && (s[p] === ' ' || s[p] === '\t')) p++;
  if (p < s.length && s[p] === '\n') {
    p++;
    while (p < s.length && (s[p] === ' ' || s[p] === '\t')) p++;
    if (p >= s.length || s[p] === '\n') return -1;
  }
  return p;
}

// Parse one link reference definition at the start of lines[li]. The
// destination and title may be on following lines; the title may span
// lines but never a blank line. Returns {linesUsed, label, dest, title}
// or null.
function tryParseDef(lines, li) {
  const s = lines.slice(li).join('\n');
  let pos = 0;
  let cols = 0;
  while (pos < s.length && (s[pos] === ' ' || s[pos] === '\t') && cols < 3) {
    cols += s[pos] === '\t' ? 4 - (cols % 4) : 1;
    pos++;
  }
  if (pos >= s.length || s[pos] !== '[') return null;
  const labelEnd = findLinkEnd(s, pos);
  if (labelEnd < 0) return null;
  const rawLabel = s.slice(pos + 1, labelEnd);
  if (rawLabel.includes('\n\n') || rawLabel.length > 999) return null;
  const label = normalizeLabel(unescapePunct(rawLabel));
  if (label.length === 0) return null;
  let p = labelEnd + 1;
  if (s[p] !== ':') return null;
  p++;
  p = skipWsNoBlank(s, p);
  if (p < 0 || p >= s.length) return null;
  const destRes = parseLinkDest(s, p);
  if (!destRes) return null;
  if (destRes.dest.length === 0 && s[p] !== '<') return null;
  const dest = destRes.dest;
  let q = destRes.next;
  // After the destination, only whitespace may follow on the line, or a
  // title (separated by whitespace). A title opener with no whitespace
  // before it makes the whole definition invalid.
  if (q < s.length && (s[q] === '"' || s[q] === "'" || s[q] === '(')) return null;
  const destLine = s.slice(0, q).split('\n').length - 1;
  let title = null;
  let endPos = q;
  const q2 = skipWsNoBlank(s, q);
  if (q2 >= 0 && q2 < s.length && (s[q2] === '"' || s[q2] === "'" || s[q2] === '(')) {
    const t = parseLinkTitle(s, q2);
    if (t) {
      // Only whitespace may follow the title on its line.
      let r = t.next;
      while (r < s.length && (s[r] === ' ' || s[r] === '\t')) r++;
      if (r >= s.length || s[r] === '\n') {
        title = t.title;
        endPos = t.next;
      } else if (s.slice(0, q2).split('\n').length - 1 === destLine) {
        // The title is on the destination's line and is not followed by
        // only whitespace: the definition is invalid.
        return null;
      }
      // Otherwise (title on a later line, invalid): fall back to the
      // destination-only definition.
    } else if (s.slice(0, q2).split('\n').length - 1 === destLine) {
      return null;
    }
  } else if (q2 >= 0) {
    // No title: the next non-whitespace character must be on a later line
    // (it belongs to the following paragraph), not on this line.
    let r = q;
    while (r < s.length && (s[r] === ' ' || s[r] === '\t')) r++;
    if (r < s.length && s[r] !== '\n') return null;
  }
  const linesUsed = s.slice(0, endPos).split('\n').length;
  return { linesUsed, label, dest, title };
}

// Consume leading reference definitions from a paragraph's lines.
// Returns the number of lines consumed.
function consumeDefs(lines, refs) {
  let li = 0;
  while (li < lines.length) {
    const d = tryParseDef(lines, li);
    if (!d) break;
    if (!refs.has(d.label)) refs.set(d.label, { dest: d.dest, title: d.title });
    li += d.linesUsed;
  }
  return li;
}

// ------------------------------------------------------------- table rows
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && k + 1 < s.length && s[k + 1] === '|') {
      cur += '\\|';
      k++;
      continue;
    }
    if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur.trim());
  return cells;
}

// Parse a delimiter row; returns an array of alignments ('left' | 'center' |
// 'right' | null) or null when the line is not a delimiter row.
function parseDelimRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const parts = s.split('|');
  const aligns = [];
  for (const part of parts) {
    const cell = part.trim();
    if (!/^:?-+:?$/.test(cell)) return null;
    if (cell.startsWith(':') && cell.endsWith(':')) aligns.push('center');
    else if (cell.startsWith(':')) aligns.push('left');
    else if (cell.endsWith(':')) aligns.push('right');
    else aligns.push(null);
  }
  return aligns;
}

// -------------------------------------------------------------- block parse
function leadWs(s, startCol) {
  let idx = 0;
  let cols = 0;
  let col = startCol || 0;
  while (idx < s.length && (s[idx] === ' ' || s[idx] === '\t')) {
    const w = s[idx] === '\t' ? 4 - (col % 4) : 1;
    col += w;
    cols += w;
    idx++;
  }
  return { idx, cols };
}

function matchATX(body) {
  if (body[0] !== '#') return null;
  let k = 0;
  while (k < body.length && body[k] === '#') k++;
  if (k > 6) return null;
  if (k < body.length && body[k] !== ' ' && body[k] !== '\t') return null;
  let text = body.slice(k);
  text = text.replace(/[ \t]+$/, '');
  text = text.replace(/[ \t]+#+$/, '');
  text = text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  return { level: k, text };
}

function matchFence(body) {
  const ch = body[0];
  if (ch !== '`' && ch !== '~') return null;
  let k = 0;
  while (k < body.length && body[k] === ch) k++;
  if (k < 3) return null;
  const info = body.slice(k);
  if (ch === '`' && info.includes('`')) return null;
  return { ch, len: k, info: info.trim() };
}

function isClosingFence(body, fence) {
  if (body[0] !== fence.ch) return false;
  let k = 0;
  while (k < body.length && body[k] === fence.ch) k++;
  if (k < fence.len) return false;
  for (; k < body.length; k++) {
    if (body[k] !== ' ' && body[k] !== '\t') return false;
  }
  return true;
}

function isHr(body) {
  const c = body[0];
  if (c !== '*' && c !== '-' && c !== '_') return false;
  let count = 0;
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === c) count++;
    else if (ch !== ' ' && ch !== '\t') return false;
  }
  return count >= 3;
}

const TAG_NAME_RE = /^[A-Za-z][A-Za-z0-9-]*/;

// Does this line end the given HTML block (types 1-5)?
function htmlLineEnds(node, line) {
  if (node.htmlType === 1) return line.toLowerCase().includes(node.end);
  if (node.htmlType === 2 || node.htmlType === 3 || node.htmlType === 5) {
    return line.includes(node.end);
  }
  if (node.htmlType === 4) return line.includes('>');
  return false;
}

// Parse a complete HTML tag at the start of s. Returns the index just past
// the tag, or -1 when the line does not begin with a complete tag.
function parseTagPrefix(s) {
  let j = 0;
  if (s[j] !== '<') return -1;
  j++;
  let closing = false;
  if (s[j] === '/') {
    closing = true;
    j++;
  }
  if (j >= s.length || !/[A-Za-z]/.test(s[j])) return -1;
  while (j < s.length && /[A-Za-z0-9-]/.test(s[j])) j++;
  while (true) {
    while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (j >= s.length) return -1;
    if (s[j] === '>') return j + 1;
    if (s[j] === '/' && s[j + 1] === '>') return j + 2;
    if (closing) return -1;
    if (!/[A-Za-z_:]/.test(s[j])) return -1;
    while (j < s.length && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
    while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (s[j] === '=') {
      j++;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j];
        j++;
        while (j < s.length && s[j] !== q) j++;
        if (j >= s.length) return -1;
        j++;
      } else {
        if (j >= s.length || /[\s"'=<>`]/.test(s[j])) return -1;
        while (j < s.length && !/[\s"'=<>`]/.test(s[j])) j++;
      }
    }
  }
}

// Block-level tag names for HTML block type 7 (CommonMark spec).
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center',
  'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head',
  'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav',
  'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section', 'source', 'summary', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
]);

// Match an HTML block start. inPara=true when a paragraph is open (type 7
// cannot interrupt a paragraph). Returns {type, end} or null.
function matchHtmlStart(body, inPara) {
  if (body[0] !== '<') return null;
  const low = body.toLowerCase();
  if (/^<(script|pre|style|textarea)([\s>]|$)/.test(low)) {
    const tag = low.match(/^<(script|pre|style|textarea)/)[1];
    return { type: 1, end: '</' + tag + '>' };
  }
  if (low.startsWith('<!--')) return { type: 2, end: '-->' };
  if (low.startsWith('<?')) return { type: 3, end: '?>' };
  if (/^<![a-z]/i.test(body)) return { type: 4, end: '>' };
  if (low.startsWith('<![cdata[')) return { type: 5, end: ']]>' };
  // Type 6: the line starts with < or </ followed by a block-level tag name,
  // followed by whitespace, the end of the line, '>' or '/>'. The tag does
  // not need to be complete on this line (an attribute value may continue
  // on the next line); it only needs a complete tag name.
  const m6 = body.match(/^<\/?([A-Za-z][A-Za-z0-9-]*)/);
  if (m6 && BLOCK_TAGS.has(m6[1].toLowerCase())) {
    const after = body[m6[0].length];
    if (
      after === undefined ||
      after === ' ' ||
      after === '\t' ||
      after === '>' ||
      (after === '/' && body[m6[0].length + 1] === '>')
    ) {
      return { type: 6, end: 'blank' };
    }
  }
  if (!inPara) {
    // Type 7: a complete open or closing tag, alone on the line.
    const tagEnd = parseTagPrefix(body);
    if (tagEnd > 0 && body.slice(tagEnd).trim() === '') {
      return { type: 7, end: 'blank' };
    }
  }
  return null;
}

// Match a list marker in body (already stripped of leading whitespace).
// ind is the leading-whitespace width of the line before body, absCol is
// the visual column where body starts. contentIndent is measured from the
// start of the line (including its leading whitespace); contentIdx is an
// index into body where the item content starts.
function matchList(body, ind, absCol) {
  let ordered = false;
  let bullet = null;
  let delim = null;
  let start = 1;
  let markerLen = 0;
  if (body[0] === '-' || body[0] === '+' || body[0] === '*') {
    if (body.length > 1 && body[1] !== ' ' && body[1] !== '\t') return null;
    bullet = body[0];
    markerLen = 1;
  } else {
    const m = body.match(/^(\d{1,9})([.)])/);
    if (!m) return null;
    if (m[1].length > 1 && m[1][0] === '0') {
      // Leading zeros are allowed in the marker; the start number is the
      // numeric value. (CommonMark allows them.)
    }
    if (body.length > m[0].length && body[m[0].length] !== ' ' && body[m[0].length] !== '\t') {
      return null;
    }
    ordered = true;
    delim = m[2];
    start = parseInt(m[1], 10);
    markerLen = m[0].length;
  }
  // Whitespace after the marker, measured in columns from the marker end.
  // A tab directly after the marker counts as a single space: the marker
  // consumes one column of it and the remainder stays as content.
  const markerEndCol = absCol + markerLen;
  let k = markerLen;
  let col = markerEndCol;
  let spaces = 0;
  let tabRemainder = 0;
  if (body[k] === '\t') {
    const w = 4 - (col % 4);
    tabRemainder = w - 1;
    spaces = 1;
    k++;
    col += w;
  } else {
    while (k < body.length && (body[k] === ' ' || body[k] === '\t')) {
      const w = body[k] === '\t' ? 4 - (col % 4) : 1;
      col += w;
      spaces += w;
      k++;
    }
  }
  const empty = k >= body.length;
  let contentIndent;
  let contentIdx;
  if (empty) {
    contentIndent = ind + markerLen + 1;
    contentIdx = k;
  } else if (spaces >= 1 && spaces <= 4) {
    contentIndent = ind + markerLen + spaces;
    contentIdx = k;
  } else if (spaces >= 5) {
    contentIndent = ind + markerLen + 1;
    // Consume markerLen+1 columns of the whitespace run.
    let c2 = markerEndCol;
    let k2 = markerLen;
    while (k2 < body.length && c2 < markerEndCol + 1) {
      c2 += body[k2] === '\t' ? 4 - (c2 % 4) : 1;
      k2++;
    }
    contentIdx = k2;
  } else {
    return null; // No space after the marker: not a list item.
  }
  return { ordered, bullet, delim, start, markerLen, contentIndent, contentIdx, empty, tabRemainder };
}

function sameList(listNode, lst) {
  if (listNode.ordered !== lst.ordered) return false;
  if (lst.ordered) return listNode.delim === lst.delim;
  return listNode.bullet === lst.bullet;
}

// The block parser: lines -> document tree. refs is filled with link
// reference definitions found anywhere in the document. endsWithNl is true
// when the source text ended with a newline.
function parseBlocks(lines, endsWithNl) {
  const root = { t: 'doc', kids: [] };
  const stack = [root];
  const refs = new Map();
  let blankIn = null;
  const tip = () => stack[stack.length - 1];

  function addNode(node) {
    checkLoose();
    // A list can only contain items: if the stack top is a list (its last
    // item was closed because the line failed to match it), the list is
    // finished and this node belongs to the list's parent.
    while (tip().t === 'list') stack.pop();
    tip().kids.push(node);
  }
  function openNode(node) {
    checkLoose();
    while (tip().t === 'list') stack.pop();
    tip().kids.push(node);
    stack.push(node);
  }
  function checkLoose() {
    if (!blankIn) return;
    // A blank line makes a list loose when the next block is added to an
    // item that contains the blank line: the item the block is added to,
    // or an ancestor of the item the blank line was seen in.
    for (let j = stack.length - 1; j >= 1; j--) {
      if (stack[j].t === 'item') {
        const idxB = stack.indexOf(blankIn.item);
        if (idxB >= 0 && j <= idxB && stack[j - 1].t === 'list') {
          stack[j - 1].tight = false;
          blankIn = null;
        }
        return;
      }
    }
  }
  function markBlank() {
    for (let j = stack.length - 1; j >= 1; j--) {
      if (stack[j].t === 'item') {
        blankIn = { list: stack[j - 1], item: stack[j] };
        return;
      }
    }
  }
  function htmlText(node, topLevel) {
    // An HTML block's text is its lines joined by newlines. A trailing
    // newline is added when the block is followed by another block on the
    // next line, or when it reaches the end of the source (which ended with
    // a newline); a block cut off by a blank line has no trailing newline.
    // A block nested inside a container never gets a trailing newline.
    let text = node.lines.join('\n');
    if (!topLevel) return text;
    if (node.endKind !== 'blank') {
      const next = node.endLine + 1;
      const trail = next >= lines.length ? endsWithNl : !isBlankLine(lines[next]);
      if (trail) text += '\n';
    }
    return text;
  }
  function finishPara(node) {
    const used = consumeDefs(node.lines, refs);
    const rest = node.lines.slice(used);
    if (rest.length === 0) {
      node.dead = true;
      return;
    }
    if (rest.length >= 2) {
      // The delimiter row may be indented by at most three columns.
      const aligns = indentCols(rest[1], 0, 0) <= 3 ? parseDelimRow(rest[1]) : null;
      if (aligns) {
        const header = splitTableRow(rest[0]);
        const ncols = aligns.length;
        const pad = (cells) => {
          const out = cells.slice(0, ncols);
          while (out.length < ncols) out.push('');
          return out;
        };
        node.t = 'table';
        node.header = pad(header);
        node.aligns = aligns;
        node.rows = rest.slice(2).map((r) => pad(splitTableRow(r)));
        delete node.lines;
        return;
      }
    }
    node.text = rest.join('\n');
    delete node.lines;
  }
  function finishCode(node) {
    const lines2 = node.lines;
    while (lines2.length > 0 && isBlankLine(lines2[lines2.length - 1])) lines2.pop();
    node.text = lines2.length ? lines2.join('\n') + '\n' : '';
    delete node.lines;
  }
  function closeBlock() {
    const node = stack.pop();
    if (node.t === 'para') {
      finishPara(node);
      if (node.dead) {
        const parent = tip();
        if (parent.kids[parent.kids.length - 1] === node) parent.kids.pop();
      }
    } else if (node.t === 'code' || node.t === 'fence' || node.t === 'html') {
      if (node.t === 'code') finishCode(node);
      else if (node.t === 'fence') {
        // A trailing newline is added unless the last content line is
        // empty (then the join already ends with one).
        const ls = node.lines;
        node.text = ls.length ? ls.join('\n') + (ls[ls.length - 1] === '' ? '' : '\n') : '';
      } else node.text = htmlText(node, tip() === root);
      delete node.lines;
    }
    return node;
  }
  function closeTo(depth) {
    while (stack.length > depth) closeBlock();
  }
  function closeParaIfOpen() {
    if (tip().t === 'para') closeBlock();
  }

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const blank = isBlankLine(raw);
    // Phase 1: match open containers (blockquote / list item).
    let off = 0;
    let col = 0;
    let linePrefix = '';
    let failAt = -1;
    for (let j = 1; j < stack.length; j++) {
      const node = stack[j];
      if (node.t === 'list') continue;
      if (node.t !== 'quote' && node.t !== 'item') break;
      if (blank) {
        // A blank line has no container marker: it closes a block quote
        // (and whatever is inside it) but not a list item.
        if (node.t === 'quote') {
          failAt = j;
          break;
        }
        continue;
      }
      if (node.t === 'quote') {
        const restQ = linePrefix + raw.slice(off);
        const lwQ = leadWs(restQ, col);
        if (lwQ.cols > 3 || lwQ.idx >= restQ.length || restQ[lwQ.idx] !== '>') {
          failAt = j;
          break;
        }
        let restIdx = lwQ.idx + 1;
        let extra = '';
        let advCols = 1;
        if (restQ[restIdx] === ' ') {
          restIdx++;
          advCols++;
        } else if (restQ[restIdx] === '\t') {
          const w = 4 - ((col + lwQ.cols + 1) % 4);
          if (w > 1) extra = ' '.repeat(w - 1);
          restIdx++;
          advCols++;
        }
        if (restIdx >= linePrefix.length) {
          off = off + restIdx - linePrefix.length;
          linePrefix = extra;
        } else {
          linePrefix = extra + linePrefix.slice(restIdx);
        }
        col = col + lwQ.cols + advCols;
      } else {
        if (node.noContent) {
          // This item is empty and a blank line followed it: it cannot
          // take content, so the line does not belong to it.
          failAt = j;
          break;
        }
        const restI = linePrefix + raw.slice(off);
        const lwI = leadWs(restI, col);
        if (lwI.cols < node.indent) {
          failAt = j;
          break;
        }
        const st = stripCols(restI, 0, node.indent, col);
        const extra = ' '.repeat(st.extra);
        if (st.idx >= linePrefix.length) {
          off = off + st.idx - linePrefix.length;
          linePrefix = extra;
        } else {
          linePrefix = extra + linePrefix.slice(st.idx);
        }
        col = col + node.indent;
      }
    }
    if (failAt >= 0) {
      if (tip().t === 'para' && !blank) {
        const rest0 = linePrefix + raw.slice(off);
        const lw0 = leadWs(rest0, col - linePrefix.length);
        const body0 = rest0.slice(lw0.idx);
        if (body0.trim() === '') {
          // Nothing is left on this line after the container markers: it
          // is an empty line inside the containers, ending the paragraph.
          closeBlock();
          markBlank();
          continue;
        }
        const lst0 = matchList(body0, lw0.cols, col + lw0.cols);
        const encList = (() => {
          for (let j = stack.length - 1; j >= 1; j--) {
            if (stack[j].t === 'list') return stack[j];
            if (stack[j].t !== 'item' && stack[j].t !== 'para') return null;
          }
          return null;
        })();
        // A list marker that continues the current list is a new item,
        // not a setext underline: it interrupts the paragraph. It must
        // sit at indent at most 3, or it cannot be a list item at all.
        const continuesList = !!(
          lst0 &&
          encList &&
          lw0.cols <= 3 &&
          sameList(encList, lst0)
        );
        // A lazy line that looks like a setext underline does not turn the
        // paragraph into a heading: it joins the paragraph indented by four
        // spaces, so it stays paragraph text.
        if (!continuesList && lw0.cols <= 3 && /^(=+|-+)[ \t]*$/.test(body0) && !isHr(body0)) {
          tip().lines.push('    ' + body0);
          if (blankIn) blankIn = null;
          continue;
        }
        // A lazy line that starts a block which can interrupt a paragraph
        // (heading, fence, HTML block, thematic break, list) is not a lazy
        // continuation: the containers close and the line starts the block.
        // A list marker that continues the current list interrupts even
        // when it is empty or starts with a number other than 1.
        let interrupts = continuesList;
        if (!interrupts && lw0.cols <= 3) {
          if (
            matchATX(body0) ||
            matchFence(body0) ||
            matchHtmlStart(body0, true) ||
            isHr(body0)
          ) {
            interrupts = true;
          } else if (lst0) {
            const inItem = encList !== null;
            if (
              !lst0.empty &&
              (!lst0.ordered || lst0.start === 1 || inItem)
            ) {
              interrupts = true;
            }
          }
        }
        if (!interrupts) {
          // A lazy continuation line loses its leading whitespace.
          tip().lines.push(body0);
          if (blankIn) blankIn = null;
          continue;
        }
      }
      closeTo(failAt);
    }
    if (blank) {
      // A blank line after an empty list item means the item cannot take
      // content afterwards (the list itself stays open: a following list
      // marker of the same kind still continues it).
      if (tip().t === 'item' && tip().kids.length === 0) tip().noContent = true;
      const t = tip();
      if (t.t === 'para') {
        closeBlock();
        markBlank();
      } else if (t.t === 'code' || t.t === 'fence') {
        // A blank line inside a code block keeps its whitespace minus the
        // block's indent: four columns for indented code, the opening
        // fence's indent for fenced code.
        const restB = linePrefix + raw.slice(off);
        const n = t.t === 'code' ? 4 : t.indent;
        const stB = stripCols(restB, 0, n, col);
        t.lines.push(' '.repeat(stB.extra) + restB.slice(stB.idx));
      } else if (t.t === 'html') {
        if (t.htmlType >= 6) {
          t.endKind = 'blank';
          closeBlock();
        } else {
          t.endLine = li;
          t.lines.push(linePrefix + raw.slice(off));
        }
      } else {
        markBlank();
      }
      continue;
    }
    // Phase 2: open new blocks.
    while (true) {
      const t = tip();
      const rest = linePrefix + raw.slice(off);
      const lw = leadWs(rest, col);
      const ind = lw.cols;
      const body = rest.slice(lw.idx);
      if (t.t === 'fence') {
        if (ind <= 3 && isClosingFence(body, t)) {
          closeBlock();
          break;
        }
        // Fenced code lines are dedented by the opening fence's indent.
        const st = stripCols(rest, 0, t.indent, col);
        t.lines.push(' '.repeat(st.extra) + rest.slice(st.idx));
        break;
      }
      if (t.t === 'code') {
        if (rest.trim() === '') {
          // A whitespace-only line is a blank line inside the code block.
          t.lines.push('');
          break;
        }
        if (ind >= 4) {
          const st = stripCols(rest, 0, 4, col);
          t.lines.push(' '.repeat(st.extra) + rest.slice(st.idx));
          break;
        }
        closeBlock();
        continue;
      }
      if (t.t === 'html') {
        let done = htmlLineEnds(t, rest);
        t.endLine = li;
        t.lines.push(rest);
        if (done) {
          t.endKind = 'marker';
          closeBlock();
        }
        break;
      }
      if (rest === '') {
        // Nothing left on this line after the container markers: it is an
        // empty line inside the containers (for example a lone '>' line).
        // It ends an open paragraph and separates blocks.
        if (t.t === 'para') {
          closeBlock();
          markBlank();
        } else if (t.t === 'item' && t.kids.length === 0) {
          // An empty item with no content: nothing to do.
        } else {
          markBlank();
        }
        break;
      }
      if (rest.trim() === '') {
        // Only spaces are left: they belong to an open paragraph as a line
        // of spaces, otherwise the line is ignored.
        if (t.t === 'para') t.lines.push(rest);
        break;
      }
      if (ind <= 3 && body[0] === '>') {
        // Block quote marker: '>' plus one optional column of space (a tab
        // contributes one column here; its remainder stays as spaces).
        closeParaIfOpen();
        const node = { t: 'quote', kids: [] };
        addNode(node);
        stack.push(node);
        let restIdx = lw.idx + 1;
        let extra = '';
        let advCols = 1;
        if (rest[restIdx] === ' ') {
          restIdx++;
          advCols++;
        } else if (rest[restIdx] === '\t') {
          const w = 4 - ((col + ind + 1) % 4);
          if (w > 1) extra = ' '.repeat(w - 1);
          restIdx++;
          advCols++;
        }
        if (restIdx >= linePrefix.length) {
          off = off + restIdx - linePrefix.length;
          linePrefix = extra;
        } else {
          linePrefix = extra + linePrefix.slice(restIdx);
        }
        col = col + ind + advCols;
        continue;
      }
      if (t.t === 'para' && ind <= 3 && /^(=+|-+)[ \t]*$/.test(body)) {
        const level = body[0] === '=' ? 1 : 2;
        // Link reference definitions at the start of the paragraph are
        // consumed first: they are not part of the heading text, and if
        // nothing is left the underline is not a setext marker at all.
        const used = consumeDefs(t.lines, refs);
        const rest = t.lines.slice(used);
        if (rest.length === 0) {
          t.lines = [];
          closeBlock();
          continue;
        }
        t.t = 'head';
        t.level = level;
        t.text = rest.join('\n').trim();
        delete t.lines;
        closeBlock();
        break;
      }
      // A list marker needs an indent of at most three columns.
      const lst = matchList(body, ind, col + ind);
      const continuesList = !!(lst && tip().t === 'list' && sameList(tip(), lst));
      if (ind <= 3) {
        const atx = matchATX(body);
        if (atx) {
          closeParaIfOpen();
          addNode({ t: 'head', level: atx.level, text: atx.text });
          break;
        }
        const fence = matchFence(body);
        if (fence) {
          closeParaIfOpen();
          openNode({ t: 'fence', ch: fence.ch, len: fence.len, info: fence.info, indent: ind, lines: [] });
          break;
        }
        const hb = matchHtmlStart(body, tip().t === 'para');
        if (hb) {
          closeParaIfOpen();
          const node = { t: 'html', htmlType: hb.type, end: hb.end, lines: [rest], endLine: li, endKind: 'open' };
          if (htmlLineEnds(node, rest)) {
            node.endKind = 'marker';
            node.text = htmlText(node, tip() === root);
            delete node.lines;
            addNode(node);
          } else openNode(node);
          break;
        }
        if (isHr(body)) {
          closeParaIfOpen();
          addNode({ t: 'hr' });
          break;
        }
      }
      if (lst && ind <= 3) {
        // A list marker interrupts a paragraph when the item is not empty
        // and (for ordered lists) it starts with 1, the paragraph is
        // inside a list item, or it continues the current list.
        const paraInItem = (() => {
          for (let j = stack.length - 1; j >= 1; j--) {
            if (stack[j].t === 'item') return true;
            if (stack[j].t !== 'para') return false;
          }
          return false;
        })();
        const canInterrupt =
          tip().t !== 'para' ||
          continuesList ||
          (!lst.empty && (!lst.ordered || lst.start === 1 || paraInItem));
        if (canInterrupt) {
            closeParaIfOpen();
            // Open (or reuse) the list, then its item.
            let listNode;
            if (tip().t === 'list' && sameList(tip(), lst)) {
              listNode = tip();
            } else {
              listNode = {
                t: 'list',
                ordered: lst.ordered,
                bullet: lst.bullet,
                delim: lst.delim,
                start: lst.start,
                tight: true,
                kids: [],
              };
              addNode(listNode);
              stack.push(listNode);
            }
            if (blankIn && blankIn.list === listNode) {
              listNode.tight = false;
              blankIn = null;
            }
            const item = { t: 'item', indent: lst.contentIndent, kids: [], task: null };
            listNode.kids.push(item);
            stack.push(item);
            // Advance past the marker to the item content. restIdx is an
            // index into rest (the current line content string).
            let restIdx = lw.idx + lst.contentIdx;
            let content = rest.slice(restIdx);
            let taskCols = 0;
            const tm = content.match(/^\[([ xX])\]([ \t]|$)/);
            if (tm) {
              item.task = tm[1] === ' ' ? ' ' : 'x';
              taskCols = tm[0].length;
              restIdx += tm[0].length;
              content = rest.slice(restIdx);
            }
            if (restIdx >= linePrefix.length) {
              off = off + restIdx - linePrefix.length;
              linePrefix = ' '.repeat(lst.tabRemainder || 0);
            } else {
              linePrefix = linePrefix.slice(restIdx);
            }
            col = col + lst.contentIndent + taskCols;
            continue;
          }
        }
      if (ind >= 4 && tip().t !== 'para') {
        const st = stripCols(rest, 0, 4, col);
        const content = ' '.repeat(st.extra) + rest.slice(st.idx);
        if (tip().t === 'code') {
          tip().lines.push(content);
        } else {
          closeParaIfOpen();
          openNode({ t: 'code', lines: [content] });
        }
        break;
      }
      // Default: paragraph.
      if (tip().t !== 'para') {
        openNode({ t: 'para', lines: [] });
      }
      tip().lines.push(rest);
      break;
    }
    if (blankIn) blankIn = null;
  }
  closeTo(1);
  return { root, refs };
}


// ------------------------------------------------------------- inline parse
const DISALLOWED_TAGS = new Set([
  'title', 'textarea', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'script', 'plaintext',
]);

function isWsCh(ch) {
  return (
    ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f' ||
    (ch.charCodeAt(0) > 127 && /\s/.test(ch))
  );
}

// Find the index of the ']' matching the '[' at s[i]. Returns -1.
function findLinkEnd(s, i) {
  const n = s.length;
  let depth = 0;
  let j = i;
  while (j < n) {
    const c = s[j];
    if (c === '\\' && j + 1 < n) {
      j += 2;
      continue;
    }
    if (c === '`') {
      let k = j;
      while (k < n && s[k] === '`') k++;
      const len = k - j;
      let m = k;
      let found = false;
      while (m < n) {
        if (s[m] === '`') {
          let e = m;
          while (e < n && s[e] === '`') e++;
          if (e - m === len) {
            found = true;
            j = e;
            break;
          }
          m = e;
        } else {
          m++;
        }
      }
      if (!found) return -1;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

// Parse an inline link "(...)" starting at s[after] === '('. Returns
// {dest, title, next} or null.
function tryInlineLink(s, after) {
  let pos = skipWs(s, after + 1);
  let dest = '';
  let title = null;
  const ch = s[pos];
  if (ch === '"' || ch === "'" || ch === '(') {
    const t = parseLinkTitle(s, pos);
    if (!t) return null;
    title = t.title;
    pos = t.next;
  } else {
    const destRes = parseLinkDest(s, pos);
    if (!destRes) return null;
    dest = destRes.dest;
    pos = destRes.next;
    const save = pos;
    pos = skipWs(s, pos);
    if (pos < s.length && s[pos] === ')') return { dest, title: null, next: pos + 1 };
    if (pos < s.length && (s[pos] === '"' || s[pos] === "'" || s[pos] === '(')) {
      const t = parseLinkTitle(s, pos);
      if (!t) return null;
      title = t.title;
      pos = t.next;
    } else {
      return null;
    }
  }
  pos = skipWs(s, pos);
  if (pos >= s.length || s[pos] !== ')') return null;
  return { dest, title, next: pos + 1 };
}

// Remove backslash escapes before ASCII punctuation.
function unescapePunct(s) {
  if (!s.includes('\\')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && isAsciiPunct(s.charCodeAt(i + 1))) {
      out += s[i + 1];
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

// Parse one inline HTML construct starting at s[i] === '<'.
// Returns {token, next} or null.
function parseInlineHtml(s, i) {
  const n = s.length;
  if (s.startsWith('<!--', i)) {
    if (s.startsWith('<!-->', i)) return { token: { t: 'html', s: '<!-->' }, next: i + 5 };
    if (s.startsWith('<!--->', i)) return { token: { t: 'html', s: '<!--->' }, next: i + 6 };
    const end = s.indexOf('-->', i + 4);
    if (end < 0) return null;
    const content = s.slice(i + 4, end);
    if (content.includes('--') || content.endsWith('-')) return null;
    return { token: { t: 'html', s: s.slice(i, end + 3) }, next: end + 3 };
  }
  if (s.startsWith('<?', i)) {
    const end = s.indexOf('?>', i + 2);
    if (end < 0) return null;
    return { token: { t: 'html', s: s.slice(i, end + 2) }, next: end + 2 };
  }
  if (s.startsWith('<![CDATA[', i)) {
    const end = s.indexOf(']]>', i + 9);
    if (end < 0) return null;
    return { token: { t: 'html', s: s.slice(i, end + 3) }, next: end + 3 };
  }
  if (s.startsWith('<!', i) && i + 2 < n && /[A-Za-z]/.test(s[i + 2])) {
    const end = s.indexOf('>', i + 2);
    if (end < 0) return null;
    return { token: { t: 'html', s: s.slice(i, end + 1) }, next: end + 1 };
  }
  // Open or closing tag.
  let j = i + 1;
  let closing = false;
  if (s[j] === '/') {
    closing = true;
    j++;
  }
  if (j >= n || !/[A-Za-z]/.test(s[j])) return null;
  const nameStart = j;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  const name = s.slice(nameStart, j).toLowerCase();
  while (true) {
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (j >= n) return null;
    if (s[j] === '>') {
      j++;
      break;
    }
    if (s[j] === '/' && s[j + 1] === '>') {
      j += 2;
      break;
    }
    if (closing) return null;
    // Attribute name.
    if (!/[A-Za-z_:]/.test(s[j])) return null;
    while (j < n && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (s[j] === '=') {
      j++;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j];
        j++;
        while (j < n && s[j] !== q) j++;
        if (j >= n) return null;
        j++;
      } else {
        if (j >= n || /[\s"'=<>`]/.test(s[j])) return null;
        while (j < n && !/[\s"'=<>`]/.test(s[j])) j++;
      }
    }
  }
  const raw = s.slice(i, j);
  if (DISALLOWED_TAGS.has(name)) return { token: { t: 'htmlEsc', s: raw }, next: j };
  return { token: { t: 'html', s: raw }, next: j };
}

// Trim trailing punctuation off a GFM extended autolink candidate.
function trimAutolink(url) {
  let end = url.length;
  // A trailing entity reference is not part of the link.
  if (end > 0 && url[end - 1] === ';') {
    const amp = url.lastIndexOf('&', end - 1);
    if (amp >= 0) {
      const body = url.slice(amp + 1, end - 1);
      if (/^#[0-9]+$/.test(body) || /^#[xX][0-9a-fA-F]+$/.test(body) || /^[A-Za-z][A-Za-z0-9_]*$/.test(body)) {
        end = amp;
      }
    }
  }
  const PUNCT = '?!.,:;*_~\'"';
  let changed = true;
  while (changed) {
    changed = false;
    while (end > 0 && PUNCT.includes(url[end - 1])) {
      end--;
      changed = true;
    }
    while (end > 0 && url[end - 1] === ')') {
      let open = 0;
      let close = 0;
      for (let k = 0; k < end; k++) {
        if (url[k] === '(') open++;
        else if (url[k] === ')') close++;
      }
      if (close > open) {
        end--;
        changed = true;
      } else {
        break;
      }
    }
  }
  return url.slice(0, end);
}

// Validate the domain part of a GFM extended autolink candidate.
// Returns the domain string or null.
function validAutolinkDomain(url, start) {
  let end = start;
  while (end < url.length && !['/', '?', '#'].includes(url[end])) end++;
  const domain = url.slice(start, end);
  if (!domain.includes('.')) return null;
  const labels = domain.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return null;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return null;
    if (label.startsWith('-') || label.endsWith('-')) return null;
  }
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,}$/.test(tld)) return null;
  return domain;
}

// Resolve emphasis / strikethrough delimiters in a token array.
// Returns the list of matches {open, close, use, kind}.
function resolveEmphasis(toks) {
  const delims = [];
  for (let idx = 0; idx < toks.length; idx++) {
    if (toks[idx].t === 'delim') delims.push(idx);
  }
  const openers = [];
  const bottom = new Map();
  const matches = [];
  for (let di = 0; di < delims.length; di++) {
    const idx = delims[di];
    const d = toks[idx];
    if (d.canClose && d.len > 0 && !(d.ch === '~' && d.len < 2)) {
      while (d.len > 0) {
        const floor = bottom.get(d.ch) || 0;
        let oi = -1;
        for (let k = openers.length - 1; k >= 0; k--) {
          const oIdx = openers[k];
          const oDelimPos = delims.indexOf(oIdx);
          if (oDelimPos < floor) break;
          const o = toks[oIdx];
          if (o.ch !== d.ch) continue;
          if (d.ch === '~' && o.len < 2) continue;
          // An opener inside an emphasis that was already created cannot
          // be used by a closer outside that emphasis: the match would
          // cross the existing emphasis boundary.
          let inside = false;
          for (const m of matches) {
            if (m.open < oIdx && oIdx < m.close) {
              inside = true;
              break;
            }
          }
          if (inside) continue;
          if ((o.canOpen && o.canClose) || (d.canOpen && d.canClose)) {
            const sum = o.len + d.len;
            if (sum % 3 === 0 && !(o.len % 3 === 0 && d.len % 3 === 0)) continue;
          }
          oi = k;
          break;
        }
        if (oi < 0) {
          // No opener found. Only move the floor when this delimiter
          // cannot open itself: if it can open it joins the opener stack
          // below, and a later closer may still match an earlier opener.
          if (!d.canOpen) bottom.set(d.ch, di + 1);
          break;
        }
        const oIdx = openers[oi];
        const o = toks[oIdx];
        if (d.ch === '~' && (o.len < 2 || d.len < 2)) {
          bottom.set(d.ch, di + 1);
          break;
        }
        const use = o.len >= 2 && d.len >= 2 ? 2 : 1;
        const kind = d.ch === '~' ? 'del' : use === 2 ? 'strong' : 'em';
        matches.push({ open: oIdx, close: idx, use, kind });
        o.len -= use;
        d.len -= use;
        if (o.len === 0) openers.splice(oi, 1);
      }
    }
    if (d.canOpen && d.len > 0) openers.push(idx);
  }
  return matches;
}

// Tokenize one inline string. Returns {toks, matches}.
function tokenize(s, refs, opts) {
  opts = opts || {};
  const n = s.length;
  const toks = [];
  let i = 0;
  let txtStart = 0;
  let lineCol = 0;
  const flush = (end) => {
    if (end > txtStart) toks.push({ t: 'txt', s: s.slice(txtStart, end) });
  };
  const advance = (to) => {
    while (i < to) {
      const ch = s[i];
      if (ch === '\n') lineCol = 0;
      else if (ch === '\t') lineCol += 4 - (lineCol % 4);
      else lineCol++;
      i++;
    }
  };
  while (i < n) {
    const c = s[i];
    // GFM extended autolinks: www. and scheme://
    if (c === 'w' && s.startsWith('www.', i)) {
      const prev = i === 0 ? '' : s[i - 1];
      if (i === 0 || isWsCh(prev) || '*_~('.includes(prev)) {
        let j = i;
        while (j < n && !isWsCh(s[j]) && s[j] !== '<') j++;
        const cand = trimAutolink(s.slice(i, j));
        if (cand.length > 4 && validAutolinkDomain(cand, 4)) {
          flush(i);
          toks.push({
            t: 'link',
            href: 'http://' + cand,
            title: null,
            kids: { toks: [{ t: 'txt', s: cand }], matches: [] },
          });
          advance(i + cand.length);
          txtStart = i;
          continue;
        }
      }
    }
    if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z') {
      const schemeAt = s.indexOf('://', i);
      if (schemeAt > i + 1 && schemeAt - i <= 32) {
        const prev = i === 0 ? '' : s[i - 1];
        if (i === 0 || isWsCh(prev) || '*_~('.includes(prev)) {
          const scheme = s.slice(i, schemeAt);
          if (/^[a-zA-Z][a-zA-Z0-9+.-]{1,31}$/.test(scheme)) {
            let j = schemeAt + 3;
            while (j < n && !isWsCh(s[j]) && s[j] !== '<') j++;
            const cand = trimAutolink(s.slice(i, j));
            if (cand.length > schemeAt + 3 - i && validAutolinkDomain(cand, schemeAt + 3 - i)) {
              flush(i);
              toks.push({
                t: 'link',
                href: cand,
                title: null,
                kids: { toks: [{ t: 'txt', s: cand }], matches: [] },
              });
              advance(i + cand.length);
              txtStart = i;
              continue;
            }
          }
        }
      }
    }
    if (c === '@') {
      // GFM email autolink: scan back for the local part.
      const LOCAL = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?^_`{|}~-";
      let start = i;
      while (start > txtStart && LOCAL.includes(s[start - 1])) start--;
      const prev = start === 0 ? '' : s[start - 1];
      if (start === 0 || isWsCh(prev) || '*_~('.includes(prev)) {
        const m = s.slice(start).match(
          /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/
        );
        if (m && m[0].length > i - start + 1) {
          const addr = m[0];
          flush(start);
          toks.push({
            t: 'link',
            href: 'mailto:' + addr,
            title: null,
            kids: { toks: [{ t: 'txt', s: addr }], matches: [] },
          });
          advance(start + addr.length);
          txtStart = i;
          continue;
        }
      }
    }
    if (c === '\\') {
      const nx = s[i + 1];
      if (nx === '\n') {
        flush(i);
        toks.push({ t: 'br' });
        advance(i + 2);
        txtStart = i;
        continue;
      }
      if (nx !== undefined && isAsciiPunct(nx.charCodeAt(0))) {
        flush(i);
        toks.push({ t: 'txt', s: nx });
        advance(i + 2);
        txtStart = i;
        continue;
      }
      advance(i + 1);
      continue;
    }
    if (c === '`') {
      let k = i;
      while (k < n && s[k] === '`') k++;
      const len = k - i;
      let j = k;
      let found = -1;
      while (j < n) {
        if (s[j] === '`') {
          let m = j;
          while (m < n && s[m] === '`') m++;
          if (m - j === len) {
            found = j;
            break;
          }
          j = m;
        } else {
          j++;
        }
      }
      if (found < 0) {
        advance(k);
        continue;
      }
      let content = s.slice(k, found).replace(/\n/g, ' ');
      if (
        content.length >= 2 &&
        content[0] === ' ' &&
        content[content.length - 1] === ' ' &&
        /[^ ]/.test(content)
      ) {
        content = content.slice(1, -1);
      }
      flush(i);
      toks.push({ t: 'code', s: content });
      advance(found + len);
      txtStart = i;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let k = i;
      while (k < n && s[k] === c) k++;
      const len = k - i;
      if (c === '~' && len < 2) {
        advance(k);
        continue;
      }
      const prev = i > 0 ? s[i - 1] : '';
      const next = k < n ? s[k] : '';
      const prevSpace = i === 0 || isWsCh(prev);
      const nextSpace = k >= n || isWsCh(next);
      const prevPunct = i > 0 && isPunctCh(prev);
      const nextPunct = k < n && isPunctCh(next);
      const leftFlank = !nextSpace && (!nextPunct || prevSpace || prevPunct);
      const rightFlank = !prevSpace && (!prevPunct || nextSpace || nextPunct);
      let canOpen;
      let canClose;
      if (c === '_') {
        canOpen = leftFlank && (!rightFlank || prevPunct);
        canClose = rightFlank && (!leftFlank || nextPunct);
      } else {
        canOpen = leftFlank;
        canClose = rightFlank;
      }
      flush(i);
      toks.push({ t: 'delim', ch: c, len, origLen: len, canOpen, canClose });
      advance(k);
      txtStart = i;
      continue;
    }
    if (c === ' ' || c === '\t') {
      // Hard break: two or more spaces (in columns) before a newline.
      let j = i;
      let col = lineCol;
      while (j < n && (s[j] === ' ' || s[j] === '\t')) {
        col += s[j] === '\t' ? 4 - (col % 4) : 1;
        j++;
      }
      if (j < n && s[j] === '\n' && col - lineCol >= 2) {
        flush(i);
        toks.push({ t: 'br' });
        advance(j + 1);
        txtStart = i;
        continue;
      }
      advance(i + 1);
      continue;
    }
    if ((c === '[' && !opts.noLinks) || (c === '!' && s[i + 1] === '[')) {
      const isImage = c === '!';
      const openIdx = isImage ? i + 1 : i;
      const closeIdx = findLinkEnd(s, openIdx);
      if (closeIdx < 0) {
        advance(i + 1);
        continue;
      }
      const linkText = s.slice(openIdx + 1, closeIdx);
      if (!isImage && linkText.length === 0) {
        advance(i + 1);
        continue;
      }
      const after = closeIdx + 1;
      let dest = null;
      let title = null;
      let next = -1;
      if (s[after] === '(') {
        const r = tryInlineLink(s, after);
        if (!r) {
          advance(i + 1);
          continue;
        }
        dest = r.dest;
        title = r.title;
        next = r.next;
      } else if (s[after] === '[') {
        let j = after + 1;
        let label = '';
        let ok = false;
        while (j < n) {
          if (s[j] === '\\' && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) {
            label += s[j + 1];
            j += 2;
            continue;
          }
          if (s[j] === ']') {
            ok = true;
            break;
          }
          if (s[j] === '[') break;
          label += s[j];
          j++;
        }
        if (!ok) {
          advance(i + 1);
          continue;
        }
        const key =
          label.length === 0
            ? normalizeLabel(unescapePunct(linkText))
            : normalizeLabel(label);
        const def = refs.get(key);
        if (!def) {
          advance(i + 1);
          continue;
        }
        dest = def.dest;
        title = def.title;
        next = j + 1;
      } else {
        const def = refs.get(normalizeLabel(unescapePunct(linkText)));
        if (!def) {
          advance(i + 1);
          continue;
        }
        dest = def.dest;
        title = def.title;
        next = after;
      }
      flush(i);
      if (isImage) {
        const alt = flattenAlt(linkText, refs);
        toks.push({ t: 'img', src: dest, title, alt });
      } else {
        const kids = tokenize(linkText, refs, { noLinks: true });
        toks.push({ t: 'link', href: dest, title, kids });
      }
      advance(next);
      txtStart = i;
      continue;
    }
    if (c === '<') {
      const am = s.slice(i).match(/^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/);
      if (am) {
        const url = am[1];
        flush(i);
        toks.push({
          t: 'link',
          href: url,
          title: null,
          kids: { toks: [{ t: 'txt', s: url }], matches: [] },
        });
        advance(i + am[0].length);
        txtStart = i;
        continue;
      }
      const em = s.slice(i).match(
        /^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/
      );
      if (em) {
        const addr = em[1];
        flush(i);
        toks.push({
          t: 'link',
          href: 'mailto:' + addr,
          title: null,
          kids: { toks: [{ t: 'txt', s: addr }], matches: [] },
        });
        advance(i + em[0].length);
        txtStart = i;
        continue;
      }
      const h = parseInlineHtml(s, i);
      if (h) {
        flush(i);
        toks.push(h.token);
        advance(h.next);
        txtStart = i;
        continue;
      }
      advance(i + 1);
      continue;
    }
    if (c === '&') {
      const ent = parseEntity(s, i);
      if (ent) {
        flush(i);
        toks.push({ t: 'ent', s: ent.ch });
        advance(ent.next);
        txtStart = i;
        continue;
      }
      advance(i + 1);
      continue;
    }
    advance(i + 1);
  }
  flush(n);
  const matches = resolveEmphasis(toks);
  return { toks, matches };
}

// Flatten inline tokens to plain text (for image alt attributes).
function flattenTokens(toks, matches) {
  const usedOpen = new Map();
  const usedClose = new Map();
  for (const m of matches) {
    usedOpen.set(m.open, (usedOpen.get(m.open) || 0) + m.use);
    usedClose.set(m.close, (usedClose.get(m.close) || 0) + m.use);
  }
  let out = '';
  for (let idx = 0; idx < toks.length; idx++) {
    const tk = toks[idx];
    if (tk.t === 'txt' || tk.t === 'ent' || tk.t === 'code') out += tk.s;
    else if (tk.t === 'delim') {
      const leftover = tk.origLen - (usedOpen.get(idx) || 0) - (usedClose.get(idx) || 0);
      if (leftover > 0) out += tk.ch.repeat(leftover);
    } else if (tk.t === 'link') out += flattenTokens(tk.kids.toks, tk.kids.matches);
    else if (tk.t === 'img') out += tk.alt;
    else if (tk.t === 'br') out += '\n';
  }
  return out;
}

function flattenAlt(text, refs) {
  const parsed = tokenize(text, refs, { noLinks: true });
  return flattenTokens(parsed.toks, parsed.matches);
}


// ------------------------------------------------------------------ render
// Render one inline token array (with its emphasis matches) to HTML.
function renderTokens(toks, matches) {
  const openMap = new Map();
  const closeMap = new Map();
  const usedOpen = new Map();
  const usedClose = new Map();
  for (const m of matches) {
    if (!openMap.has(m.open)) openMap.set(m.open, []);
    openMap.get(m.open).push(m);
    if (!closeMap.has(m.close)) closeMap.set(m.close, []);
    closeMap.get(m.close).push(m);
    usedOpen.set(m.open, (usedOpen.get(m.open) || 0) + m.use);
    usedClose.set(m.close, (usedClose.get(m.close) || 0) + m.use);
  }
  // An emphasis delimiter run used for both strong and emphasis nests
  // the emphasis outside the strong.
  for (const arr of openMap.values()) {
    arr.sort((a, b) => b.close - a.close || (a.kind === 'em' ? -1 : b.kind === 'em' ? 1 : 0));
  }
  const openTag = (kind) => (kind === 'em' ? '<em>' : kind === 'strong' ? '<strong>' : '<del>');
  const closeTag = (kind) => (kind === 'em' ? '</em>' : kind === 'strong' ? '</strong>' : '</del>');
  let out = '';
  const frames = [];
  for (let idx = 0; idx < toks.length; idx++) {
    const tk = toks[idx];
    if (tk.t === 'delim') {
      const closes = closeMap.get(idx);
      const opens = openMap.get(idx);
      const leftover = tk.origLen - (usedOpen.get(idx) || 0) - (usedClose.get(idx) || 0);
      if (closes) {
        const sorted = closes.slice().sort((a, b) => b.open - a.open);
        for (const m of sorted) {
          while (frames.length > 0) {
            const f = frames.pop();
            out += closeTag(f.kind);
            if (f.match === m) break;
          }
        }
        if (leftover > 0) out += tk.ch.repeat(leftover);
      } else if (!opens && leftover > 0) {
        out += tk.ch.repeat(leftover);
      }
      if (opens) {
        if (!closes && leftover > 0) out += tk.ch.repeat(leftover);
        for (const m of opens) {
          out += openTag(m.kind);
          frames.push({ match: m, kind: m.kind });
        }
      }
      continue;
    }
    if (tk.t === 'txt' || tk.t === 'ent') out += escText(tk.s);
    else if (tk.t === 'code') out += '<code>' + escCode(tk.s) + '</code>';
    else if (tk.t === 'br') out += '<br>';
    else if (tk.t === 'html') out += tk.s;
    else if (tk.t === 'htmlEsc') out += escText(tk.s);
    else if (tk.t === 'link') {
      out += '<a href="' + encodeHref(tk.href) + '"';
      if (tk.title !== null && tk.title !== undefined) {
        out += ' title="' + escAttrKeepEnt(tk.title) + '"';
      }
      out += '>' + renderTokens(tk.kids.toks, tk.kids.matches) + '</a>';
    } else if (tk.t === 'img') {
      out += '<img src="' + encodeHref(tk.src) + '" alt="' + escAttrKeepEnt(tk.alt) + '"';
      if (tk.title !== null && tk.title !== undefined) {
        out += ' title="' + escAttrKeepEnt(tk.title) + '"';
      }
      out += '>';
    }
  }
  while (frames.length > 0) out += closeTag(frames.pop().kind);
  return out;
}

function inlineToHtml(text, refs) {
  if (!text) return '';
  const parsed = tokenize(text, refs, {});
  return renderTokens(parsed.toks, parsed.matches);
}

// Render one block node (recursively) to HTML.
function renderBlock(node, refs, out) {
  switch (node.t) {
    case 'doc':
      for (const kid of node.kids) renderBlock(kid, refs, out);
      break;
    case 'para': {
      let html = inlineToHtml(node.text, refs);
      if (node.task) {
        const input =
          node.task === 'x'
            ? '<input checked="" disabled="" type="checkbox"> '
            : '<input disabled="" type="checkbox"> ';
        html = input + html;
      }
      out.push('<p>' + html + '</p>\n');
      break;
    }
    case 'head':
      out.push('<h' + node.level + '>' + inlineToHtml(node.text, refs) + '</h' + node.level + '>\n');
      break;
    case 'code':
      out.push('<pre><code>' + escCode(node.text) + '</code></pre>\n');
      break;
    case 'fence': {
      let cls = '';
      if (node.info) {
        const first = unescapePunct(node.info.split(/\s+/)[0]);
        if (first) cls = ' class="language-' + escAttrKeepEnt(first) + '"';
      }
      out.push('<pre><code' + cls + '>' + escCode(node.text) + '</code></pre>\n');
      break;
    }
    case 'html':
      out.push(node.text);
      break;
    case 'hr':
      out.push('<hr>\n');
      break;
    case 'quote':
      out.push('<blockquote>\n');
      for (const kid of node.kids) renderBlock(kid, refs, out);
      out.push('</blockquote>\n');
      break;
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      const startAttr = node.ordered && node.start !== 1 ? ' start="' + node.start + '"' : '';
      out.push('<' + tag + startAttr + '>\n');
      for (const item of node.kids) renderItem(item, node, refs, out);
      out.push('</' + tag + '>\n');
      break;
    }
    default:
      break;
  }
}

function renderItem(item, list, refs, out) {
  // A task marker is rendered at the start of the item's first paragraph;
  // if the item has no paragraph at all, it stands alone.
  let firstPara = null;
  for (const kid of item.kids) {
    if (kid.t === 'para') {
      firstPara = kid;
      break;
    }
  }
  if (item.task && firstPara) firstPara.task = item.task;
  out.push('<li>');
  if (item.kids.length === 0) {
    if (item.task) {
      out.push(
        item.task === 'x'
          ? '<input checked="" disabled="" type="checkbox">'
          : '<input disabled="" type="checkbox">'
      );
    }
    out.push('</li>\n');
    return;
  }
  if (list.tight) {
    // Tight list: paragraphs render without <p> wrappers.
    for (const kid of item.kids) {
      if (kid.t === 'para') {
        let html = inlineToHtml(kid.text, refs);
        if (kid.task) {
          html =
            (kid.task === 'x'
              ? '<input checked="" disabled="" type="checkbox"> '
              : '<input disabled="" type="checkbox"> ') + html;
        }
        out.push(html);
      } else if (kid.t === 'table') {
        renderTable(kid, refs, out);
      } else {
        renderBlock(kid, refs, out);
      }
    }
  } else {
    for (const kid of item.kids) {
      if (kid.t === 'table') renderTable(kid, refs, out);
      else renderBlock(kid, refs, out);
    }
  }
  out.push('</li>\n');
}

function renderTable(node, refs, out) {
  out.push('<table>\n<thead>\n<tr>\n');
  for (let c = 0; c < node.header.length; c++) {
    const a = node.aligns[c];
    out.push(
      '<th' + (a ? ' align="' + a + '"' : '') + '>' + inlineToHtml(node.header[c], refs) + '</th>\n'
    );
  }
  out.push('</tr>\n</thead>\n<tbody>');
  for (const row of node.rows) {
    out.push('<tr>\n');
    for (let c = 0; c < row.length; c++) {
      const a = node.aligns[c];
      out.push(
        '<td' + (a ? ' align="' + a + '"' : '') + '>' + inlineToHtml(row[c], refs) + '</td>\n'
      );
    }
    out.push('</tr>\n');
  }
  out.push('</tbody></table>\n');
}

// --------------------------------------------------------------------- entry
export function parse(markdown) {
  const src = String(markdown).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  // A trailing newline ends the last line; it does not create an extra
  // (blank) line after it.
  const endsWithNl = src.endsWith('\n');
  if (endsWithNl) lines.pop();
  const { root, refs } = parseBlocks(lines, endsWithNl);
  const out = [];
  for (const kid of root.kids) {
    if (kid.t === 'table') renderTable(kid, refs, out);
    else renderBlock(kid, refs, out);
  }
  return out.join('');
}
