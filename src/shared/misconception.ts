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
  { key: 'average-of-rates', label: '무게를 주지 않고 그냥 평균 내기',
    note: '개수나 양이 다른 것을 섞을 때는 두 값을 더해 둘로 나누면 안 돼요. 합계를 전체로 나눠요.' },
  { key: 'solute-over-solute', label: '농도의 분모를 용질로 잡기',
    note: '농도의 기준이 소금물 전체인데 소금의 양으로 나눠요.' },
  // 소수
  { key: 'decimal-place-shift', label: '소수점 자리를 잘못 맞춰 읽기',
    note: '소수점을 기준으로 자리를 맞추지 않고 숫자만 보아 자릿값이 어긋나요.' },
  { key: 'add-decimals-separately', label: '소수점 뒤를 따로 더하기',
    note: '소수점 앞뒤를 따로 더해서 받아올림이 자리를 넘어가지 않아요.' },
  { key: 'longer-decimal-is-bigger', label: '자릿수가 많은 소수가 크다고 보기',
    note: '소수점 아래가 길수록 큰 수라고 보아요. 앞자리부터 견주어야 해요.' },
  // 소인수분해
  { key: 'one-as-prime', label: '$1$을 소수로 보기',
    note: '약수가 $1$과 자기 자신뿐이라는 말을 $1$에도 적용해요.' },
  { key: 'composite-as-prime', label: '합성수를 소수로 보기',
    note: '홀수이거나 작아 보이면 소수로 여겨 나누어떨어지는 수를 찾지 않아요.' },
  { key: 'prime-as-composite', label: '소수를 합성수로 보기',
    note: '$1$과 자기 자신 말고 나누는 수가 있는지 확인하지 않아요.' },
  { key: 'two-not-prime', label: '$2$는 짝수라 소수가 아니라고 보기',
    note: '짝수는 모두 합성수라고 보아 $2$를 빼놓아요.' },
  // 정수와 유리수
  { key: 'negative-not-integer', label: '음수는 정수가 아니라고 보기',
    note: '정수를 $0$과 자연수까지로만 보아요.' },
  { key: 'zero-not-integer', label: '$0$은 정수가 아니라고 보기',
    note: '$0$을 수가 아닌 것처럼 다루어 정수에서 빼놓아요.' },
  { key: 'zero-as-positive', label: '$0$을 양수로 보기',
    note: '$0$은 양수도 음수도 아닌데 부호가 없는 수를 양수로 여겨요.' },
  { key: 'compare-by-absolute', label: '부호를 빼고 크기로만 견주기',
    note: '$-7$과 $-2$처럼 부호가 있는 수를 절댓값으로만 견주어요.' },
  // 문자와 식
  { key: 'number-after-letter', label: '곱셈 기호를 지우고 수를 문자 뒤에 쓰기',
    note: '$x\\times5$는 $5x$로 써요. 수가 앞이고 문자가 뒤예요.' },
  { key: 'product-as-sum', label: '곱을 합으로 바꾸기',
    note: '곱셈 기호를 지우는 것을 더하기로 바꾸는 것으로 읽어요.' },
  { key: 'minus-inside-square', label: '$-x^2$을 $(-x)^2$로 읽기',
    note: '거듭제곱이 부호까지 포함한다고 보아요. 괄호가 없으면 제곱이 먼저예요.' },
  { key: 'like-terms-by-coefficient', label: '계수가 같으면 동류항으로 보기',
    note: '동류항은 문자와 차수가 같아야 해요. 계수는 상관없어요.' },
  // 원가·농도·속력·일률·이자 (값으로 적는 문항이라 예상 오답도 값이다)
  { key: 'part-instead-of-total', label: '붙이거나 깎을 값만 답하기',
    note: '정가는 원가에 이익을 더한 것이고 판매가는 정가에서 할인을 뺀 것인데, 더하거나 빼기 전의 값만 답해요.' },
  { key: 'combine-percents-additively', label: '백분율을 더하고 빼서 합치기',
    note: '$20\\%$ 올린 뒤 $10\\%$ 내린 것은 $10\\%$ 오른 것이 아니에요. 기준이 달라져요.' },
  { key: 'dilution-ignored', label: '물이 늘거나 줄어도 농도는 그대로라고 보기',
    note: '소금의 양은 그대로여도 소금물 전체가 달라지면 농도가 달라져요.' },
  { key: 'minutes-as-decimal', label: '몇 분을 소수로 그대로 쓰기',
    note: '$30$분은 $0.3$시간이 아니라 $0.5$시간이에요.' },
  { key: 'minutes-as-hours', label: '분을 시간으로 바꾸지 않기',
    note: '시속에 곱할 것은 시간이라, 분은 $60$으로 나눠 시간으로 바꾼 뒤 곱해요.' },
  { key: 'add-days-together', label: '걸리는 날을 더하거나 평균 내기',
    note: '함께 하면 더 빨라져요. 더하는 것은 날이 아니라 하루치 일의 양이에요.' },
  { key: 'single-period-interest', label: '기간을 곱하지 않기',
    note: '단리는 해마다 같은 이자가 붙으니 햇수를 곱해야 해요.' },
  { key: 'annual-rate-for-period', label: '기간에 맞춰 이자율을 나누지 않기',
    note: '연 이자율은 한 해 몫이라, 몇 달만 맡기면 그만큼만 셈해요.' },
  // 자료해석
  { key: 'percent-point-confusion', label: '%p와 %를 섞어 쓰기',
    note: '$8\\%$에서 $10\\%$로 오른 것은 $2$%p이고, 비율로는 $25\\%$ 오른 거예요.' },
  { key: 'change-over-later', label: '증감률을 나중 값으로 나누기',
    note: '증감률의 기준은 이전 값이에요. 변한 양을 이전 값으로 나눠요.' },
  { key: 'reads-beyond-the-table', label: '표에 없는 것까지 단정하기',
    note: '표가 말하는 것과 그것으로 짐작한 것을 갈라 두세요.' },
  { key: 'misses-what-the-table-holds', label: '표에 있는 것을 없다고 보기',
    note: '합계나 증가량처럼 표의 값끼리 셈해서 알 수 있는 것도 표가 말하는 것이에요.' },
  { key: 'baseline-not-zero', label: '눈금이 $0$에서 시작하지 않는 것을 지나치기',
    note: '막대의 높이 차이가 커 보여도 눈금의 시작이 $0$이 아니면 실제 차이는 작을 수 있어요.' },
  { key: 'stacked-top-as-value', label: '누적 막대의 꼭대기를 그 칸의 값으로 읽기',
    note: '위쪽 칸의 값은 꼭대기에서 아래 경계를 뺀 만큼이에요.' },
  { key: 'highest-for-fastest', label: '가장 큰 값을 가장 많이 늘어난 곳으로 보기',
    note: '얼마나 늘었는지는 점의 높이가 아니라 선의 기울기예요.' },
  // 기초통계
  { key: 'same-mean-same-spread', label: '평균이 같으면 흩어짐도 같다고 보기',
    note: '평균이 같아도 값들이 얼마나 퍼져 있는지는 다를 수 있어요.' },
  { key: 'always-the-mean', label: '상황에 상관없이 평균을 고르기',
    note: '가장 많이 나온 값은 최빈값이고, 크게 튀는 값이 섞였을 때는 중앙값이 자료를 더 잘 대표해요.' },
  // 부등식
  { key: 'strict-for-inclusive', label: '「이하·이상」을 「미만·초과」로 읽기',
    note: '「크지 않다」에는 같은 경우도 들어가는데 그것을 빼고 읽어요.' },
  { key: 'flip-inequality-direction', label: '부등호를 반대로 읽기',
    note: '어느 쪽이 큰지를 반대로 잡아요.' },
  { key: 'flip-on-any-multiply', label: '곱하기만 해도 방향이 뒤집힌다고 보기',
    note: '방향이 뒤집히는 것은 음수를 곱하거나 나눌 때뿐이에요.' },
  { key: 'swap-sides-keep-sign', label: '좌우를 바꾸면서 부등호는 그대로 두기',
    note: '양쪽을 맞바꾸면 부등호도 함께 돌아야 같은 뜻이에요.' },
  // 연립방정식과 함수
  { key: 'substitute-without-brackets', label: '대입할 때 괄호를 치지 않기',
    note: '식을 통째로 넣는 것이라 괄호가 없으면 앞의 곱이 첫 항에만 걸려요.' },
  { key: 'scale-one-side', label: '한쪽 변에만 곱하기',
    note: '계수를 맞추려고 곱할 때는 양변 모두에 곱해야 식이 그대로예요.' },
  { key: 'function-as-product', label: '$f(x)$를 곱셈으로 읽기',
    note: '$f(3)$은 $f$와 $3$의 곱이 아니라 $3$을 넣었을 때 나오는 값이에요.' },
  // 좌표와 비례
  { key: 'swap-coordinates', label: '좌표의 앞뒤를 바꿔 읽기',
    note: '앞이 $x$, 뒤가 $y$예요. 순서가 바뀌면 다른 자리가 돼요.' },
  { key: 'axis-point-in-quadrant', label: '축 위의 점도 사분면에 든다고 보기',
    note: '축 위의 점은 어느 사분면에도 들지 않아요.' },
  { key: 'direct-inverse-swap', label: '정비례와 반비례를 바꿔 보기',
    note: '정비례는 몫이, 반비례는 곱이 일정해요.' },
  { key: 'proportional-as-squared', label: '정비례를 제곱으로 보기',
    note: '두 배가 되면 두 배가 되는 것과 네 배가 되는 것을 섞어요.' },
  // 자료의 정리
  { key: 'count-over-rate', label: '수가 많으면 비율도 높다고 보기',
    note: '크기가 다른 집단은 도수가 아니라 상대도수로 견주어야 해요.' },
  // 수와 식 전반
  { key: 'move-a-factor', label: '곱한 수를 이항으로 옮기기',
    note: '곱해진 수는 옮기는 것이 아니라 양변을 그 수로 나누어 떼어 내요.' },
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
