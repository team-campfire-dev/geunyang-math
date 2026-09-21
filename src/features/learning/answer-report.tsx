'use client';

import { conceptStateLabels, type ConceptState, type PublicConcept, type PublicLesson } from '@/shared/api';
import { misreadingAdvice, misreadingLabels, type Misreading } from '@/shared/misreading';
import { misconceptionLabel, misconceptionOf } from '@/shared/misconception';
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
  /** The mistake this question was built to catch, when the answer was one the author named. */
  misconception?: string;
};

/**
 * How a concept came out — what this round saw, and what the whole record already knew.
 *
 * `reading` is the two put together. One round is thin evidence: a concept asked once and missed
 * once is a wrong answer, not a finding, and a concept the record already calls `independent` is
 * not suddenly missing because today went badly. Only `gap` — missed here, and not already earned
 * across sittings — is the report allowed to call a place to go back to.
 */
type ConceptRow = {
  key: string; label: string; asked: number; got: number; lessonKey: string | null;
  standing: ConceptState; reading: 'firm' | 'shaky' | 'missing' | 'known' | 'thin'; gap: boolean;
};

const verdicts: Record<ConceptRow['reading'], (row: ConceptRow) => string> = {
  firm: () => '든든해요',
  shaky: () => '아직 왔다 갔다 해요',
  missing: () => '여기서 자꾸 막혀요',
  known: () => '오늘만 삐끗했어요',
  thin: (row) => (row.got ? '한 번 맞혔어요' : '한 번 틀렸어요'),
};

function read(asked: number, got: number, standing: ConceptState): Pick<ConceptRow, 'reading' | 'gap'> {
  // Earned across sittings: two different questions, first time, without a hint (and again later).
  const settled = standing === 'independent' || standing === 'retained';
  const gap = got < asked && !settled;
  if (got === asked) return { reading: asked >= 2 || settled ? 'firm' : 'thin', gap: false };
  if (settled) return { reading: 'known', gap };
  return { reading: asked === 1 ? 'thin' : got === 0 ? 'missing' : 'shaky', gap };
}

/**
 * What a finished set or lesson says back.
 *
 * The point is to answer a question the screen has never answered before: not「몇 개 맞았나」but
 * 「무엇을 모르고 있나」. Every question names the concepts it is about, so the answers sort
 * themselves into concepts without anybody tagging anything. Beside that, the kinds of slip the
 * marker could read off the answers are counted, because「부호를 세 번 놓쳤다」is a different
 * lesson from「통분을 모른다」and the two are usually mixed together in one score.
 *
 * What it refuses to do is turn one round into a verdict. A round is short — most concepts in one
 * are asked once or twice — so every row carries what the record already knew beside it, and the
 * one place the report actually sends somebody has to be weak in both.
 *
 * And it does not ask the learner anything. Everything here is inferred from answers that were
 * sent anyway, which is the only kind of report somebody actually finishes.
 */
