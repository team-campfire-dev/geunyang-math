/** Editing preserves the written answer (and therefore the grader's form requirements). */
export type AnswerSelection = { start: number; end: number };
export function replaceAnswerSelection(value: string, selection: AnswerSelection, inserted: string) {
  const start = Math.max(0, Math.min(selection.start, value.length));
  const end = Math.max(start, Math.min(selection.end, value.length));
  const next = value.slice(0, start) + inserted + value.slice(end);
  return next.length > 80 ? { value, ...selection } : { value: next, start: start + inserted.length, end: start + inserted.length };
}
export function fractionSelection(value: string, part: 'numerator' | 'denominator'): AnswerSelection | null {
  const slash = value.indexOf('/');
  if (slash < 0) return null;
  return part === 'numerator' ? { start: 0, end: slash } : { start: slash + 1, end: value.length };
}
