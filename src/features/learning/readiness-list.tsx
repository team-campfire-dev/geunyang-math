import type { ConceptReadiness } from '@/shared/api';

const verdicts = { ready: '다음 개념 준비', 'needs-practice': '한 번 더 연습', unknown: '아직 확인 전' } as const;
const origins = { inferred: '앞의 답에서', diagnostic: '시작점 확인', learning: '나의 풀이', none: '' } as const;

/**
 * Where a learner stands, concept by concept.
 *
 * A placement settles what it can and leaves the rest alone, and the rest is most of a growing
 * catalogue — laying all of it out as chips buries the few that say something under a wall of «아직
 * 확인 전». What was settled is shown; what was not is counted and folded, because the honest thing
 * is to say it is unknown, not to say it twenty times.
 *
 * `explainSource` is for screens that mix a placement with a learner's own work. On the placement's
 * own screen everything came from the placement, so only the concepts it never asked about say so.
 */
export function ReadinessList({ readiness, explainSource = false }: { readiness: ConceptReadiness[]; explainSource?: boolean }) {
  const settled = readiness.filter((concept) => concept.readiness !== 'unknown');
  const open = readiness.filter((concept) => concept.readiness === 'unknown');
  const chip = (concept: ConceptReadiness) => {
    const origin = explainSource ? origins[concept.source] : concept.source === 'inferred' ? origins.inferred : '';
    return <span key={concept.key} className={`readiness ${concept.readiness}`}>
      <strong>{concept.label}</strong> · {verdicts[concept.readiness]}
      {origin && <span className="readiness-source"> {origin}</span>}
    </span>;
  };
  return <>
    {settled.length > 0 && <div className="readiness-list">{settled.map(chip)}</div>}
    {open.length > 0 && <details className="readiness-details">
      <summary>아직 확인하지 않은 개념 {open.length}개</summary>
      <div className="readiness-list">{open.map(chip)}</div>
    </details>}
  </>;
}
