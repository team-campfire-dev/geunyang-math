import 'server-only';
import { misconceptions } from '@/shared/misconception';
import { writingGuide } from './writing-guide';

/**
 * What the problem writer and the independent solver are told.
 *
 * The writer's instructions are the writing guide, said as it is, followed by what this one job
 * adds: the shape of each question and the claim the checker computes. Both are fixed text so the
 * prefix is cached across requests; everything that changes per request goes in the user turn.
 */

/** The claim language, condensed from docs/problem-verification.md for someone writing one. */
const claimGuide = `### 주장(solves) 쓰는 법

주장은 「이 문제가 묻는 계산」이다. 답을 다시 적는 것이 아니라 **지문의 수로 계산식을 쓴다**(답이 35/36이면 "35/36"이 아니라 "3/4 + 2/9"). 서버가 그 계산을 해서 정답·보기·예상 오답을 대조한다. JSON 하나를 문자열로 쓴다.

| kind | 언제 | 예 |
|---|---|---|
| value | 값 하나를 계산한다 | {"kind":"value","expression":"3/4 + 2/9"} |
| solve | 방정식(연립 포함)의 해 | {"kind":"solve","equation":"x^2 - 5x + 6 = 0","unknown":"x","select":"largest"} |
| inequality | 부등식의 해, 또는 그 안의 정수 | {"kind":"inequality","inequality":"2x - 3 < 7","variable":"x","select":"count","among":"naturals"} |
| integral | 정적분 | {"kind":"integral","integrand":"3x^2","variable":"x","from":"0","to":"2","antiderivative":"x^3"} |
| expression | 보기가 식인 문제 | {"kind":"expression","expression":"3(x - 2)","variables":["x"]} |
| choose | 「옳은 것은?」「옳지 않은 것은?」 — 보기가 문장일 때 | {"kind":"choose","which":"true"} |
| choose + property | 「소수인 것은?」「무리수가 아닌 것은?」 — 보기가 값이고, 성질을 만족하는 하나를 고를 때 | {"kind":"choose","which":"true","property":"isprime(x)"} |

- 모든 종류에 given(상수의 값, {"a":"3"})과 define(문제가 정의한 함수, {"f(x)":"x^2+1"})을 붙일 수 있다.
- solve의 select: unique(기본, 해가 정확히 하나), all, largest, smallest, positive, negative, sum, product, count. 연립이면 equations와 unknowns를 배열로, 계산할 것을 ask로("ask":"x*y"). 삼각·지수·로그방정식은 where로 구간을 준다("where":"0 <= x < 2pi").
- inequality의 select: set(기본, 해집합), count, sum, max, min. among: integers(기본) 또는 naturals.
- property는 보기의 값을 x에 넣었을 때 1(성질을 만족함) 또는 0이 되는 식이다. 판정 함수 isprime(x), isinteger(x), isnatural(x)(1 이상의 정수), iseven(x), isodd(x), isrational(x)는 참이면 1, 거짓이면 0이다. 「무리수인 것」은 "1 - isrational(x)", 「합성수인 것」은 "isnatural(x - 1) * (1 - isprime(x))"처럼 산술로 묶는다. which가 "true"면 property를 만족하는 보기가 정확히 하나여야 하고, "false"면 만족하지 않는 보기가 정확히 하나여야 한다.
- 판정 함수는 값 계산에도 쓴다: 「1부터 10까지 소수의 개수」는 "sum(isprime(k), k, 1, 10)"이다. 답을 직접 세어 "4"로 쓰지 않는다.
- 판단을 묻는 객관식의 보기는 값으로 쓴다($17$, $\sqrt{7}$, $0.\dot{3}$). 「1은 소수이다」처럼 말로 된 보기는 서버가 읽지 못해 검증되지 않는다.
- 순환소수는 $0.\dot{3}$, $0.\dot{1}\dot{4}$, $0.1\dot{2}$처럼 \dot으로 쓴다.
- choose는 보기마다 참·거짓을 서버가 가린다. 보기는 계산할 수 있는 문장으로 쓴다($\\frac12+\\frac13=\\frac56$, $(a+b)^2=a^2+2ab+b^2$). 말로 된 보기는 서버가 읽지 못한다.
- 객관식 보기는 서버가 읽을 수 있게 쓴다: 값($\\frac{5}{13}$, $x=-3$, $3$개, 12 cm), 해의 목록($x=2$ 또는 $x=3$), 해집합($-4 \\le x \\le -1$), 식($3(x-2)$). 보기끼리 단위를 섞지 않는다.

**식 문법.** 계산기처럼 쓴다. + - * / ^, 곱셈 기호 생략(2x, 3(x-1)), -x^2는 -(x^2). 함수는 괄호와 함께: sqrt cbrt root(x, n) abs exp ln log(x)(상용로그) log(b, x) sin cos tan floor ceil round gcd lcm mod min max, 판정 isprime isinteger isnatural iseven isodd isrational. 경우의 수 n! nCr(n, r) nPr(n, r) nHr(n, r). 통계 mean median var sd(모집단). 미적분 diff(f, x, a) integral(f, x, a, b) limit(f, x, a) sum(f, k, a, b). 상수 pi, e, i. 관계 = < <= > >= !=, 절댓값 |x - 1|.

**각도.** 30°는 언제나 각 π/6이다. 답이 「몇 도」인 수라면 주장에 °를 쓰지 않는다(삼각형의 나머지 각은 "180 - 50 - 60").`;

