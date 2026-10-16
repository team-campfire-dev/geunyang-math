/**
 * The part of the writing guide that is said to a model: the 「지침」 section, from its first line to
 * the rule before 「피드백 기록」. Links keep their words and lose their targets, which point at files
 * the model cannot open.
 */
export function guidelinesOf(markdown: string): string {
  const start = markdown.indexOf('\n## 지침\n');
  const end = markdown.indexOf('\n---\n', start);
  if (start < 0 || end < 0) throw new Error('docs/lesson-writing-guide.md no longer has a 「지침」 section ending in a rule.');
  return markdown.slice(start + '\n## 지침\n'.length, end).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
}