export function AnswerReport({ items, concepts, lessons, standings, onOpenLesson, busy }: {
  items: ReportItem[]; concepts: PublicConcept[]; lessons: PublicLesson[];
  /** What the whole record says about each concept, which is what keeps one round in proportion. */
  standings?: { key: string; state: ConceptState }[];
  onOpenLesson: (lessonKey: string) => void; busy?: boolean;
}) {
  if (!items.length) return null;
  const got = items.filter((item) => item.correct).length;
  const unaided = items.filter((item) => item.firstCorrect && !item.assisted).length;
  const corrected = items.filter((item) => item.correct && !item.firstCorrect).length;
  const helped = items.filter((item) => item.assisted).length;

  const counts = new Map<string, { asked: number; got: number }>();
  for (const item of items) {
    for (const key of item.conceptKeys) {
      const seen = counts.get(key) ?? { asked: 0, got: 0 };
      // Unaided and first time, which is the same evidence the learning record keeps.
      counts.set(key, { asked: seen.asked + 1, got: seen.got + (item.firstCorrect && !item.assisted ? 1 : 0) });
    }
  }
  const rows: ConceptRow[] = [...counts.entries()].map(([key, seen]) => {
    const standing = standings?.find((concept) => concept.key === key)?.state ?? 'unknown';
    return { key, label: concepts.find((concept) => concept.key === key)?.label ?? key, ...seen, standing,
      lessonKey: lessons.find((lesson) => lesson.conceptKeys.includes(key))?.lessonKey ?? null, ...read(seen.asked, seen.got, standing) };
  });
  // Real gaps first. Among them the one asked about most, because more questions make it firmer.
  const byConcept = rows.sort((a, b) => Number(b.gap) - Number(a.gap)
    || a.got / a.asked - b.got / b.asked || b.asked - a.asked || a.label.localeCompare(b.label));
  const gaps = byConcept.filter((row) => row.gap);
  const next = gaps.find((row) => row.lessonKey);
  const offDay = !gaps.length && byConcept.some((row) => row.got < row.asked);

  /**
   * What kept going wrong, counted. Two sources sit in one list because to a learner they are one
   * thing: a slip read off the number (「부호를 놓친 답」) and a step the question was built to catch
   * (「이익을 판매가로 나누기」) are both 「내가 자꾸 하는 것」. The authored one is never both — the
   * marker stops at the first name it finds — so nothing is counted twice.
   */
  const slips = new Map<string, { label: string; advice: string; count: number }>();
  const note = (id: string, label: string, advice: string) => {
    const seen = slips.get(id);
    slips.set(id, { label, advice, count: (seen?.count ?? 0) + 1 });
  };
  for (const item of items) {
    if (item.misconception) note(`m:${item.misconception}`, misconceptionLabel(item.misconception), misconceptionOf(item.misconception)?.note ?? '');
    else if (item.misreading) note(`r:${item.misreading}`, misreadingLabels[item.misreading], misreadingAdvice[item.misreading]);
  }
  const bySlip = [...slips.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

  return <section className="answer-report" aria-label="이번 풀이에서 본 것">
    <div className="report-head">
      <div><span className="eyebrow">WHAT THIS ROUND SHOWED</span>
        <h2>{gaps.length ? gaps.length === 1 ? '한 군데만 더 보고 가면 돼요.' : '여기 몇 군데만 더 보고 가요.'
          : offDay ? '그동안 풀던 곳에서 오늘만 삐끗했어요.' : '오늘은 막히는 데가 없었어요.'}</h2></div>
      <span className="report-score"><strong>{got}</strong> / {items.length}</span>
    </div>
    <p className="muted small">힌트 없이 처음에 맞힌 것 {unaided}개{corrected ? ` · 고쳐서 맞힌 것 ${corrected}개` : ''}{helped ? ` · 힌트와 함께 푼 것 ${helped}개` : ''}. 따로 물어본 것은 없고, 답한 것에서만 읽었어요.</p>

    <div className="report-concepts">
      <p className="report-legend">개념마다 <b>오늘</b> 힌트 없이 처음에 맞힌 수, 그리고 <b>그동안</b> 쌓인 기록이에요.</p>
      {byConcept.map((row) => <div key={row.key} className={`report-concept is-${row.reading}`}>
        <span className="report-concept-name">{row.label}</span>
        <span className="report-dots" aria-hidden="true">{Array.from({ length: row.asked }, (_, index) => <i key={index} className={index < row.got ? 'on' : ''} />)}</span>
        <span className="report-count">{row.got} / {row.asked}</span>
        <span className="report-standing">그동안 {conceptStateLabels[row.standing]}</span>
        <span className="report-verdict">{verdicts[row.reading](row)}</span>
        {row.gap && row.lessonKey && <button className="text-button" disabled={busy} onClick={() => onOpenLesson(row.lessonKey!)}>수업 다시 보기<Icon name="arrow" size={14} /></button>}
      </div>)}
    </div>

    {bySlip.length > 0 && <div className="report-slips">
      <h3>자꾸 되풀이된 것</h3>
      {bySlip.map(([id, slip]) => <div key={id}><strong>{slip.label}<span>{slip.count}번</span></strong><p>{slip.advice}</p></div>)}
    </div>}

    {next && <div className="report-next">
      <div><strong>그럼 「{next.label}」부터 다시 볼까요?</strong>
        <p>{next.asked >= 2 ? '이번에 가장 많이 걸린 곳이에요. 설명을 한 번 더 읽고 오면 나머지도 함께 풀려요.'
          : '오늘은 한 번 물어본 것뿐이라 단정할 수는 없지만, 설명을 한 번 더 읽어 두면 편해져요.'}</p></div>
      <button className="button primary" disabled={busy} onClick={() => onOpenLesson(next.lessonKey!)}>그 수업 열기<Icon name="arrow" size={17} /></button>
    </div>}
  </section>;
}
