// Round 16 full rewrite (witnessed session): a from-scratch CommonMark
// 0.31.2 + GFM renderer byte-identical to marked 18.1.3 (default options).
// No dependencies. Written from the round-15 logic as reference, with
// marked-faithful fixes: char-based fenced-code dedent (Dt), whole-run
// blockquote marker whitespace expansion, HTML-block trailing newline
// decided from the following line and siblings, and a final
// unterminated whitespace-only line kept as paragraph content.

// ---------------------------------------------------------------- entities
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
// CommonMark's "Unicode punctuation character": ASCII punctuation or
// anything in the Unicode P (punctuation) or S (symbol) categories.
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
// entity reference (&name;), matching marked's escape behaviour.
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

// Attribute value where a valid named entity reference is left alone.
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

// Link href: like encodeURI, except a literal % is left alone (so an
// existing %20 or a bare 98% survives instead of becoming %25).
function encodeHref(s) {
  try {
    return encodeURI(s).replace(/%25/g, '%');
  } catch (_e) {
    // Lone surrogate in the string: encode char by char.
    let out = '';
    for (const c of s) {
      if (c === '%') {
        out += '%';
      } else {
        try {
          out += encodeURIComponent(c);
        } catch (_e2) {
          out += c;
        }
      }
    }
    return out.replace(/%25/g, '%');
  }
}

// Href attribute value: encodeURI first, then escape a bare & to &amp;
// unless it starts a valid entity reference (&name; / &#...; / &#x...;).
function escHref(s) {
  const enc = encodeHref(s);
  if (!enc.includes('&')) return enc;
  let out = '';
  for (let i = 0; i < enc.length; i++) {
    const c = enc[i];
    if (c !== '&') {
      out += c;
      continue;
    }
    const semi = enc.indexOf(';', i + 1);
    let keep = false;
    if (semi > 0 && semi - i <= 32) {
      const body = enc.slice(i + 1, semi);
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(body)) keep = true;
      else if (/^#[0-9]+$/.test(body) || /^#[xX][0-9a-fA-F]+$/.test(body)) keep = true;
    }
    out += keep ? '&' : '&amp;';
  }
  return out;
}

// Decode one NUMERIC entity reference starting at s[i] === '&'. Named
// entities are not decoded (marked passes &name; through verbatim).
// Returns {ch, next} or null when there is no valid numeric entity here.
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
// Unicode case folding for link labels: JS toLowerCase leaves ß and
// ligatures unfolded, but CommonMark folds them (ß/ẞ -> ss, ﬀ -> ff, ...).
const FOLD_MAP = {
  'ß': 'ss',
  'ẞ': 'ss',
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st',
};
function normalizeLabel(label) {
  return label
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[ßẞﬀﬁﬂﬃﬄﬅﬆ]/g, (ch) => FOLD_MAP[ch]);
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

