'use client';

import type { PublicConcept, PublicLesson } from '@/shared/api';
import { misreadingAdvice, misreadingLabels, type Misreading } from '@/shared/misreading';
import { Icon } from './icons';

/**
 * One question as a report reads it.
 *
 * `firstCorrect` and `correct` are kept apart on purpose. Getting there in the end is what the
 * learner did; getting there first time is what they could do unaided, and it is the first answer
 * the learning record counts. A report that only looked at the last answer would tell everybody
 * they knew everything.
 */
export type ReportItem = {
  conceptKeys: string[];
  correct: boolean;
  firstCorrect: boolean;
  assisted: boolean;
  misreading?: Misreading;
};

/** How a concept came out, once every question that named it has been counted. */
type ConceptRow = { key: string; label: string; asked: number; got: number; lessonKey: string | null };

/**
 * What a finished set or lesson says back.
 *
 * The point is to answer a question the screen has never answered before: not「몇 개 맞았나」but
 * 「무엇을 모르고 있나」. Every question names the concepts it is about, so the answers sort
 * themselves into concepts without anybody tagging anything, and a concept that was asked three
 * times and missed twice is a finding rather than a guess. Beside that, the kinds of slip the
 * marker could read off the answers are counted, because「부호를 세 번 놓쳤다」is a different
 * lesson from「통분을 모른다」and the two are usually mixed together in one score.
 *
 * What it does not do: it does not ask the learner anything. Everything here is inferred from
 * answers that were sent anyway, which is the only kind of report somebody actually finishes.
 */
export function AnswerReport({ items, concepts, lessons, onOpenLesson, busy }: {
  items: ReportItem[]; concepts: PublicConcept[]; lessons: PublicLesson[];
  onOpenLesson: (lessonKey: string) => void; busy?: boolean;
}) {
  if (!items.length) return null;
  const got = items.filter((item) => item.correct).length;
  const unaided = items.filter((item) => item.firstCorrect && !item.assisted).length;
  const corrected = items.filter((item) => item.correct && !item.firstCorrect).length;
  const helped = items.filter((item) => item.assisted).length;

  const rows = new Map<string, ConceptRow>();
  for (const item of items) {
    for (const key of item.conceptKeys) {
      const row = rows.get(key) ?? { key, label: concepts.find((concept) => concept.key === key)?.label ?? key,
        asked: 0, got: 0, lessonKey: lessons.find((lesson) => lesson.conceptKeys.includes(key))?.lessonKey ?? null };
      // Unaided and first time, which is the same evidence the learning record keeps.
      rows.set(key, { ...row, asked: row.asked + 1, got: row.got + (item.firstCorrect && !item.assisted ? 1 : 0) });
    }
  }
  // Weakest first, and among equals the one asked about most, because that is the firmer finding.
  const byConcept = [...rows.values()].sort((a, b) => a.got / a.asked - b.got / b.asked || b.asked - a.asked || a.label.localeCompare(b.label));
  const weak = byConcept.filter((row) => row.got < row.asked);
  const next = weak.find((row) => row.lessonKey);

  const slips = new Map<Misreading, number>();
  for (const item of items) if (item.misreading) slips.set(item.misreading, (slips.get(item.misreading) ?? 0) + 1);
  const bySlip = [...slips.entries()].sort((a, b) => b[1] - a[1]);

  return <section className="answer-report" aria-label="이번 풀이에서 본 것">
    <div className="report-head">
      <div><span className="eyebrow">WHAT THIS ROUND SHOWED</span>
        <h2>{weak.length ? '여기를 한 번 더 보면 좋겠어요.' : '오늘은 걸리는 곳이 없었어요.'}</h2></div>
      <span className="report-score"><strong>{got}</strong> / {items.length}</span>
    </div>
    <p className="muted small">힌트 없이 처음에 맞힌 것 {unaided}개{corrected ? ` · 고쳐서 맞힌 것 ${corrected}개` : ''}{helped ? ` · 힌트와 함께 푼 것 ${helped}개` : ''}. 아래는 답한 것에서 읽은 것이고, 따로 물어본 것은 없어요.</p>

    <div className="report-concepts">
      {byConcept.map((row) => <div key={row.key} className={row.got === row.asked ? 'report-concept is-firm' : row.got ? 'report-concept is-shaky' : 'report-concept is-missing'}>
        <span className="report-concept-name">{row.label}</span>
        <span className="report-dots" aria-hidden="true">{Array.from({ length: row.asked }, (_, index) => <i key={index} className={index < row.got ? 'on' : ''} />)}</span>
        <span className="report-count">{row.got} / {row.asked}</span>
        <span className="report-verdict">{row.got === row.asked ? '든든해요' : row.got ? '반쯤 잡혔어요' : '여기가 걸려요'}</span>
        {row.got < row.asked && row.lessonKey && <button className="text-button" disabled={busy} onClick={() => onOpenLesson(row.lessonKey!)}>수업 다시 보기<Icon name="arrow" size={14} /></button>}
      </div>)}
    </div>

    {bySlip.length > 0 && <div className="report-slips">
      <h3>답에서 되풀이된 것</h3>
      {bySlip.map(([kind, count]) => <div key={kind}><strong>{misreadingLabels[kind]}<span>{count}번</span></strong><p>{misreadingAdvice[kind]}</p></div>)}
    </div>}

    {next && <div className="report-next">
      <div><strong>다음은 「{next.label}」부터 다시.</strong><p>이번에 가장 많이 걸린 곳이에요. 설명을 한 번 더 읽고 오면 나머지도 함께 풀려요.</p></div>
      <button className="button primary" disabled={busy} onClick={() => onOpenLesson(next.lessonKey!)}>그 수업 열기<Icon name="arrow" size={17} /></button>
    </div>}
  </section>;
}
