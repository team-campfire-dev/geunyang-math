/**
 * Turning a dragged selection into words, and finding those words again.
 *
 * A formula is drawn by KaTeX twice — once for the eye and once, hidden, for a screen reader — so the
 * browser's own `toString()` of a selection over one reads as the same digits doubled and run
 * together. Here a formula is read as its source instead, `$\frac{1}{2}$`, which is what the person
 * fixing the lesson will look for. The same reading is used to find a quote again, so what was kept
 * and what is searched agree.
 */

/** One character of a block as it reads, and where it sits: in a text node, or inside a formula. */
type Point = { node: Text; offset: number } | { math: Element };

/** Parts of the page that are not the lesson: the marks and the feedback thread drawn over it. */
const outside = (element: Element) => !!element.closest('[data-feedback-chrome]');

function read(root: Element, within?: Range): { text: string; points: Point[] } {
  let text = '';
  const points: Point[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.nodeValue ?? '';
      let start = 0, end = value.length;
      if (within) {
        if (!within.intersectsNode(node)) return;
        if (node === within.startContainer) start = within.startOffset;
        if (node === within.endContainer) end = within.endOffset;
      }
      for (let offset = start; offset < end; offset++) { text += value[offset]; points.push({ node: node as Text, offset }); }
      return;
    }
    if (!(node instanceof Element) || outside(node)) return;
    if (node.classList.contains('katex')) {
      if (within && !within.intersectsNode(node)) return;
      const source = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if (source) {
        const written = `$${source}$`;
        for (const character of written) { text += character; points.push({ math: node }); }
        return;
      }
    }
    if (node.classList.contains('katex-mathml')) return;
    node.childNodes.forEach(visit);
  };
  visit(root);
  return { text, points };
}

/** Runs of space as one, the way a quote is kept, with each kept character's place. */
function flatten(text: string, points: Point[]) {
  let flat = '';
  const at: Point[] = [];
  for (let index = 0; index < text.length; index++) {
    const space = /\s/.test(text[index]);
    if (space && (flat === '' || flat.endsWith(' '))) continue;
    flat += space ? ' ' : text[index];
    at.push(points[index]);
  }
  return { flat, at };
}

/** What a selection says inside one block, read the way a quote is kept. */
export function quoteOf(range: Range, block: Element): string {
  const { text } = read(block, range);
  return text.replace(/\s+/g, ' ').trim();
}

/** Where a kept quote is in a block now, or nothing when the words are no longer there. */
export function rangeOf(quote: string, block: Element): Range | null {
  const wanted = quote.replace(/…$/, '').trim();
  if (!wanted) return null;
  const { text, points } = read(block);
  const { flat, at } = flatten(text, points);
  const start = flat.indexOf(wanted);
  if (start < 0) return null;
  const first = at[start], last = at[start + wanted.length - 1];
  const range = document.createRange();
  if ('math' in first) range.setStartBefore(first.math); else range.setStart(first.node, first.offset);
  if ('math' in last) range.setEndAfter(last.math); else range.setEnd(last.node, last.offset + 1);
  return range;
}
