/**
 * The named ways of getting a question wrong on purpose — what an author puts on a distractor, or
 * on a wrong value a learner is likely to write.
 *
 * Why a curated list rather than free text: the whole value is in adding up. If 「분모끼리 더하기」
 * is one key in 분수 and another in 유리식, a learner who does it in both looks like two people who
 * each did it once, and「되풀이되는 것」never appears. A shared list is small enough to read in one
 * sitting, which is what keeps it shared. (When authors outside the repository need their own, this
 * becomes a table beside `Concept`; the shape here is already that of a row.)
 *
 * What a key is: **what the learner did**, not what they lack. 「이익을 판매가로 나눔」 is a step
 * somebody took; 「이익률을 모름」 is a verdict on a person, and the concept graph already says that
 * sort of thing more carefully.
 */
export type MisconceptionRecord = { key: string; label: string; note: string };

export const misconceptions: MisconceptionRecord[] = [
  // 분수
  { key: 'add-denominators', label: '분모끼리 더하기',
    note: '분모가 조각의 크기라는 것을 지나치고 위아래를 따로 더해요.' },
  { key: 'swap-parts', label: '분자와 분모 바꿔 쓰기',
    note: '전체를 나눈 수와 세어 낸 수의 자리를 바꿔 써요.' },
  { key: 'scale-one-part', label: '한쪽에만 곱하기',
    note: '분모나 분자 한쪽에만 곱해 크기가 달라진 분수를 만들어요.' },
  { key: 'stop-reducing-early', label: '약분을 도중에 멈추기',
    note: '한 번 나누고 끝내, 아직 공약수가 남은 분수를 답으로 내요.' },
  { key: 'common-denominator-as-sum', label: '공통분모를 두 분모의 합으로 잡기',
    note: '공통분모를 배수에서 찾지 않고 두 분모를 더해서 만들어요.' },
  { key: 'keep-numerators-on-common', label: '통분하고 분자는 그대로 두기',
    note: '분모만 공통분모로 바꾸고 분자를 같은 배로 키우지 않아요.' },
  { key: 'add-instead-of-scale', label: '곱하는 대신 더하기',
    note: '같은 크기로 만들 때 같은 수를 곱해야 하는데 같은 수를 더해요.' },
  // 비와 비율 · 백분율
  { key: 'reverse-ratio', label: '비의 앞뒤 바꾸기',
    note: '비교하는 양과 기준량의 자리를 바꿔 읽어요.' },
  { key: 'percent-as-count', label: '백분율을 그대로 곱하기',
    note: '$100$으로 나누지 않고 백분율의 수를 그대로 곱해요.' },
  { key: 'percent-place-value', label: '백분율과 비율 자리 바꾸기',
    note: '$0.15$와 $15$를 같은 것으로 보아 자리가 두 칸 어긋나요.' },
  { key: 'part-over-part', label: '기준량을 전체가 아닌 부분으로 잡기',
    note: '비율의 분모에 전체 대신 다른 부분을 놓아요.' },
  // 응용계산
  { key: 'profit-over-price', label: '이익을 판매가로 나누기',
    note: '이익률의 기준이 원가인데 판매가로 나눠요.' },
  { key: 'discount-on-selling-price', label: '할인을 판매가 기준으로 잡기',
    note: '할인율의 기준이 정가인데 할인된 값으로 계산해요.' },
  { key: 'average-of-rates', label: '비율을 그냥 평균 내기',
    note: '농도나 속력처럼 양이 다른 비율을 단순 평균해요.' },
  { key: 'solute-over-solute', label: '농도의 분모를 용질로 잡기',
    note: '농도의 기준이 소금물 전체인데 소금의 양으로 나눠요.' },
  // 수와 식 전반
  { key: 'sign-on-distribute', label: '괄호 앞의 부호를 뒤에 안 나눠 주기',
    note: '괄호를 풀 때 앞의 빼기를 첫 항에만 적용해요.' },
  { key: 'move-without-sign', label: '이항하면서 부호 그대로 두기',
    note: '항을 반대쪽으로 옮기면서 부호를 바꾸지 않아요.' },
  { key: 'count-endpoints', label: '양 끝을 빼거나 겹쳐 세기',
    note: '처음과 끝을 세는지에 따라 하나가 어긋나요.' },
];

const byKey = new Map(misconceptions.map((record) => [record.key, record]));
export const misconceptionKeys = misconceptions.map((record) => record.key);
export const misconceptionOf = (key: string): MisconceptionRecord | undefined => byKey.get(key);
/** What a learner is told they kept doing. The label is about the working, never about them. */
export const misconceptionLabel = (key: string) => byKey.get(key)?.label ?? key;
