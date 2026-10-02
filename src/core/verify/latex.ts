import { fail } from './numbers';

/**
 * The LaTeX a prompt or an option is written in, translated into the claim language. Only notation
 * is translated — `\frac{a}{b}` becomes `((a)/(b))`, `\sin 30^\circ` becomes `sin(30°)` — and a
 * command this does not know stops the translation, so an option is never read as something it
 * does not say.
 */
const greek: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ',
  sigma: 'σ', phi: 'φ', varphi: 'φ', omega: 'ω',
};
const functions: Record<string, string> = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', ln: 'ln', log: 'log', exp: 'exp',
};
const inverse: Record<string, string> = { sin: 'asin', cos: 'acos', tan: 'atan' };
/** A piece of words inside math that cannot be translated, so whatever contains it is unreadable. */
export const UNREADABLE = '\u0001';
/** A unit, kept apart from the value it follows: `\u0002cm\u0002`. */
export const UNIT = '\u0002';

/** 1,000 and 12,345 are numbers, not lists. */
export const joinThousands = (text: string) => text.replace(/\b\d{1,3}(?:,\d{3})+(?![\d.])/g, (m) => m.replace(/,/g, ''));

export function latexToClaim(source: string): string {
  const s = source
    // LaTeX writes ≠ as \ne, never as !=, so `3!=6` is a factorial and an equals sign.
    .replace(/!=/g, '! =')
    // A whole number written against a fraction is a mixed number: 2\frac{1}{3} is 2 + 1/3, not 2·1/3.
    .replace(/(^|[^\d.^_}])(\d+)\s*\\[dt]?frac\s*\{\s*(\d+)\s*\}\s*\{\s*(\d+)\s*\}/g, '$1(\\frac{$2}{1}+\\frac{$3}{$4})');
  let i = 0;
  const space = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const name = () => {
    i++;
    const letters = /^[A-Za-z]+/.exec(s.slice(i));
    if (letters) { i += letters[0].length; return letters[0]; }
    return s[i++] ?? '';
  };
  /** `{…}` translated, with the braces consumed. */
  const group = (): string => {
    i++;
    const inner = until('}');
    if (s[i] !== '}') fail('syntax', 'Unbalanced braces in LaTeX.');
    i++;
    return inner;
  };
  /** One argument: a braced group, or a single character or command. */
  const argument = (): string => {
    space();
    if (s[i] === '{') return group();
    if (s[i] === '\\') return command();
    return s[i++] ?? '';
  };
  const raw = (): string => {
    space();
    if (s[i] !== '{') return fail('syntax', 'Expected a braced argument.');
    let depth = 0, start = i + 1;
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++;
      if (s[i] === '}' && --depth === 0) { i++; return s.slice(start, i - 1); }
    }
    return fail('syntax', 'Unbalanced braces in LaTeX.');
  };
  /** Translates until `stop` at depth zero, keeping parentheses balanced. */
  const until = (stop: string): string => {
    const parts: string[] = [];
    let depth = 0;
    while (i < s.length) {
      if (s[i] === stop && depth === 0) break;
      const piece = token();
      for (const c of piece) { if (c === '(') depth++; if (c === ')') depth--; }
      parts.push(piece);
    }
    return parts.join('');
  };
  const delimiter = (): string => {
    space();
    if (s[i] === '\\') {
      const d = name();
      if (d === '{' || d === 'lbrace') return '(';
      if (d === '}' || d === 'rbrace') return ')';
      if (d === 'lvert' || d === 'rvert' || d === 'vert' || d === '|') return '|';
      return fail('unsupported', `\\${d} is not a supported delimiter.`);
    }
    const c = s[i++];
    return c === '.' ? '' : c === '[' ? '(' : c === ']' ? ')' : c;
  };
  /** What a function applies to when it is written without parentheses: `\sin 2x`, `\log_2 8`. */
  const applied = (): string => {
    space();
    if (s[i] === '(') { i++; const inner = until(')'); i++; return inner; }
    if (s.startsWith('\\left', i)) {
      i += 5; delimiter();
      const parts: string[] = [];
      let depth = 0;
      while (i < s.length && !(depth === 0 && s.startsWith('\\right', i))) {
        const piece = token();
        for (const ch of piece) { if (ch === '(') depth++; if (ch === ')') depth--; }
        parts.push(piece);
      }
      if (s.startsWith('\\right', i)) { i += 6; delimiter(); }
      return parts.join('');
    }
    if (s[i] === '{') return group();
    let out = '';
    while (i < s.length) {
      const match = /^(\d+(?:\.\d+)?|[A-Za-z])/.exec(s.slice(i));
      if (match) { out += match[0]; i += match[0].length; }
      // A power or a degree sign stays with the argument: `\sin 30^\circ`, `\ln x^2`.
      else if (s[i] === '^') out += token();
      else if (s[i] === '\\') {
        const save = i, c = name();
        if (c === 'pi') out += 'pi';
        else if (greek[c]) out += greek[c];
        else if (c === 'circ') out += '°';
        else if (!out && (c === 'frac' || c === 'dfrac' || c === 'tfrac' || c === 'sqrt')) { i = save; out += token(); break; }
        else { i = save; break; }
      } else break;
      // A space before another command ends the argument: `\sin x \cos x` is two factors.
      if (/^\s+\\/.test(s.slice(i))) break;
      space();
    }
    if (!out) fail('syntax', 'A function in LaTeX has nothing to apply to.');
    return out;
  };
  const command = (): string => {
    const c = name();
    switch (c) {
      case 'frac': case 'dfrac': case 'tfrac': {
        const a = argument(), b = argument();
        // d/dx and dy/dx are operators, not a quotient of the variables d and x.
        const compact = (x: string) => x.replace(/\s/g, '');
        if (/^d(\^\(\d+\))?[A-Za-z\u03b1-\u03c9]?$/.test(compact(a)) && /^d[A-Za-z\u03b1-\u03c9]/.test(compact(b))) return UNREADABLE;
        return `((${a})/(${b}))`;
      }
      case 'sqrt': {
        space();
        let index = '';
        if (s[i] === '[') { i++; index = until(']'); i++; }
        const a = argument();
        return index ? `root((${a}),(${index}))` : `sqrt(${a})`;
      }
      case 'left': case 'right': case 'bigl': case 'bigr': case 'Bigl': case 'Bigr': case 'big': case 'Big': return delimiter();
      case 'times': case 'cdot': case 'ast': return '*';
      case 'div': return '/';
      case 'pm': return '±';
      case 'mp': return '∓';
      case 'le': case 'leq': case 'leqslant': return '<=';
      case 'ge': case 'geq': case 'geqslant': return '>=';
      case 'ne': case 'neq': return '≠';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'Rightarrow': case 'implies': case 'Longrightarrow': return ' => ';
      case 'pi': return ' pi ';
      case 'infty': return ' inf ';
      case 'circ': return '°';
      case '%': return '%';
      case '{': case 'lbrace': return '(';
      case '}': case 'rbrace': return ')';
      case '|': case 'lvert': case 'rvert': case 'vert': return '|';
      case ',': case ';': case ':': case '!': case ' ': case 'quad': case 'qquad': return ' ';
      case 'displaystyle': case 'limits': return '';
      case 'text': case 'mathrm': case 'textrm': case 'mbox': return words(raw());
    }
    if (greek[c]) return greek[c];
    if (functions[c]) {
      space();
      let base = '', power = '', fn = functions[c];
      if (c === 'log' && s[i] === '_') { i++; base = argument(); space(); }
      if (s[i] === '^') {
        i++;
        const p = argument();
        // sin⁻¹ is arcsin; sec⁻¹ and the like are not read rather than read as a reciprocal.
        if (p.trim() === '-1') { if (!inverse[c]) return UNREADABLE; fn = inverse[c]; } else power = p;
        space();
      }
      const arg = applied();
      const call = base ? `log((${base}),(${arg}))` : `${fn}(${arg})`;
      return power ? `(${call})^(${power})` : call;
    }
    return fail('unsupported', `\\${c} is not supported in a checked expression.`);
  };
  const token = (): string => {
    const c = s[i];
    if (c === '\\') return command();
    if (c === '{') {
      if (s.startsWith('{,}', i)) { i += 3; return ''; }
      return `(${group()})`;
    }
    if (c === '^') {
      i++; space();
      if (s.startsWith('\\circ', i)) { i += 5; return '°'; }
      if (s.startsWith('{\\circ}', i)) { i += 7; return '°'; }
      return `^(${argument()})`;
    }
    if (c === '_') {
      i++;
      // A subscript is a name: a_{n+1} is its own symbol, and writing it as a_n + 1 would change the meaning.
      const sub = argument().replace(/[()\s]/g, '');
      return /^[A-Za-z0-9]+$/.test(sub) ? `_${sub}` : UNREADABLE;
    }
    if (c === '~' || c === '&') { i++; return ' '; }
    i++;
    return c;
  };
  const out = until('\u0000');
  return out;
}

/** Words inside `\text{…}` or between math segments: a joining word, a unit, or something unreadable. */
const units = /^(cm²|cm³|m²|m³|km|cm|mm|m|kg|mg|g|mL|ml|L|원|개|명|번|가지|시간|분|초|일|주|개월|달|년|점|장|권|마리|송이|대|배|쪽|회|층|살|도|%|°|위|째|번째|등|모|칸|조각|잔|병|봉지|상자|켤레|그루|리터|미터|킬로미터|센티미터)$/;
export function words(text: string): string {
  const t = text.trim();
  if (!t) return ' ';
  if (/^(또는|혹은|or)$/i.test(t)) return ' or ';
  if (/^(그리고|이고|and)$/i.test(t)) return ' and ';
  if (/^[,，]$/.test(t)) return ',';
  if (t.split(/\s+/).every((w) => units.test(w))) return `${UNIT}${t}${UNIT}`;
  return UNREADABLE;
}
