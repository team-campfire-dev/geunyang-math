'use client';

import { useEffect, useState } from 'react';
import { aiPracticeLimits, scopeEvidence, scopeKey, type PracticeScope } from '@/shared/ai-practice';
import type { AssignmentView, LearningState } from '@/shared/api';
import { Icon } from './icons';

/**
 * What a learner is told while a set is being written, by how long it has been. The steps are the
 * real ones — read, plan, write, check — but timed rather than reported, since the server does not
 * stream its progress; the last one stays until the set arrives.
 */
const steps: [number, string][] = [
  [0, '기록을 읽고, 무엇을 연습하면 좋을지 정하고 있어요'],
  [12, '고른 부분에 맞춰 문제를 쓰고 있어요'],
  [30, '정답을 직접 계산하고, 문제만 보고 따로 풀어 맞춰 보고 있어요'],
];
const stepAt = (seconds: number) => steps.filter(([from]) => seconds >= from).at(-1)![1];

const copy: Record<PracticeScope['kind'], { title: string; text: (label: string) => string }> = {
  all: { title: 'AI 맞춤 연습', text: () => `AI가 지금까지의 학습 기록을 읽고, 약한 개념과 헷갈린 부분을 골라 ${aiPracticeLimits.questions}문제를 새로 내요.` },
  course: { title: '이 코스로 AI 맞춤 연습', text: (label) => `「${label}」에서 푼 기록을 읽고, 다시 다질 부분으로 ${aiPracticeLimits.questions}문제를 내요.` },
  lesson: { title: '이 수업으로 AI 맞춤 연습', text: (label) => `「${label}」에서 틀린 것과 약한 개념을 보고 ${aiPracticeLimits.questions}문제를 새로 내요.` },
};

/**
 * The way to AI 맞춤 연습 from wherever a learner is: the home screen, their record, the end of a
 * lesson, a course. The same component in each, so it says the same things the same way — what it
 * will read, whether there is enough to read, how many are left today, and while it is writing,
 * what it is doing.
 */
export function AiPracticePanel({ scope, label, state, lessons, busy, variant, onStart, onOpen }: {
  scope: PracticeScope; label: string; state: LearningState; lessons: LearningState['lessons'];
  busy: boolean; variant: 'banner' | 'card';
  onStart: (scope: PracticeScope) => Promise<void>;
  onOpen: (assignment: AssignmentView) => void;
}) {
  const key = scopeKey(scope);
  const run = state.aiPractice.runs.find((item) => item.scope === key);
  const open = state.assignments.find((item) => item.ai?.scope === key && item.status === 'assigned');
  const evidence = scopeEvidence(state.confusion, scope, lessons).length;
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const pending = run?.status === 'pending';
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);
  if (!state.aiPractice.available) return null;
  const short = evidence < aiPracticeLimits.minimumEvidence;
  const spent = state.aiPractice.remaining <= 0;
  const start = async () => {
    setError('');
    try { await onStart(scope); } catch (reason) { setError(reason instanceof Error ? reason.message : 'AI 맞춤 연습을 시작하지 못했어요.'); }
  };
  const status = pending
    ? <p className="ai-practice-status" role="status"><span className="loader" />{stepAt(Math.max(0, (now - Date.parse(run.startedAt)) / 1000))}… 다른 화면으로 가도 계속 만들어요.</p>
    : run?.status === 'failed' ? <p className="ai-practice-status is-failed" role="alert">{run.message}</p>
    : short ? <p className="ai-practice-status">이 범위에서 문제를 {aiPracticeLimits.minimumEvidence}개 이상 풀면 만들 수 있어요. 지금 {evidence}개예요.</p>
    : null;
  const action = open
    ? <button className="button primary" disabled={busy} onClick={() => onOpen(open)}>이어서 풀기<Icon name="arrow" size={16} /></button>
    : <button className="button primary" disabled={busy || pending || short || spent} onClick={() => void start()}>
      {pending ? '만드는 중…' : 'AI에게 문제 받기'}<Icon name="spark" size={16} /></button>;
  return <section className={`ai-practice ai-practice-${variant}`} aria-label={copy[scope.kind].title}>
    <div className="ai-practice-copy">
      <span className="ai-practice-eyebrow"><Icon name="spark" size={14} />{copy[scope.kind].title}</span>
      <p>{copy[scope.kind].text(label)}</p>
      {status}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
    <div className="ai-practice-action">
      {action}
      {!open && <small>{spent ? '오늘은 다 썼어요. 내일 다시 만들 수 있어요.' : `오늘 ${state.aiPractice.remaining}번 더 만들 수 있어요`}</small>}
    </div>
  </section>;
}

/** What the model read and saw, above the questions it wrote. */
export function AiPracticeNote({ assignment }: { assignment: AssignmentView }) {
  if (!assignment.ai) return null;
  return <div className="ai-diagnosis">
    <span className="ai-practice-eyebrow"><Icon name="spark" size={14} />AI가 「{assignment.ai.scopeLabel}」 기록에서 본 것</span>
    <p>{assignment.ai.diagnosis}</p>
    <small>모든 문제는 서버가 정답을 직접 계산하고, 문제만 보고 따로 푼 답과도 맞춰 본 것만 넣었어요.</small>
  </div>;
}
