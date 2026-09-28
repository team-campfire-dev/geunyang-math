/**
 * The order a question's options are drawn in, which is not the order they were written in.
 *
 * Authors write the right answer first, nearly always — 335 of the catalogue's 380 questions answered
 * by picking had it in the first place, and in the NCS courses every one did. Drawn as written, a
 * learner who always picks the top option passes without reading. Mixing each question once, by its
 * name, puts the answer anywhere without asking every author to remember to.
 *
 * The order depends only on the question's name, so it is the same on the server and in the browser,
 * on every visit and for every learner, and a question never reshuffles under someone who is looking
 * at it. A new version of a question is a new name and may land in a new order; that is fine, since
 * nobody has answered it yet.
 */
export function choiceOrder<T>(seed: string, options: readonly T[]): T[] {
  const out = [...options];
  const next = random(hash(seed));
  // Fisher–Yates: every order is equally likely for a well-mixed seed.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** FNV-1a over UTF-16 code units: small, stable across runtimes, and good enough to seed a shuffle. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a 32-bit generator whose whole state is one number, so the same seed gives the same run. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