// Expand a run of spaces/tabs starting at visual column startCol into
// spaces (marked's J(): a tab jumps to the next multiple of 4).
function expandWsRun(run, startCol) {
  let col = startCol || 0;
  let out = '';
  for (let k = 0; k < run.length; k++) {
    if (run[k] === '\t') {
      const w = 4 - (col % 4);
      out += ' '.repeat(w);
      col += w;
    } else {
      out += ' ';
      col++;
    }
  }
  return out;
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
  const labelEnd = findLinkEnd(s, pos, true);
  if (labelEnd < 0) return null;
  const rawLabel = s.slice(pos + 1, labelEnd);
  if (rawLabel.includes('\n\n') || rawLabel.length > 999) return null;
  // Link labels are matched WITHOUT processing backslash escapes: the raw
  // label (with backslashes) is the key.
  const label = normalizeLabel(rawLabel);
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
      // An escaped pipe is a literal pipe in the cell (the backslash is
      // consumed here, before inline parsing, so a code span sees "|").
      cur += '|';
      k++;
      continue;
    }
    if (c === '\\' && k + 1 < s.length && s[k + 1] === '\\') {
      // An escaped backslash: keep both, so a following "|" is a real
      // separator instead of looking like an escaped pipe.
      cur += s[k];
      cur += s[k + 1];
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
    // An attribute must be preceded by whitespace (see scanTagEnd).
    let hadWs = false;
    while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) {
      j++;
      hadWs = true;
    }
    if (j >= s.length) return -1;
    if (s[j] === '>') return j + 1;
    if (s[j] === '/' && s[j + 1] === '>') return j + 2;
    if (closing) return -1;
    if (!hadWs) return -1;
    if (!/[A-Za-z_:]/.test(s[j])) return -1;
    while (j < s.length && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
    // Whitespace before '=' is consumed here; whitespace before the next
    // attribute is left alone so that attribute's hadWs check still sees it.
    let k = j;
    while (k < s.length && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
    if (s[k] === '=') {
      j = k + 1;
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

// ------------------------------------------------------------------ fences
// marked's Dt(): fenced-code content is dedented by CHARACTER count, not
// columns, and only for backtick fences (indentCodeCompensation matches
// ``` only): strip min(leading-whitespace chars of the line, chars of the
// fence line's indent) from the front of the line. A tab at the boundary
// is kept literally, never expanded to spaces.
function dedentCodeLine(rest, indentStr) {
  if (!indentStr) return rest;
  let n = 0;
  while (n < rest.length && (rest[n] === ' ' || rest[n] === '\t')) n++;
  const strip = Math.min(n, indentStr.length);
  return rest.slice(strip);
}

// Count the leading whitespace characters of a string.
function leadWsCount(s) {
  let n = 0;
  while (n < s.length && (s[n] === ' ' || s[n] === '\t')) n++;
  return n;
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
    // A blank line loosens the list that contains the insertion point:
    // the parent list of the innermost item still open. A list whose item
    // was already closed (a dangling list on the stack, or a list closed
    // before this block) does not contain the insertion point, so a
    // trailing blank after a list loosens nothing.
    for (let j = stack.length - 1; j >= 1; j--) {
      if (stack[j].t === 'item' && stack[j - 1].t === 'list') {
        if (blankIn.lists.includes(stack[j - 1])) stack[j - 1].tight = false;
        break;
      }
    }
    blankIn = null;
  }
  function markBlank() {
    // Record every list still open: the block after the blank loosens the
    // innermost recorded one that still contains the insertion point.
    blankIn = { lists: stack.filter((n) => n.t === 'list') };
  }
  // Is the line still inside every block quote between the list item at
  // stack index itemIdx and the open fenced code block? The line is given
  // as restI (starting at visual column startCol); the item indent is
  // stripped best-effort first. Used to decide whether a fence absorbs a
  // line that is not indented far enough for its list item.
  function lineMatchesQuotes(itemIdx, restI, startCol, indent) {
    let k = 0;
    let c = startCol;
    const target = startCol + indent;
    while (k < restI.length && c < target && (restI[k] === ' ' || restI[k] === '\t')) {
      c += restI[k] === '\t' ? 4 - (c % 4) : 1;
      k++;
    }
    let extra = 0;
    if (c > target) {
      extra = c - target;
      c = target;
    }
    let cur = ' '.repeat(extra) + restI.slice(k);
    let curCol = c;
    for (let q = itemIdx + 1; q < stack.length; q++) {
      const nq = stack[q];
      if (nq.t === 'list') continue;
      if (nq.t !== 'quote') return true;
      const lw = leadWs(cur, curCol);
      if (lw.cols > 3 || lw.idx >= cur.length || cur[lw.idx] !== '>') return false;
      let r = lw.idx + 1;
      let adv = 1;
      let ex = '';
      if (cur[r] === ' ') {
        r++;
        adv++;
      } else if (cur[r] === '\t') {
        const w = 4 - ((curCol + lw.cols + 1) % 4);
        if (w > 1) ex = ' '.repeat(w - 1);
        r++;
        adv++;
      }
      cur = ex + cur.slice(r);
      curCol = curCol + lw.cols + adv;
    }
    return true;
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
      const header = splitTableRow(rest[0]);
      // A table needs the delimiter row to have exactly as many cells as
      // the header row.
      if (aligns && aligns.length === header.length) {
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
      } else {
        // HTML block text is its lines joined; the trailing newline is
        // decided later by fixHtmlTrail (it depends on the following line
        // and on siblings, which are only known once the tree is built).
        node.text = node.lines.join('\n');
      }
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
        // The whitespace run after '>' is expanded as a whole (marked's
        // J()), then one space is stripped: a tab after '>' leaves
        // (tabWidth - 1) spaces, and a run like ' \t' expands then loses
        // its first space.
        const qw = quoteWsAfter(restQ, lwQ.idx, col + lwQ.cols);
        const restIdx = qw.nextIdx;
        if (restIdx >= linePrefix.length) {
          off = off + restIdx - linePrefix.length;
          linePrefix = qw.extra;
        } else {
          linePrefix = qw.extra + linePrefix.slice(restIdx);
        }
        col = col + lwQ.cols + qw.adv;
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
          // An open fenced code block absorbs the line even when it is
          // not indented far enough for the item — but only while the
          // line is still inside every block quote between this item and
          // the fence. A line without the quote marker closes the quote
          // (and the fence with it).
          if (tip().t === 'fence' && lineMatchesQuotes(j, restI, col, node.indent)) break;
          failAt = j;
          break;
        }
        const st = stripCols(restI, 0, node.indent, col);
        // A tab in the leading whitespace after the item indent expands
        // to spaces from its original column (marked expands tabs when it
        // extracts list item text): e.g. "  \tfoo" in an item of indent 2
        // becomes "  foo", which a char-based fence dedent then sees as
        // spaces instead of a literal tab.
        let endIdx = st.idx;
        let extra = ' '.repeat(st.extra);
        {
          let e = endIdx;
          while (e < restI.length && (restI[e] === ' ' || restI[e] === '\t')) e++;
          const run = restI.slice(endIdx, e);
          if (run.includes('\t')) {
            extra = extra + expandWsRun(run, col + node.indent + st.extra);
            endIdx = e;
          }
        }
        if (endIdx >= linePrefix.length) {
          off = off + endIdx - linePrefix.length;
          linePrefix = extra;
        } else {
          linePrefix = extra + linePrefix.slice(endIdx);
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
            // A block quote between the paragraph and its enclosing list
            // does not own the list: a lazy marker may continue the list
            // outside the quote (the quote itself closes).
            if (stack[j].t !== 'item' && stack[j].t !== 'para' && stack[j].t !== 'quote') return null;
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
          // A lazy continuation line still loses the failed container's
          // indent: a failed list item removes its whole indent (the
          // line had less indent than the item, so all its leading
          // whitespace goes), and a failed block quote removes 4 columns
          // when the line has at least 4 (fewer stay untouched).
          const failed = stack[failAt];
          let strip = 0;
          if (failed.t === 'item') strip = Math.min(lw0.cols, failed.indent);
          else if (failed.t === 'quote') strip = lw0.cols >= 4 ? 4 : 0;
          const st0 = stripCols(rest0, 0, strip, col - linePrefix.length);
          tip().lines.push(' '.repeat(st0.extra) + rest0.slice(st0.idx));
          if (blankIn) blankIn = null;
          continue;
        }
      }
      closeTo(failAt);
    }
    if (blank) {
      // A final whitespace-only line with no trailing newline is NOT a
      // blank line in marked: it is paragraph content at top level, and
      // content of a type 6/7 HTML block. (Everywhere else it stays blank.)
      if (li === lines.length - 1 && !endsWithNl && raw !== '') {
        const t = tip();
        if (t.t === 'para' && stack.length === 2) {
          t.lines.push(linePrefix + raw.slice(off));
          blankIn = null;
          continue;
        }
        if (t.t === 'html' && t.htmlType >= 6) {
          t.endLine = li;
          t.lines.push(linePrefix + raw.slice(off));
          blankIn = null;
          continue;
        }
      }
      // A blank line after an empty list item means the item cannot take
      // content afterwards (the list itself stays open: a following list
      // marker of the same kind still continues it).
      if (tip().t === 'item' && tip().kids.length === 0) tip().noContent = true;
      const t = tip();
      if (t.t === 'para') {
        // A tab-only line inside a table paragraph is a table row (empty
        // cells), not a blank line: marked keeps the table open and the
        // next line becomes another row. A spaces-only line, or a tab line
        // in a non-table paragraph, is a real blank line.
        let tableRow = false;
        if (raw.includes('\t') && t.lines.length >= 2) {
          const aligns = parseDelimRow(t.lines[1]);
          tableRow = !!aligns && aligns.length === splitTableRow(t.lines[0]).length;
        }
        if (tableRow) {
          t.lines.push(linePrefix + raw.slice(off));
          continue;
        }
        closeBlock();
        markBlank();
      } else if (t.t === 'code' || t.t === 'fence') {
        // A blank line inside a code block keeps its whitespace minus the
        // block's indent: four columns for indented code, the opening
        // fence's indent for fenced code.
        const restB = linePrefix + raw.slice(off);
        const n = t.t === 'code' ? 4 : t.indent;
        if (t.t === 'fence') t.lines.push(dedentCodeLine(restB, t.indentStr));
        else {
          const stB = stripCols(restB, 0, n, col);
          t.lines.push(' '.repeat(stB.extra) + restB.slice(stB.idx));
        }
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

// The whitespace run after a '>' marker: marked expands the whole run
// (spaces and tabs, tabs to the next multiple of 4 starting at the column
// just after the marker) and then strips one space. Returns the index just
// past the run, the remainder spaces to keep, and the columns the marker
// plus the stripped space consume (1, or 2 when a run was present).
function quoteWsAfter(s, gtIdx, gtCol) {
  let k = gtIdx + 1;
  let end = k;
  while (end < s.length && (s[end] === ' ' || s[end] === '\t')) end++;
  if (end === k) return { nextIdx: k, extra: '', adv: 1 };
  const expanded = expandWsRun(s.slice(k, end), gtCol + 1);
  return { nextIdx: end, extra: expanded.length > 0 ? expanded.slice(1) : '', adv: 2 };
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
        // Fenced code lines are dedented by the opening fence's indent
        // (character-based, backtick fences only; see dedentCodeLine).
        t.lines.push(dedentCodeLine(rest, t.indentStr));
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
        // of spaces, otherwise the line is ignored. A leading tab expands
        // to spaces up to the next tab stop (lw.cols is already the
        // expanded width).
        if (t.t === 'para') t.lines.push(' '.repeat(lw.cols) + body);
        break;
      }
      if (ind <= 3 && body[0] === '>') {
        // Block quote marker: '>' plus the whitespace run after it,
        // expanded as a whole with one space stripped (see quoteWsAfter).
        closeParaIfOpen();
        const node = { t: 'quote', kids: [] };
        addNode(node);
        stack.push(node);
        const qw = quoteWsAfter(rest, lw.idx, col + ind);
        const restIdx = qw.nextIdx;
        if (restIdx >= linePrefix.length) {
          off = off + restIdx - linePrefix.length;
          linePrefix = qw.extra;
        } else {
          linePrefix = qw.extra + linePrefix.slice(restIdx);
        }
        col = col + ind + qw.adv;
        continue;
      }
      if (t.t === 'para' && ind <= 3 && /^(=+|-+)[ \t]*$/.test(body)) {
        const level = body[0] === '=' ? 1 : 2;
        // Link reference definitions at the start of the paragraph are
        // consumed first: they are not part of the heading text, and if
        // nothing is left the underline is not a setext marker at all.
        const used = consumeDefs(t.lines, refs);
        const rest2 = t.lines.slice(used);
        if (rest2.length === 0) {
          t.lines = [];
          closeBlock();
          continue;
        }
        t.t = 'head';
        t.level = level;
        t.text = rest2.join('\n').trim();
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
          // The fence's indent string is the leading whitespace of this
          // line (backtick fences dedent content by it; tilde fences do
          // not dedent at all, so their indent string is empty).
          openNode({
            t: 'fence',
            ch: fence.ch,
            len: fence.len,
            info: fence.info,
            indent: ind,
            indentStr: fence.ch === '`' ? rest.slice(0, lw.idx) : '',
            lines: [],
          });
          break;
        }
        const hb = matchHtmlStart(body, tip().t === 'para');
        if (hb) {
          closeParaIfOpen();
          const node = { t: 'html', htmlType: hb.type, end: hb.end, lines: [rest], endLine: li, endKind: 'open' };
          if (htmlLineEnds(node, rest)) {
            node.endKind = 'marker';
            node.text = node.lines.join('\n');
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
            if (blankIn && blankIn.lists.includes(listNode)) {
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
      // Default: paragraph. A leading tab expands to spaces up to the
      // next tab stop (lw.cols is already the expanded width); leading
      // spaces on continuation lines are kept.
      if (tip().t !== 'para') {
        openNode({ t: 'para', lines: [] });
      }
      tip().lines.push(' '.repeat(lw.cols) + body);
      break;
    }
    if (blankIn) blankIn = null;
  }
  closeTo(1);
  return { root, refs };
}


// ------------------------------------------------------------- inline parse
function isWsCh(ch) {
  return (
    ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f' ||
    (ch.charCodeAt(0) > 127 && /\s/.test(ch))
  );
}

// Scan an HTML tag starting at s[i] === '<'. Returns the index just after
// the tag, -1 when it is not a tag, or -2 when the tag is unterminated (a
// valid tag start that runs off the end of the string, e.g. an unclosed
// quote: a ']' after it is inside the tag and does not close link text).
function scanTagEnd(s, i) {
  const n = s.length;
  let j = i + 1;
  let closing = false;
  if (s[j] === '/') {
    closing = true;
    j++;
  }
  if (j >= n || !/[A-Za-z]/.test(s[j])) return -1;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  while (true) {
    // An attribute must be preceded by whitespace: a name starting right
    // after the tag name or a quoted value is not a valid tag.
    let hadWs = false;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) {
      j++;
      hadWs = true;
    }
    if (j >= n) return -2;
    if (s[j] === '>') return j + 1;
    if (s[j] === '/' && s[j + 1] === '>') return j + 2;
    if (closing) return -1;
    if (!hadWs) return -1;
    if (!/[A-Za-z_:]/.test(s[j])) return -1;
    while (j < n && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
    // Whitespace before '=' is consumed here; whitespace before the next
    // attribute is left alone so that attribute's hadWs check still sees it.
    let k = j;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
    if (s[k] === '=') {
      j = k + 1;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
      if (s[j] === '"' || s[j] === "'") {
        const q = s[j];
        j++;
        while (j < n && s[j] !== q) j++;
        if (j >= n) return -2;
        j++;
      } else {
        if (j >= n || /[\s"'=<>`]/.test(s[j])) return -1;
        while (j < n && !/[\s"'=<>`]/.test(s[j])) j++;
      }
    }
  }
}

// Find the index of the ']' matching the '[' at s[i]. Returns -1.
// With noNest, an unescaped '[' inside fails the match: link reference
// definition labels may not contain one (marked rejects such definitions).
function findLinkEnd(s, i, noNest) {
  const n = s.length;
  let j = i + 1;
  if (noNest) {
    while (j < n) {
      const c = s[j];
      if (c === '\\' && j + 1 < n) {
        j += 2;
        continue;
      }
      if (c === '[') return -1;
      if (c === ']') return j;
      if (c === '\n') {
        // A newline inside a def label is allowed only when it is not
        // followed by a blank line.
        let k = j + 1;
        while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
        if (k >= n || s[k] === '\n') return -1;
      }
      j++;
    }
    return -1;
  }
  while (j < n) {
    const c = s[j];
    if (c === '\\' && j + 1 < n) {
      j += 2;
      continue;
    }
    if (c === '\\') return -1; // trailing lone backslash ends the label
    if (c === '[') {
      const end = matchNestedGroup(s, j);
      if (end < 0) return -1;
      j = end;
      continue;
    }
    if (c === '`') {
      let k = j;
      while (k < n && s[k] === '`') k++;
      const len = k - j;
      // Code span: consume through the NEXT backtick run (any length).
      let m = k;
      let found = -1;
      while (m < n) {
        if (s[m] === '`') {
          let e = m;
          while (e < n && s[e] === '`') e++;
          found = e;
          break;
        }
        m++;
      }
      if (found > 0) {
        j = found;
        continue;
      }
      // No closing run: a 2+ backtick run right before ']' is still
      // consumed (``+(?=\])); anything else ends the label match.
      if (len >= 2 && s[k] === ']') {
        j = k;
        continue;
      }
      return -1;
    }
    if (c === ']') return j;
    j++;
  }
  return -1;
}

// Match a nested bracket group starting at s[j] === '[': '[' (Le | escape
// | any char except []\)*? ']' (lazy: the first ']' not inside a Le group
// or escape ends it). Returns the index just past the closing ']' or -1.
function matchNestedGroup(s, j) {
  const n = s.length;
  let p = j + 1;
  while (p < n) {
    const c = s[p];
    if (c === ']') return p + 1;
    if (c === '\\' && p + 1 < n) {
      p += 2;
      continue;
    }
    if (c === '\\') return -1;
    if (c === '[') {
      const le = matchLeGroup(s, p);
      if (le < 0) return -1;
      p = le;
      continue;
    }
    p++;
  }
  return -1;
}

// Match Le: '[' (escape | any char except []\)* ']' — no brackets inside.
function matchLeGroup(s, j) {
  const n = s.length;
  let p = j + 1;
  while (p < n) {
    const c = s[p];
    if (c === ']') return p + 1;
    if (c === '\\' && p + 1 < n) {
      p += 2;
      continue;
    }
    if (c === '\\' || c === '[') return -1;
    p++;
  }
  return -1;
}

// marked's Be(): a <...> tag or autolink that starts inside the link text
// but extends beyond the end of the link text rejects the link. `s` is the
// full inline string, `linkText` the raw text between the brackets, and
// `textStart` the index of the link text in `s`. Backslash escapes are
// skipped and code spans (equal-length runs, like the inline code rule)
// are skipped whole. An unterminated <!-- matches to the end of the string.
function linkTextTagOverflow(s, linkText, textStart) {
  if (!linkText.includes('<')) return false;
  const n = linkText.length;
  for (let p = 0; p < n; p++) {
    const ch = linkText[p];
    if (ch === '\\') {
      p++;
      continue;
    }
    if (ch === '`') {
      let k = p;
      while (k < n && linkText[k] === '`') k++;
      const len = k - p;
      let m = k;
      let found = -1;
      while (m < n) {
        if (linkText[m] === '`') {
          let e = m;
          while (e < n && linkText[e] === '`') e++;
          if (e - m === len) {
            found = e;
            break;
          }
          m = e;
        } else {
          m++;
        }
      }
      if (found > 0) {
        p = found - 1;
        continue;
      }
      continue;
    }
    if (ch !== '<') continue;
    const pos = textStart + p;
    let mlen = 0;
    if (s.startsWith('<!--', pos)) {
      const end = s.indexOf('-->', pos + 4);
      mlen = end < 0 ? s.length - pos : end + 3 - pos;
    } else {
      const h = parseInlineHtml(s, pos);
      if (h) {
        mlen = h.next - pos;
      } else {
        const am = s.slice(pos).match(/^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/);
        if (am) {
          mlen = am[0].length;
        } else {
          const em = s.slice(pos).match(
            /^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/
          );
          if (em) mlen = em[0].length;
        }
      }
    }
    if (mlen > 0) {
      if (mlen > n - p) return true;
      p += mlen - 1;
    }
  }
  return false;
}

// Parse an inline link "(...)" starting at s[after] === '('. Returns
// {dest, title, next} or null. The destination is always parsed first: a
// bare destination may start with a quote or paren character, so a leading
// " or ' or ( is part of the destination, not a title (cm-504).
function tryInlineLink(s, after) {
  let pos = skipWs(s, after + 1);
  const destRes = parseLinkDest(s, pos);
  if (!destRes) return null;
  const dest = destRes.dest;
  pos = destRes.next;
  pos = skipWs(s, pos);
  if (pos < s.length && s[pos] === ')') return { dest, title: null, next: pos + 1 };
  if (pos < s.length && (s[pos] === '"' || s[pos] === "'" || s[pos] === '(')) {
    const t = parseLinkTitle(s, pos);
    if (!t) return null;
    const title = t.title;
    pos = skipWs(s, t.next);
    if (pos >= s.length || s[pos] !== ')') return null;
    return { dest, title, next: pos + 1 };
  }
  return null;
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
    // marked ends a comment at the first --> whatever the content holds
    // (even when it contains --).
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
    // An attribute must be preceded by whitespace (see scanTagEnd).
    let hadWs = false;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) {
      j++;
      hadWs = true;
    }
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
    if (!hadWs) return null;
    // Attribute name.
    if (!/[A-Za-z_:]/.test(s[j])) return null;
    while (j < n && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
    // Whitespace before '=' is consumed here; whitespace before the next
    // attribute is left alone so that attribute's hadWs check still sees it.
    let k = j;
    while (k < n && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n')) k++;
    if (s[k] === '=') {
      j = k + 1;
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
  // marked renders every tag raw, including the GFM "disallowed" ones
  // (title, style, xmp, ...): no escaping, despite the GFM spec text.
  return { token: { t: 'html', s: s.slice(i, j) }, next: j };
}

// marked's _backpedal, applied repeatedly until stable (the url rule):
// the longest prefix built from non-punctuation runs, balanced (...) groups,
// a bare & (not starting an entity), and punctuation runs that do not reach
// the end of the string. It trims trailing punctuation, drops a trailing
// '(' with no matching ')', and cuts the candidate at any unmatched '('.
const BACKPEDAL_RE =
  /(?:[^?!.,:;*_'\"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'\"~)]+(?!$))+/;
function trimAutolink(url) {
  let prev;
  do {
    prev = url;
    url = BACKPEDAL_RE.exec(url)?.[0] ?? '';
  } while (prev !== url);
  return url;
}

// Match the longest valid domain starting at `start` of a GFM extended
// autolink candidate: labels of alphanumerics with internal hyphens
// (max 63 chars), separated by dots, ending in a 2+ letter TLD. The
// remainder of the candidate is the path, which may start with any
// non-space character — including a backslash (www.foo.com\ links the
// backslash as part of the URL) or a hyphen. Returns the domain or null.
const AUTOLINK_DOMAIN_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}/;
function validAutolinkDomain(url, start) {
  const m = url.slice(start).match(AUTOLINK_DOMAIN_RE);
  return m ? m[0] : null;
}


// ------------------------------------------------------- emphasis resolver
// CommonMark's delimiter-stack algorithm (flank-based): for each closer,
// find the closest earlier unmatched opener of the same character
// (skipping openers trapped inside an already-created emphasis and pairs
// forbidden by the rule of 3), consume 2 delimiters when both runs have
// at least 2 left (strong) else 1 (em), and repeat while the closer still
// has run left. The matches are then applied to the token stream: a run's
// leftover delimiters stay literal text, an opener emits its wrappers
// after the leftovers (outermost first), a closer emits its wrappers
// before the leftovers (innermost first).
function resolveEmphasis(tokens) {
  const delims = [];
  for (let idx = 0; idx < tokens.length; idx++) {
    if (tokens[idx].t === 'delim') delims.push(idx);
  }
  const openers = [];
  const bottom = new Map();
  const matches = [];
  for (let di = 0; di < delims.length; di++) {
    const idx = delims[di];
    const d = tokens[idx];
    if (d.close && d.len > 0) {
      while (d.len > 0) {
        const floor = bottom.get(d.ch) || 0;
        let oi = -1;
        for (let k = openers.length - 1; k >= 0; k--) {
          const oIdx = openers[k];
          const oDelimPos = delims.indexOf(oIdx);
          if (oDelimPos < floor) break;
          const o = tokens[oIdx];
          if (o.ch !== d.ch) continue;
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
          if ((o.open && o.close) || (d.open && d.close)) {
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
          if (!d.open) bottom.set(d.ch, di + 1);
          break;
        }
        const oIdx = openers[oi];
        const o = tokens[oIdx];
        const use = o.len >= 2 && d.len >= 2 ? 2 : 1;
        const kind = d.ch === '~' ? 'del' : use === 2 ? 'strong' : 'em';
        matches.push({ open: oIdx, close: idx, use, kind });
        o.len -= use;
        d.len -= use;
        if (o.len === 0) openers.splice(oi, 1);
      }
    }
    if (d.open && d.len > 0) openers.push(idx);
  }
  // Apply the matches to the token stream.
  const opens = new Map();
  const closes = new Map();
  for (const m of matches) {
    if (!opens.has(m.open)) opens.set(m.open, []);
    opens.get(m.open).push(m);
    if (!closes.has(m.close)) closes.set(m.close, []);
    closes.get(m.close).push(m);
  }
  const out = [];
  const stack = [];
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t !== 'delim') {
      out.push(tk);
      continue;
    }
    const om = opens.get(k) || [];
    const cm = closes.get(k) || [];
    let used = 0;
    for (const m of om) used += m.use;
    for (const m of cm) used += m.use;
    const leftover = tk.origLen - used;
    // Closers first (innermost first, i.e. match order), then leftover
    // literal delimiters, then openers (outermost first, i.e. reverse
    // match order).
    for (const m of cm) {
      for (let sIdx = stack.length - 1; sIdx >= 0; sIdx--) {
        if (stack[sIdx].ch === tk.ch) {
          const marker = stack.splice(sIdx, 1)[0];
          out.push({ t: 'emEnd', kind: marker.kind, ch: tk.ch });
          break;
        }
      }
    }
    if (leftover > 0) out.push({ t: 'text', s: tk.ch.repeat(leftover) });
    for (let mIdx = om.length - 1; mIdx >= 0; mIdx--) {
      const m = om[mIdx];
      const marker = { t: 'emStart', kind: m.kind, ch: tk.ch };
      out.push(marker);
      stack.push(marker);
    }
  }
  return out;
}
// ------------------------------------------------------------ inline lexer
// Tokenize inline text (plain string with \n for line breaks, no entities
// decoded yet). st holds parser state across calls (currently in a link).
function tokenize(s, refs, st) {
  const n = s.length;
  const tokens = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) {
      tokens.push({ t: 'text', s: buf });
      buf = '';
    }
  };
  while (i < n) {
    const c = s[i];
    if (c === '\\') {
      if (i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) {
        // The escaped character is its own text token: an escaped '&'
        // must not merge with the following text into an entity reference
        // (e.g. \&ouml; renders &amp;ouml;, not &ouml;).
        flush();
        tokens.push({ t: 'text', s: s[i + 1] });
        i += 2;
      } else if (i + 1 < n && s[i + 1] === '\n') {
        flush();
        tokens.push({ t: 'br' });
        // A hard break drops the spaces at the start of the next line.
        let k = i + 2;
        while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
        i = k;
      } else {
        buf += c;
        i++;
      }
      continue;
    }
    if (c === '`') {
      let k = i;
      while (k < n && s[k] === '`') k++;
      const len = k - i;
      let m = k;
      let found = -1;
      while (m < n) {
        if (s[m] === '`') {
          let e = m;
          while (e < n && s[e] === '`') e++;
          if (e - m === len) {
            found = m;
            break;
          }
          m = e;
        } else {
          m++;
        }
      }
      if (found < 0) {
        buf += s.slice(i, k);
        i = k;
        continue;
      }
      let content = s.slice(k, found);
      // Newlines become spaces first; then, if the content starts and
      // ends with a space and contains a non-space, strip one space from
      // each end (so ``\nfoo\n`` renders as `foo`, not ` foo `).
      content = content.replace(/\n/g, ' ');
      if (
        content.length >= 2 &&
        content.startsWith(' ') &&
        content.endsWith(' ') &&
        content.trim() !== ''
      ) {
        content = content.slice(1, -1);
      }
      flush();
      tokens.push({ t: 'code', s: content });
      i = found + len;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      const ch = c;
      let k = i;
      while (k < n && s[k] === ch) k++;
      const len = k - i;
      // Strikethrough: a run of one or two tildes is a delimiter; three
      // or more is literal text (~~~not~~~ does not strike).
      if (ch === '~' && len >= 3) {
        buf += s.slice(i, k);
        i = k;
        continue;
      }
      const before = i > 0 ? s[i - 1] : '';
      const after = k < n ? s[k] : '';
      const beforeWs = before === '' || isWsCh(before);
      const afterWs = after === '' || isWsCh(after);
      // Flanking uses Unicode punctuation (currency signs like £ and €
      // count), not just ASCII punctuation.
      const beforePunct = before !== '' && !beforeWs && isPunctCh(before);
      const afterPunct = after !== '' && !afterWs && isPunctCh(after);
      const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
      const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
      let canOpen, canClose;
      if (ch === '*') {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      } else {
        canOpen = leftFlanking && (!rightFlanking || beforePunct);
        canClose = rightFlanking && (!leftFlanking || afterPunct);
      }
      // len is mutated by resolveEmphasis as pairs consume delimiters;
      // origLen keeps the run's original length for leftover literals.
      flush();
      tokens.push({
        t: 'delim',
        ch,
        pos: i,
        open: canOpen,
        close: canClose,
        len,
        origLen: len,
      });
      i = k;
      continue;
    }
    if (c === '[') {
      // Find the matching ']' for the link text. Links form inside link
      // text too (the outer link is rejected later when its text contains
      // a link); only extended autolinks are suppressed by st.inLink.
      let end = findLinkEnd(s, i, false);
      if (end < 0) {
        // A shortcut reference label uses the `le` grammar (backticks and
        // nested brackets are plain characters), not the `re` grammar used
        // by inline and full reference links. Only a shortcut can match
        // here: an inline '(' or full-ref '[' after the label would have
        // needed the `re` label, which already failed.
        const leEnd = findLinkEnd(s, i, true);
        if (leEnd < 0 || s[leEnd + 1] === '(' || s[leEnd + 1] === '[') {
          buf += c;
          i++;
          continue;
        }
        end = leEnd;
      }
      const linkText = s.slice(i + 1, end);
      const afterIdx = end + 1;
      // Inline link: [text](dest "title").
      if (afterIdx < n && s[afterIdx] === '(') {
        const link = tryInlineLink(s, afterIdx);
        if (link) {
          const altToks = tokenize(linkText, refs, { ...st, inLink: true });
          if (textHasLink(altToks)) {
            buf += c;
            i++;
            continue;
          }
          if (linkTextTagOverflow(s, linkText, i + 1)) {
            buf += c;
            i++;
            continue;
          }
          flush();
          tokens.push({ t: 'link', dest: link.dest, title: link.title, alt: altToks });
          i = link.next;
          continue;
        }
        // The inline link failed (e.g. a space in the destination):
        // fall back to the shortcut reference for the same text, and
        // leave the "(...)" as literal text.
        const def0 = refs.get(normalizeLabel(linkText));
        if (def0) {
          const altToks = tokenize(linkText, refs, { ...st, inLink: true });
          if (!textHasLink(altToks) && !linkTextTagOverflow(s, linkText, i + 1)) {
            flush();
            tokens.push({ t: 'link', dest: def0.dest, title: def0.title, alt: altToks });
            i = afterIdx;
            continue;
          }
        }
      }
      // Reference link: [text][label] or [text][] or [text]. An empty
      // label [] is a collapsed reference: the label is the link text.
      let refLabel = null;
      let refNext = -1;
      if (afterIdx < n && s[afterIdx] === '[') {
        const refEnd = findLinkEnd(s, afterIdx, true);
        if (refEnd >= 0) {
          refLabel = s.slice(afterIdx + 1, refEnd);
          refNext = refEnd + 1;
        }
      } else if (afterIdx >= n || s[afterIdx] !== '(') {
        refLabel = linkText;
        refNext = end + 1;
      }
      if (refLabel !== null) {
        const key = normalizeLabel(refLabel === '' ? linkText : refLabel);
        const def = key ? refs.get(key) : undefined;
        if (def) {
          const altToks = tokenize(linkText, refs, { ...st, inLink: true });
          if (textHasLink(altToks)) {
            buf += c;
            i++;
            continue;
          }
          if (linkTextTagOverflow(s, linkText, i + 1)) {
            buf += c;
            i++;
            continue;
          }
          flush();
          tokens.push({ t: 'link', dest: def.dest, title: def.title, alt: altToks });
          i = refNext;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }
    if (c === '!' && i + 1 < n && s[i + 1] === '[') {
      // Images form inside link text too (unlike links): the outer link
      // is rejected only when its text contains a link, not an image.
      let end = findLinkEnd(s, i + 1, false);
      if (end < 0) {
        const leEnd = findLinkEnd(s, i + 1, true);
        if (leEnd < 0 || s[leEnd + 1] === '(' || s[leEnd + 1] === '[') {
          buf += c;
          i++;
          continue;
        }
        end = leEnd;
      }
      const linkText = s.slice(i + 2, end);
      const afterIdx = end + 1;
      let dest = null;
      let title = null;
      let next = -1;
      if (afterIdx < n && s[afterIdx] === '(') {
        const link = tryInlineLink(s, afterIdx);
        if (link) {
          dest = link.dest;
          title = link.title;
          next = link.next;
        } else {
          // Inline image failed: fall back to the shortcut reference.
          const def0 = refs.get(normalizeLabel(linkText));
          if (def0) {
            dest = def0.dest;
            title = def0.title;
            next = afterIdx;
          }
        }
      } else if (afterIdx < n && s[afterIdx] === '[') {
        const refEnd = findLinkEnd(s, afterIdx, true);
        if (refEnd >= 0) {
          const label = s.slice(afterIdx + 1, refEnd);
          const key = normalizeLabel(label === '' ? linkText : label);
          const def = key ? refs.get(key) : undefined;
          if (def) {
            dest = def.dest;
            title = def.title;
            next = refEnd + 1;
          }
        }
      } else {
        const key = normalizeLabel(linkText);
        const def = key ? refs.get(key) : undefined;
        if (def) {
          dest = def.dest;
          title = def.title;
          next = end + 1;
        }
      }
      if (dest !== null && !linkTextTagOverflow(s, linkText, i + 2)) {
        // The alt text is tokenized (with inLink=true, so extended
        // autolinks are suppressed) and flattened: emphasis and nested
        // links/images in the alt become plain text.
        const altToks = tokenize(linkText, refs, { ...st, inLink: true });
        flush();
        tokens.push({ t: 'img', dest, title, altToks });
        i = next;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (c === '<') {
      // Autolink <scheme:...> or <email>.
      const rest = s.slice(i);
      const am = rest.match(/^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^<>\s]*)>/);
      if (am) {
        flush();
        tokens.push({ t: 'link', dest: am[1], title: null, alt: [{ t: 'text', s: am[1] }] });
        i += am[0].length;
        continue;
      }
      const em = rest.match(
        /^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/
      );
      if (em) {
        flush();
        tokens.push({ t: 'link', dest: 'mailto:' + em[1], title: null, alt: [{ t: 'text', s: em[1] }] });
        i += em[0].length;
        continue;
      }
      const h = parseInlineHtml(s, i);
      if (h) {
        // An opening <a> tag sets inLink (persisting across blocks until
        // </a>): extended autolinks are suppressed while inside it.
        // A self-closing <a ... /> does not open a link.
        if (/^<a[\s>]/.test(h.token.s) && !/\/>$/.test(h.token.s)) st.inLink = true;
        else if (/^<\/a[\s>]/.test(h.token.s)) st.inLink = false;
        flush();
        tokens.push(h.token);
        i = h.next;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (c === '&') {
      // Numeric entities decode to the character (&#42; becomes a literal
      // '*', which is then NOT emphasis); named entities pass through raw.
      const ent = parseEntity(s, i);
      if (ent) {
        flush();
        tokens.push({ t: 'text', s: ent.ch });
        i = ent.next;
        continue;
      }
      const m = s.slice(i).match(/^&([a-zA-Z][a-zA-Z0-9]*);/);
      if (m) {
        flush();
        tokens.push({ t: 'entity', s: m[0] });
        i += m[0].length;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (c === '\n') {
      // Two or more trailing spaces (or a backslash, handled above) make
      // a hard break; a single trailing space makes a soft break. A hard
      // break drops the spaces at the start of the next line.
      if (buf.endsWith('  ')) {
        buf = buf.replace(/ +$/, '');
        flush();
        tokens.push({ t: 'br' });
        let k = i + 1;
        while (k < n && (s[k] === ' ' || s[k] === '\t')) k++;
        i = k;
      } else {
        buf += '\n';
        i++;
      }
      continue;
    }
    // GFM extended autolink: www. or scheme:// — never inside link text
    // (st.inLink), and only at a word boundary (start, whitespace, or one
    // of *_~(< before it).
    const isWww = c === 'w' && s.startsWith('www.', i);
    const isScheme =
      ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) &&
      /^[a-zA-Z][a-zA-Z0-9+.-]{1,31}:\/\//.test(s.slice(i));
    if (!st.inLink && (isWww || isScheme)) {
      const prev = i === 0 ? '' : s[i - 1];
      if (i === 0 || isWsCh(prev) || '*_~(<'.includes(prev)) {
        let j = i;
        while (j < n && !isWsCh(s[j]) && s[j] !== '<') j++;
        let url = s.slice(i, j);
        if (url.startsWith('www.')) {
          const dom = validAutolinkDomain(url, 0);
          if (!dom) {
            buf += c;
            i++;
            continue;
          }
        }
        url = trimAutolink(url);
        if (!url) {
          buf += c;
          i++;
          continue;
        }
        flush();
        // A www. link gets an http:// href; a scheme:// link keeps its
        // URL as the href.
        const href = url.startsWith('www.') ? 'http://' + url : url;
        tokens.push({ t: 'link', auto: true, dest: href, title: null, alt: [{ t: 'text', s: url }] });
        i += url.length;
        continue;
      }
    }
    // GFM email autolink, triggered at a word boundary (the character
    // before must not be part of an email local part). The domain needs
    // at least one dot but no 2-letter TLD (a.b-c_d@a.b links). An
    // optional scheme prefix immediately before the local part
    // (mailto: / xmpp:) is included in the link, with exactly one
    // /segment after the address when a scheme is present.
    if (!st.inLink && (c === '@' || /[A-Za-z0-9]/.test(c))) {
      const LOCAL_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?^_`{|}~-";
      const atWordStart = i === 0 || !LOCAL_CHARS.includes(s[i - 1]);
      if (atWordStart) {
        const m = s.slice(i).match(
          /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/
        );
        if (m) {
          let addr = m[0];
          const afterDomain = s[i + addr.length];
          // marked's email regex ends with the lookahead (?![\w-]): when
          // the char after the domain is '_' or '-', the regex BACKTRACKS
          // the domain (dropping trailing '.label' groups) instead of
          // voiding the link. Exception: a trailing '_' that closes an
          // earlier '_' emphasis opener links the FULL domain.
          if (afterDomain === '_' || afterDomain === '-') {
            let keepFull = false;
            if (afterDomain === '_') {
              let q = i + addr.length;
              while (s[q] === '_') q++;
              const nx = q >= n ? '' : s[q];
              const nextSpace = q >= n || isWsCh(nx);
              const nextPunct = q < n && isPunctCh(nx);
              const leftFlank = !nextSpace && !nextPunct; // prev char is alnum
              if (!leftFlank || nextPunct) {
                for (const tk of tokens) {
                  if (tk.t === 'delim' && tk.ch === '_' && tk.open) {
                    keepFull = true;
                    break;
                  }
                }
              }
            }
            if (!keepFull) {
              const atIdx = addr.indexOf('@');
              while (s[i + addr.length] === '_' || s[i + addr.length] === '-') {
                const dot = addr.lastIndexOf('.');
                // The domain must keep at least one '.label' group: if
                // this is the only dot in the domain, dropping it leaves
                // a dot-less domain and the whole autolink fails.
                if (dot <= atIdx || addr.indexOf('.', atIdx + 1) >= dot) {
                  addr = '';
                  break;
                }
                addr = addr.slice(0, dot);
              }
            }
          }
          if (addr) {
            let linkStart = i;
            let text = addr;
            let href = 'mailto:' + addr;
            if (i >= 1 && s[i - 1] === ':') {
              let p = i - 1;
              while (p > 0 && i - 1 - p < 33 && /[A-Za-z0-9+.-]/.test(s[p - 1])) p--;
              const schemeLen = i - 1 - p;
              const tooLong = p > 0 && /[A-Za-z0-9+.-]/.test(s[p - 1]);
              if (!tooLong && schemeLen >= 3 && schemeLen <= 33 && /[A-Za-z]/.test(s[p])) {
                linkStart = p;
                text = s.slice(p, i) + addr;
                href = text;
                // Path: only with a scheme, exactly one "/segment".
                const afterAddr = i + addr.length;
                if (s[afterAddr] === '/') {
                  let j = afterAddr + 1;
                  while (j < n && !isWsCh(s[j]) && s[j] !== '<' && s[j] !== '/') j++;
                  const seg = trimAutolink(s.slice(afterAddr + 1, j));
                  if (seg.length > 0) {
                    text += '/' + seg;
                    href += '/' + seg;
                  }
                }
              }
            }
            const prev = linkStart === 0 ? '' : s[linkStart - 1];
            if (linkStart === 0 || isWsCh(prev) || '*_~(<'.includes(prev)) {
              // Drop the scheme prefix (and only that) from the current
              // text run: it sits at the end of buf.
              if (linkStart < i) {
                buf = buf.slice(0, buf.length - (i - linkStart));
              }
              flush();
              tokens.push({ t: 'link', auto: true, dest: href, title: null, alt: [{ t: 'text', s: text }] });
              i = linkStart + text.length;
              continue;
            }
          }
        }
      }
      buf += c;
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return resolveEmphasis(tokens);
}

function flattenTokens(tokens) {
  let out = '';
  for (const tk of tokens) {
    if (tk.t === 'text') out += tk.s;
    else if (tk.t === 'code') out += tk.s;
    else if (tk.t === 'link') out += flattenTokens(tk.alt || []);
    else if (tk.t === 'img') out += flattenTokens(tk.altToks || []);
    else if (tk.t === 'del') out += flattenTokens(tk.kids || []);
    else if (tk.t === 'entity') out += tk.s;
    else if (tk.t === 'br') out += '\n';
  }
  return out;
}

function flattenAlt(tokens) {
  return flattenTokens(tokens);
}

function textHasLink(tokens) {
  // A link cannot contain another (non-autolink) link: an image inside
  // link text is fine, and extended autolinks are suppressed in link text.
  for (const tk of tokens) {
    if (tk.t === 'link' && !tk.auto) return true;
  }
  return false;
}

// ------------------------------------------------------------------ rendering
function renderTokens(tokens, refs, st) {
  let out = '';
  for (const tk of tokens) {
    if (tk.t === 'text') out += escText(tk.s);
    else if (tk.t === 'code') out += '<code>' + escCode(tk.s) + '</code>';
    else if (tk.t === 'entity') out += tk.s;
    else if (tk.t === 'br') out += '<br>';
    else if (tk.t === 'html') out += tk.s;
    else if (tk.t === 'del') out += '<del>' + renderTokens(tk.kids, refs, st) + '</del>';
    else if (tk.t === 'emStart') {
      out += tk.kind === 'strong' ? '<strong>' : tk.kind === 'del' ? '<del>' : '<em>';
    } else if (tk.t === 'emEnd') {
      out += tk.kind === 'strong' ? '</strong>' : tk.kind === 'del' ? '</del>' : '</em>';
    }
    else if (tk.t === 'link') {
      const href = escHref(tk.dest);
      const altHtml = renderTokens(tk.alt, refs, st);
      out += '<a href="' + href + '"';
      if (tk.title !== null && tk.title !== undefined) {
        out += ' title="' + escAttrKeepEnt(tk.title) + '"';
      }
      out += '>' + altHtml + '</a>';
    } else if (tk.t === 'img') {
      const src = escHref(tk.dest);
      const alt = escAttrKeepEnt(flattenTokens(tk.altToks || []));
      out += '<img src="' + src + '" alt="' + alt + '"';
      if (tk.title !== null && tk.title !== undefined) {
        out += ' title="' + escAttrKeepEnt(tk.title) + '"';
      }
      out += '>';
    }
  }
  return out;
}

function inlineToHtml(text, refs, st) {
  return renderTokens(tokenize(text, refs, st), refs, st);
}

function renderBlock(node, refs, st) {
  switch (node.t) {
    case 'doc':
      return node.kids.map((k) => renderBlock(k, refs, st)).join('');
    case 'para': {
      let html = inlineToHtml(node.text, refs, st);
      if (node.task) {
        html =
          (node.task === 'x'
            ? '<input checked="" disabled="" type="checkbox"> '
            : '<input disabled="" type="checkbox"> ') + html;
      }
      return '<p>' + html + '</p>\n';
    }
    case 'head':
      return '<h' + node.level + '>' + inlineToHtml(node.text, refs, st) + '</h' + node.level + '>\n';
    case 'hr':
      return '<hr>\n';
    case 'code':
      return '<pre><code>' + escCode(node.text) + '</code></pre>\n';
    case 'fence': {
      let cls = '';
      if (node.info) {
        const first = unescapePunct(node.info.split(/\s+/)[0]);
        if (first) cls = ' class="language-' + escAttrKeepEnt(first) + '"';
      }
      return '<pre><code' + cls + '>' + escCode(node.text) + '</code></pre>\n';
    }
    case 'html':
      return node.text;
    case 'quote':
      return '<blockquote>\n' + node.kids.map((k) => renderBlock(k, refs, st)).join('') + '</blockquote>\n';
    case 'table':
      return renderTable(node, refs, st);
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul';
      let attrs = '';
      if (node.ordered && node.start !== 1) attrs = ' start="' + node.start + '"';
      let inner = '';
      for (const item of node.kids) inner += renderItem(item, node.tight, refs, st);
      return '<' + tag + attrs + '>\n' + inner + '</' + tag + '>\n';
    }
    default:
      return '';
  }
}

function renderItem(item, tight, refs, st) {
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
  let inner = '';
  if (item.kids.length === 0) {
    if (item.task) {
      inner +=
        item.task === 'x'
          ? '<input checked="" disabled="" type="checkbox">'
          : '<input disabled="" type="checkbox">';
    }
    return '<li>' + inner + '</li>\n';
  }
  if (tight) {
    // In a tight list, a paragraph child renders as bare inline content
    // (no <p> wrapper); other blocks render normally. The task checkbox
    // is prepended by the para rendering below (firstPara.task).
    for (const k of item.kids) {
      if (k.t === 'para') {
        let html = inlineToHtml(k.text, refs, st);
        if (k.task) {
          html =
            (k.task === 'x'
              ? '<input checked="" disabled="" type="checkbox"> '
              : '<input disabled="" type="checkbox"> ') + html;
        }
        inner += html;
      } else inner += renderBlock(k, refs, st);
    }
    return '<li>' + inner + '</li>\n';
  }
  for (const k of item.kids) inner += renderBlock(k, refs, st);
  return '<li>' + inner + '</li>\n';
}

function renderTable(node, refs, st) {
  let out = '<table>\n<thead>\n<tr>\n';
  for (let i = 0; i < node.header.length; i++) {
    const align = node.aligns[i];
    out += '<th' + (align ? ' align="' + align + '"' : '') + '>' + inlineToHtml(node.header[i], refs, st) + '</th>\n';
  }
  out += '</tr>\n</thead>\n';
  if (node.rows.length > 0) {
    // marked emits <tbody> immediately followed by the first <tr> and
    // </tbody> immediately followed by </table>: no newlines around them.
    out += '<tbody>';
    for (const row of node.rows) {
      out += '<tr>\n';
      for (let i = 0; i < row.length; i++) {
        const align = node.aligns[i];
        out += '<td' + (align ? ' align="' + align + '"' : '') + '>' + inlineToHtml(row[i], refs, st) + '</td>\n';
      }
      out += '</tr>\n';
    }
    out += '</tbody>';
  }
  out += '</table>\n';
  return out;
}

// Fix the trailing newline of HTML blocks (marked's ge() + html regexes):
// a block's text ends with '\n' when the end line is terminated AND the
// next line is not empty (a whitespace-only next line keeps the '\n'; a
// non-blank next line keeps it only when the block has a next sibling in
// the same parent); at end of input, only at the document root.
function fixHtmlTrail(node, parent, idx, lines, endsWithNl) {
  if (node.t === 'html') {
    let trail = false;
    if (node.endKind !== 'blank') {
      const nxt = node.endLine + 1;
      if (nxt >= lines.length) trail = endsWithNl && parent.t === 'doc';
      else if (lines[nxt] === '') trail = false;
      else if (isBlankLine(lines[nxt])) trail = true;
      else trail = idx < parent.kids.length - 1;
    }
    if (trail) node.text += '\n';
  }
  if (node.kids) {
    for (let i = 0; i < node.kids.length; i++) {
      fixHtmlTrail(node.kids[i], node, i, lines, endsWithNl);
    }
  }
}

export function parse(text) {
  // Normalize line endings first (marked treats \r\n and lone \r as \n).
  text = text.replace(/\r\n?/g, '\n');
  const endsWithNl = text.endsWith('\n');
  const lines = text.split('\n');
  if (endsWithNl) lines.pop();
  const { root, refs } = parseBlocks(lines, endsWithNl);
  fixHtmlTrail(root, root, 0, lines, endsWithNl);
  // One inline state for the whole document: an unclosed <a> tag seen
  // while tokenizing one block suppresses extended autolinks in all
  // following blocks until </a> (marked's Lexer.state.inLink).
  const st = { inLink: false };
  return renderBlock(root, refs, st);
}

