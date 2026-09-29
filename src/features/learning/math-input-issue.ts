import { normalizeAnswer, writtenAsInteger } from '@/shared/answer';
import { mathLimits, parseMathExpression, rationalMathValue, readMathExpression, type MathNode } from '@/shared/math-expression';
import type { AnswerSelection } from './answer-editing';

export type MathInputIssue = { message: string; range: AnswerSelection };
/** Syntax and domain checks only. Expected answers and correctness stay on the server. */
export function mathInputIssue(value: string, integerOnly = false): MathInputIssue | null {
  if (!value.trim()) return null;
  const tree = parseMathExpression(value, true);
  const inner = (node: MathNode): MathNode => node.kind === 'group' ? node.child : node;
  function inspect(node: MathNode, label: string): MathInputIssue | null {
    if (node.kind === 'hole') return { message: `${label}을 채워 주세요.`, range: node };
    if (node.kind === 'binary') {
      const names = node.op === '/' ? ['분자 칸', '분모 칸'] : node.op === '^' ? ['밑 칸', '지수 칸'] : [label, label];
      const missing = inspect(node.left, names[0]) ?? inspect(node.right, names[1]);
      if (missing) return missing;
      const right = readMathExpression(value.slice(node.right.start, node.right.end));
      if (node.op === '/' && right.value?.size === 0) return { message: '분모는 0이 될 수 없어요.', range: inner(node.right) };
      if (node.op === '^' && right.value) {
        const exponent = rationalMathValue(right.value);
        if (!exponent || exponent.denominator !== 1n || exponent.numerator < -BigInt(mathLimits.exponent) || exponent.numerator > BigInt(mathLimits.exponent))
          return { message: `지수는 −${mathLimits.exponent}부터 ${mathLimits.exponent}까지의 정수로 써 주세요.`, range: inner(node.right) };
      }
    } else if ('child' in node) {
      const missing = inspect(node.child, node.kind === 'root' ? '근호 안의 칸' : label);
      if (missing) return missing;
      if (node.kind === 'root') {
        const result = readMathExpression(value.slice(node.start, node.end));
        if (result.issue) return { message: result.issue, range: inner(node.child) };
      }
    }
    return null;
  }
  if (tree) { const issue = inspect(tree, '답 칸'); if (issue) return issue; }
  const result = readMathExpression(normalizeAnswer(value) ?? '');
  if (result.issue) return { message: result.issue, range: { start: 0, end: value.length } };
  if (integerOnly && !writtenAsInteger(value)) return { message: '이 문제는 계산을 마친 정수로 써 주세요. 예: 3', range: { start: 0, end: value.length } };
  return null;
}