const misconceptionCatalogue = misconceptions.map((record) => `- ${record.key}: ${record.label}`).join('\n');

export const writerSystem = `${writingGuide}

---

## 이번 일: 문제와 그 검증 자료 쓰기

작성자가 고른 수업과 개념으로 연습 문제를 쓴다. 문제는 사람이 검수하기 전에 두 번 확인된다 — 서버가 「주장」을 계산해 정답·보기·예상 오답을 대조하고, 다른 요청이 지문과 보기만 보고 따로 풀어 정답과 비교한다. 그래서 지문은 **그 화면만 읽고 풀 수 있어야** 하고, 주장은 지문이 묻는 계산과 같아야 한다.

### 문제 하나에 쓰는 것

- prompt: 지문. 학습자가 보는 글 그대로 쓰고 수식은 $...$로 감싼다. 객관식의 보기는 지문에 적지 않고 options에 둔다.
- form: "choice"(보기를 고르는 문제) 또는 "written"(답을 써서 내는 문제).
- options: 객관식의 보기. id는 a, b, c, d 순서, 보기는 4개를 기본으로 한다. 주관식이면 빈 배열.
- answer: 객관식이면 정답 보기의 id. 주관식이면 학습자가 입력하듯 쓴 정답 — 정수(-4), 분수(35/36), 소수(0.25), 제곱근이 든 수(2sqrt(3), 1+sqrt(2)). 문자·단위·순서쌍이 답인 문제는 주관식 칸에 쓸 수 없으니 객관식으로 낸다.
- reducedFraction: 기약분수로 써야만 맞는 문제면 true이고, 그때는 지문에도 같은 조건을 적는다. 아니면 false — 같은 값의 분수와 소수가 모두 맞게 채점된다.
- misreadings: 예상 오답. answer는 객관식이면 보기 id, 주관식이면 그 값. misconception은 아래 목록의 key만 쓴다. expression은 그 오답이 나오는 잘못된 계산을 식 문법으로 쓴 것(분모끼리 더하기라면 "(3+2)/(4+9)"). 맞게 채점될 값이나 입력 칸이 받지 않는 값(정수로 답하는 문제의 분수)에는 이름표를 달지 않는다. 목록에 맞는 이름이 없는 오답 보기는 misreadings에 넣지 않는다.
- solves: 이 문제가 묻는 계산. 아래 「주장」 형식의 JSON을 문자열로 쓴다.
- hints: 힌트 1~2개. 각 힌트는 짧은 글이다.
- solution: 해설. 정답에 닿는 풀이와, 이름표를 단 오답이 왜 나오는지를 쓴다.
- 힌트와 해설의 수식도 지문처럼 $...$로 감싼다($3x=15$). 맨글로 쓴 식은 수식으로 그려지지 않는다.

${claimGuide}

### 오개념 이름표 목록 (key: 이름)

${misconceptionCatalogue}`;

export const solverSystem = `수학 문제를 지문과 보기만 보고 푼다. 풀이는 생각으로 하고, 답만 낸다.

- 객관식이면 고른 보기의 id(a, b, c …)를 낸다.
- 답을 써서 내는 문제면 학습자가 입력하듯 쓴다: 정수(-4), 분수(35/36), 소수(0.25), 제곱근이 든 수(2sqrt(3)). 단위와 말은 붙이지 않는다.
- 지문이 기약분수를 요구하면 기약분수로 쓴다.`;
