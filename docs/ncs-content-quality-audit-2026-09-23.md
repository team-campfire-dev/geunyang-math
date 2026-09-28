# NCS 수업·문제집 품질 조사 — 2026-09-23

## 결론

현재 NCS 콘텐츠는 **처음 배우는 사람을 위한 설명, 독립적으로 풀 수 있는 문항, 믿을 수 있는 채점과 해설을 함께 재설계할 필요가 있다.** 지난 문장 개선 후에도 소제목·그림·힌트·용어사전에는 이전 표현과 잘못된 설명이 남아 있다.

읽기 어려움의 핵심은 다음 네 가지다.

1. 무엇을 계산하는지 설명하기 전에 요령과 결론을 압축해서 말한다.
2. 구체적인 대상 대신 “총량”, “하루치”, “뒤집는다”, “표가 말하는 것” 같은 표현을 반복한다.
3. 필요한 수학 용어의 뜻과 적용 조건이 생략되거나, 본문·그림·문제에서 서로 다르게 설명된다.
4. 막힌 학습자가 다시 배울 수 있는 문항별 풀이가 없고, 일부 문제는 조건·자료·채점 설정 자체에 결함이 있다.

이번 작업은 조사와 개선안 작성이다. 수업·문제·서비스 코드는 수정하지 않았다.

## 처리 현황 — 2026-09-28

P1 정확성 항목 N01~N09를 처리했다. 각 항목 아래에 무엇을 바꿨는지 적었다. 고친 수업·문제집은 새 판본으로 발행되고, 이미 수강을 시작한 사람은 시작한 판본을 그대로 본다. 보기 섞기(N04)와 뜻풀이(N05)는 판본과 상관없이 모두에게 바로 적용된다.

남은 것은 N10~N20(설명·용어·연습 설계)과 1절의 표현 개선, 4·5절의 재작성 방향이다.

## 조사 범위와 확인 방법

2026-09-23 공개 서비스 `/api/version`의 배포 커밋은 `a417511f9532b98c8d8b55796286d461288fef4d`였다. 이전 언어 개선 PR #139가 반영된 상태다. 공개 수업 API로 가져온 21개 수업의 본문 블록 100개는 현재 저장소와 일치했고, 공개 카탈로그의 NCS 문제집 67개 버전도 저장소에서 선택한 최신 버전과 일치했다.

| 코스 | 수업 | 설명·예제·요약 본문 블록 | 현재 문제집 | 중복 버전을 제외한 문항 | 객관식 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 수리능력 시작하기 | 6 | 33 | 19 | 64 | 35 |
| 응용계산 | 6 | 26 | 19 | 62 | 5 |
| 기초통계 | 4 | 19 | 13 | 48 | 7 |
| 자료해석 | 5 | 22 | 16 | 55 | 21 |
| **합계** | **21** | **100** | **67** | **229** | **68** |

- 21개 수업의 제목·요약·소제목·본문·예제·표·그림 문구·장면별 설명·실습 지시를 읽었다.
- 229문항의 발문·보기·힌트·정답·답안 형식을 확인했다. 정수형 152개, 객관식 68개, 유리수형 9개다.
- 공개 수업에 연결된 용어사전 28개를 읽고 본문과 비교했다.
- 서비스 화면에서 단계별 표시 방식, 표가 빠진 문제, 증감률 그림의 오류를 확인했다.
- 의심되는 답안을 실제 `gradeAnswer` 함수에 넣어 채점을 재현했다. 운영 서비스에 답안이나 학습 기록을 저장하지 않았다.
- 이 보고서는 공개 최신 버전 기준이다. 이미 수강을 시작한 사용자는 고정된 이전 버전을 볼 수 있다.
- 전수 독해와 특정 오류 재현을 수행했으며, 모든 기기에서의 화면 검수나 실제 학습자 이해도 실험, 모든 문항의 독립적인 이중 수학 검증까지 수행한 것은 아니다. 시험 출제 빈도에 대한 표현은 출처가 제시되지 않았다는 점을 지적하며, 특정 기관의 출제 통계를 확인한 것으로 해석해서는 안 된다.

## 1. 사용자에게 직접 불편을 주는 표현

아래 표현이 모두 틀린 한국어라는 뜻은 아니다. 수학을 다시 배우는 성인이 계산 대상과 다음 행동을 바로 알아보기 어렵다는 기준으로 골랐다. “가중치”, “중앙값”, “표준편차” 같은 필요한 용어는 유지하고, 처음 나올 때 쉬운 설명과 예시를 붙이는 편이 좋다.

| 현재 표현 | 읽기 어려운 이유 | 개선 예시 |
| --- | --- | --- |
| “비율이 오른 것과 총량이 는 것은 다른 이야기예요.” | “는”에서 읽기가 끊기고 총량이 회사 매출인지 시장 전체인지 불명확하다. | “시장점유율이 높아졌다고 회사 매출도 늘었다고 볼 수는 없어요.” |
| “추이는 꺾은선, 비교는 막대, 구성비는 원그래프.” | 세 가지 분류를 암기하게 하지만 ‘추이’와 ‘구성비’를 설명하지 않는다. | “시간에 따라 값이 어떻게 달라지는지는 꺾은선그래프로, 전체에서 각 항목이 차지하는 비율은 원그래프로 나타낼 수 있어요.” |
| “두 요소의 자리를 찍어 보는 그래프” | 무엇이 요소이고 무엇을 알아내려는지 알 수 없다. | “가로축에는 키, 세로축에는 몸무게를 두고 사람마다 점 하나를 찍으면 두 값의 관계를 살펴볼 수 있어요.” |
| “총량과 비율은 서로를 말해 주지 않아요.” | 서로 다른 개념의 관계를 의인화해 설명한다. ‘전체’와 ‘총량’도 구별하기 어렵다. | “시장점유율만으로는 회사 매출액을 알 수 없어요. 시장 전체 매출액도 알아야 해요.” |
| “두 값을 이으면 셋째 값이 나와요.” | 두 값과 셋째 값이 무엇인지 제목만으로 알 수 없다. | “회사의 매출과 시장점유율로 시장 전체 매출 구하기” |
| “남는 후보가 적을수록 뒤가 가벼워요.” | 비유를 다시 계산 행동으로 번역해야 한다. | “후보를 먼저 줄이면 총점을 계산할 업체도 줄어들어요.” |
| “숫자 하나로 잘리는 조건…대체로 세요.” | ‘잘린다’, ‘세다’가 조건 적용 방법을 설명하지 않는다. | “계산 없이 확인할 수 있는 ‘가격 100만 원 이하’ 같은 조건부터 확인해요.” |
| “하루치를 더해요.” / “역수예요.” | 막힌 사람이 무엇을 더하고 왜 뒤집는지 알기 어렵다. | “A와 B가 하루에 끝내는 일의 비율을 더해요. 걸리는 일수는 전체 일 1을 그 합으로 나누어 구해요.” |
| “얼마짜리 일인지는…말해 줄 필요도 없거든요.” | ‘얼마짜리’는 일의 양보다 금액을 떠올리게 한다. 이유도 충분히 설명하지 않는다. | “전체 작업량을 몰라도, 전체 중 하루에 끝내는 비율을 이용하면 걸리는 시간을 구할 수 있어요.” |
| “바라는 경우는 세 가지예요.” | 불량품이 나오기를 바란다는 뜻처럼 들린다. | “불량품이 나오는 경우는 3가지예요.” 또는 “확률을 구하려는 경우” |
| “자주 걸리는 것 둘” | 어떤 실수를 설명하는 단계인지 모호하다. | “기간의 단위와 구할 금액 확인하기” |
| “엿새”, “닷새”, “날수”, “서넛”, “견주어” | 그 자체로 오류는 아니지만 숫자를 계산해야 하는 문장에서 표현 전환 부담을 더한다. | “6일”, “5일”, “일수”, “3~4개”, “비교해”를 일관되게 사용한다. |
| “품질 항목이 기여하는 점수”, “가중 총점” | 가중치를 막 배운 학습자에게 추상적인 명사 표현이 겹친다. | “품질 점수에 가중치 0.5를 곱하면 몇 점인가요?” |
| “100만 원이 100만큼이에요.” | 무엇을 기준으로 100배인지 설명하지 않는다. | “100만 원은 1만 원의 100배예요. 7백만 원은 700만 원이에요.” |

대표 근거: [ncs-chart-basics:check-2:v1:hint](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:4301), [ncs-chart-basics:kinds:text:v5](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:1551), [ncs-condition:sift:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:1698), [ncs-work:one:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:1054), [ncs-chance:example:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:1667), [ncs-graph:homework-2:v1:hint](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:6205).

### 학습자의 어려움을 단정하는 말

“계산은 초등 수준”, “계산법을 가르치지 않아요”, “틀리는 원인은 계산이 아니라 단위”, “어려운 계산이 아니에요”, “이 둘만 지키면 돼요”가 반복된다. 계산 자체가 어려운 사용자에게는 필요한 설명이 빠졌다는 인상을 주고, 실패 원인을 미리 단정한다.

예를 들어 속력 단원은 “분과 시간이 섞이면 단위를 먼저 맞춰야 해요. 90분은 90÷60=1.5시간이에요”처럼 실제 행동과 계산을 보여 주면 된다. 문장의 쉬움은 내용이 쉽다고 선언하는 것으로 얻어지지 않는다.

근거: [ncs-arithmetic:overview:text:v5](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:600), [ncs-speed:units:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:897), [ncs-frequency:count:text:v2](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:94).

## 2. 우선 수정해야 할 문항·설명 결함

**P1**은 정답 판단, 학습 내용의 정확성, 문제 풀이 가능성에 직접 영향을 주는 항목이다. **P2**는 설명·용어·연습 설계의 개선 항목이다.

### N01 · P1 — 눈금 간격 문제에서 맞는 답을 오답 처리 · 처리됨

> **처리됨 (2026-09-28):** 지문에 「꼭대기 $36$, 다섯에서 여덟 칸」을 적어 답이 $6$ 하나가 되게 했다. 수업 예제가 $6$을 고른 근거와 같다. (`ncs-chart-draw:practice-1:v2`, `ncs-numeracy:drill-22:v2`)

- 대상: `ncs-chart-draw:practice-1:v1`, `ncs-numeracy:drill-22:v1`.
- 12·18·24·30이 모두 눈금에 놓이는 간격을 묻고, 힌트도 “공약수”라고 한다.
- 0에서 시작해 간격을 1, 2, 3, 6으로 잡으면 모두 조건을 만족한다. 그러나 정답은 6 하나로 저장되어 있다.
- 실제 채점 재현: 첫 문항에서 `1`, `2`, `3` 모두 `incorrect`, `6`만 `correct`. 드릴에서도 `2`는 오답이었다.
- 개선: 최대공약수가 목적이면 “0에서 시작하며, 가능한 가장 큰 정수 눈금 간격”을 명시한다. 도표 가독성이 목적이면 간격 후보와 읽기 조건을 주고 적절한 설계를 비교하게 한다.

근거: [ncs-chart-draw:practice-1:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:6120), [ncs-numeracy:drill-22:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:7598).

### N02 · P1 — 점수 계산에서 81.5를 오답 처리 · 처리됨

> **처리됨 (2026-09-28):** 두 문항에서 기약분수 제한을 걷고 「소수로 써도 좋아요」를 적었다. `81.5`·`163/2`·`2.5`·`5/2`가 모두 맞다. 일의 하루치(1/9·1/6·2/3)는 분수 표현이 수업 목표이고 끝나는 소수도 없어 제한을 둔다. (`ncs-condition:check-1:v2`, `ncs-graph:check-2:v2`)

- 대상: `ncs-condition:check-1:v1`.
- 품질 85×0.5 + 가격 70×0.3 + 납기 90×0.2 = 81.5점이다. 본문과 힌트도 소수로 계산한다.
- 답안 설정이 기약분수를 강제해 `81.5`는 오답, `163/2`는 정답이었다.
- 화면에 ‘답안 형식: 기약분수’ 안내는 있다. 따라서 숨겨진 조건 문제로 분류하지 않는다. **점수 계산이라는 학습 목표에 불필요한 분수 변환을 요구하는 설계 문제**다.
- 개선: 값이 같은 소수·분수를 허용하고, 가중치 적용 여부를 평가한다. `ncs-graph:check-2:v1`의 2.5배도 기약분수를 강제하므로 같은 기준으로 재검토한다.

근거: [ncs-condition:check-1:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:6386), [src/core/grading.ts:105](/Users/zeratulspc/Documents/Development/geunyang-math/src/core/grading.ts:105), [src/features/learning/problem-card.tsx:99](/Users/zeratulspc/Documents/Development/geunyang-math/src/features/learning/problem-card.tsx:99).

### N03 · P1 — 문제 화면에 없는 “위 표”를 참조 · 처리됨

> **처리됨 (2026-09-28):** 연습 문항 지문에 업체별 표를 싣고 무엇에 무엇을 곱하는지 적었다. 예제 단계 첫머리에도 같은 표를 두었다. (`ncs-condition:practice-2:v2`, `ncs-condition:v4`)

- 대상: `ncs-condition:practice-2:v1`.
- “위 표에서 C업체…”라고 묻지만 문제에는 표가 없다. 실제 수업 4단계 화면에서도 표 없이 문제 3개만 보였다.
- 현재 화면은 한 번에 한 단계만 보여 준다. 표는 2단계에 있어 사용자가 뒤로 이동해야 한다. 독립 문제집에는 그 설명 단계 자체가 없다.
- 개선: 문제에 업체별 표를 포함하거나 “C업체의 품질 점수는 90점이고 가중치는 0.5…”처럼 필요한 정보를 모두 적는다. 예제 단계에도 사용 중인 표를 함께 배치한다.

근거: [ncs-condition:practice-2:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:6304). [공개 화면](https://geunyang-math.team-campfire.dev/?lesson=ncs-condition&step=4).

### N04 · P1 — 객관식 68개 모두 첫 번째 보기가 정답 · 처리됨

> **처리됨 (2026-09-28):** 콘텐츠 대신 보기를 그리는 곳(`AnswerChoices`)에서 문항 이름으로 섞는다(`src/shared/choice-order.ts`). 전 과정 객관식 380개 중 335개가 첫 보기 정답이었고, 섞은 뒤 자리는 92·117·88·83이다. 오답 보기의 품질 검토는 남았다.

- 현재 229문항 중 객관식 68개 전부 정답 ID가 `a`이고, 표시용 `responseSpec.options`의 첫 항목도 `a`다.
- `AnswerChoices`는 배열 순서를 그대로 출력하며, 서비스의 `publicProblem`도 보기를 그대로 전달한다. 확인한 공개 화면에서도 첫 번째 보기가 정답에 해당했다.
- 내용 이해 없이 첫 보기만 고르는 전략이 통한다. 오답 보기에도 “평균”, “제목을 붙일 수 없다” 등 문맥상 쉽게 제거되는 선택지가 있다.
- 개선: 보기 위치를 분산하거나 안정적으로 섞고, 오답은 실제로 하기 쉬운 계산·판단 실수에서 만든다. 문항 내용과 보기 품질도 함께 검수한다.

근거: [src/features/learning/answer-choices.tsx:27](/Users/zeratulspc/Documents/Development/geunyang-math/src/features/learning/answer-choices.tsx:27), [src/server/learning-service.ts:74](/Users/zeratulspc/Documents/Development/geunyang-math/src/server/learning-service.ts:74), NCS 최신 문제집의 전체 객관식 설정.

### N05 · P1 — 확률 예제·문제에서 독립 조건 누락 · 처리됨

> **처리됨 (2026-09-28):** 예제와 두 문항에 「불량일 확률이 각각 $10\%$이고 서로 영향을 주지 않는 부품 두 개」라고 적고, 뜻풀이 `chance`를 독립일 때에만 곱한다는 말과 돌려놓지 않는 반례로 바꿨다. (`ncs-chance:v4`, `ncs-statistics:drill2-20:v2`, `content/glossary-v42.json`)

- 대상: `ncs-chance:example:text:v3`, `ncs-chance:check-1:v1`, `ncs-statistics:drill2-20:v1`.
- “불량률 10%인 부품 둘을 꺼낼 때”만으로는 두 결과의 독립성이나 복원추출 여부가 정해지지 않는다. 그런데 답은 각각 19%, 1%로 고정된다.
- 반례: 10개 중 불량품 1개가 있는 상자에서 돌려놓지 않고 2개를 뽑으면 ‘적어도 하나 불량’은 20%, ‘둘 다 불량’은 0%다.
- 앞 설명에는 독립 조건을 추가했지만, 예제·문제·사전에는 일관되게 반영되지 않았다. 사전 `chance`에는 “이어지는 일은 확률을 곱해요”가 남아 있다.
- 개선: 독립인 두 제품을 검사한다고 명시하거나, 한 개씩 확인 후 되돌려 넣고 다시 뽑는다고 적는다. 경우의 수 곱셈과 확률 곱셈도 구별해서 설명한다.

근거: [ncs-chance:example:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:1667), [ncs-chance:check-1:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:3719), [ncs-statistics:drill2-20:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:4752).

### N06 · P1 — 증감률 그림에 “700 < 400?”가 표시됨 · 처리됨

> **처리됨 (2026-09-28):** 본문과 그림을 가 지점 $1{,}000\to1{,}200$($200$, $20\%$), 나 지점 $100\to150$($50$, $50\%$)으로 다시 만들었다. 막대마다 이전·나중을 적고, 그림을 「늘어난 비율」 단계로 옮겼다. (`ncs-data-change:v5`)

- 대상: `ncs-data-change:growth:drawing:v4`.
- C지점 증가량은 700, A지점은 400인데 그림에는 “700 < 400?”가 나온다. 의도적인 오개념 질문이라는 안내나 바로잡는 설명도 없다. 공개 화면의 2번째 장면에서 직접 확인했다.
- 그림의 공통 캡션은 “늘어난 양이 같아도…”지만 두 증가량은 같지 않다. 본문은 증가량과 증가율의 순위가 다를 수 있다고 말하면서, 예시는 둘 다 C가 크다.
- 개선: 실제로 순위가 뒤집히는 자료로 본문·그림·예제를 함께 만든다. 예: A는 1,000→1,200(200 증가, 20%), B는 100→150(50 증가, 50%). 각 막대가 이전 값·나중 값·증가량 중 무엇인지 명시한다.

근거: [ncs-data-change:growth:drawing:v4](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:569). [공개 화면](https://geunyang-math.team-campfire.dev/?lesson=ncs-data-change&step=3).

### N07 · P1 — 지점 크기가 다르면 단순 평균을 쓸 수 없다고 읽힘 · 처리됨

> **처리됨 (2026-09-28):** 무엇의 평균인지를 먼저 보게 하고, 크기를 따지는 경우(직원 수가 다른 지점의 1인당 판매량을 합칠 때)는 따로 말해 가중평균으로 넘겼다. (`ncs-why:v5`)

- 대상: `ncs-why:example:text:v4`.
- “네 지점의 평균 판매량”에서 먼저 “지점마다 크기가 같은지, 즉 단순 평균으로 되는지” 확인하라고 한다.
- 지점별 판매량의 평균은 지점 크기와 관계없이 판매량 합계÷4다. 집단별 평균을 합칠 때 그 집단의 인원수를 반영하는 문제와 섞였다.
- 개선: 평균의 대상과 단위를 먼저 명시한다. 가중평균은 “직원 수가 다른 두 지점의 1인당 평균 판매량을 합치는 경우”처럼 별도 예제로 설명한다.

근거: [ncs-why:example:text:v4](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:397).

### N08 · P1 — “표에 없으면 알 수 없다”를 정답으로 가르침 · 처리됨

> **처리됨 (2026-09-28):** 문항에 A사 매출·점유율 표를 싣고 「이 표만으로는 알 수 없는 것」을 고르게 했다. 정답은 직원 수, 오답은 표로 계산되는 시장 전체 매출·증가량·오른 폭이다. (`ncs-data:drill2-12:v2`)

- 대상: `ncs-data:drill2-12:v1`.
- “표에 없는 항목에 대해 물으면…”의 정답이 무조건 “알 수 없다”, 힌트도 “표에 없는 것은 읽지 않아요”다.
- 같은 코스는 매출과 점유율로 표에 없는 시장 전체 매출을 구하도록 가르친다. 합계·평균·증가율도 표에 직접 적혀 있지 않아도 계산할 수 있다.
- 개선: 실제 표를 제공하고 “매출과 점유율만으로 직원 수를 알 수 있는가”처럼 **계산 가능한 값과 추가 정보가 필요한 값**을 구별하게 한다.

근거: [ncs-data:drill2-12:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:7160), [ncs-data-compare:join:text:v4](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:845).

### N09 · P1 — 가장 가파른 선을 증가량 최대 구간으로 일반화 · 처리됨

> **처리됨 (2026-09-28):** 본문은 구간마다 값을 빼 비교한다고 먼저 말하고, 가로축이 같은 간격일 때만 「가장 가파르게 올라간 곳」으로 고를 수 있다고 적었다. 두 문항에 같은 간격 조건을 넣고 오답 「선이 가장 긴 곳」을 「가장 가파르게 내려간 곳」으로 바꿨다. (`ncs-graph:v3`, `ncs-graph:practice-3:v2`, `ncs-data:drill2-16:v2`)

- 대상: `ncs-graph:kinds:text:v2`, `ncs-graph:practice-3:v1`, `ncs-data:drill2-16:v1`.
- “선이 가장 가파른 곳”은 감소 구간도 포함한다. ‘가장 가파르게 올라가는 곳’이라고 해도 가로 간격이 다르면 증가량 최대와 일치하지 않는다.
- 예: (0,0)→(1,10)은 증가량 10, 기울기 10이고 (1,10)→(3,25)는 증가량 15, 기울기 7.5다.
- 개선: “가로축에서 같은 기간을 같은 간격으로 표시한 그래프”라는 조건을 붙이고 양 끝 값의 차이로 먼저 비교한다. 이후 같은 간격에서는 상승 기울기로 빠르게 비교할 수 있다고 설명한다.

근거: [ncs-graph:kinds:text:v2](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:1510), [ncs-graph:practice-3:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:5885).

### N10 · P2 — 정가만 주고 실제 이익을 물음

- 대상: `ncs-applied:drill2-2:v1`.
- 원가 8,000원, 정가 10,000원만으로 “이익”을 묻는다. 정가대로 판매했다는 조건이 없어 이후에 가르치는 할인 개념과 충돌한다.
- 개선: “정가 10,000원에 판매했다면” 또는 “정가에 포함된 원가 대비 이익”이라고 적는다. 이익률도 “이 수업에서는 원가를 기준으로 한 이익률”로 계산 기준을 명시한다.

근거: [ncs-applied:drill2-2:v1:prompt](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:5096), [ncs-price:cost:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:102).

## 3. 설명을 다시 구성해야 할 부분

### N11 · P1 — 모든 문항에 풀이 해설이 없음

229문항 모두 `solution: []`다. 힌트는 모두 있지만 “곱해요”, “나눠요”, “역수예요”, “환율이 올랐어요” 정도로 끝나는 사례가 있다. 짧은 힌트 자체가 문제는 아니지만, 그 힌트로 이해하지 못했을 때 볼 수 있는 계산 과정이 없다.

현재 서비스는 풀이 기능을 지원한다. `solutionAvailable`은 풀이가 비어 있으면 false이고, 풀이 버튼도 표시되지 않는다. 오답별 피드백 설정이 있는 문항은 55개지만, 이 피드백은 완결된 풀이를 대신하지 못한다.

개선 기준: 문항마다 **주어진 값 → 구할 값 → 기준·공식 선택 이유 → 수 대입 → 계산 → 단위를 포함한 답 → 흔한 오답과의 차이**를 제공한다. 힌트는 첫 행동을 안내하고 풀이와 역할을 구별한다.

근거: [src/server/learning-service.ts:74](/Users/zeratulspc/Documents/Development/geunyang-math/src/server/learning-service.ts:74), [src/features/learning/problem-card.tsx:84](/Users/zeratulspc/Documents/Development/geunyang-math/src/features/learning/problem-card.tsx:84), NCS 최신 229문항의 `solution`.

### N12 · P1 — 단계가 바뀌면 자료가 사라지는 수업 구조

현재 화면은 `document.sections[sectionIndex]` 하나만 출력한다. 인쇄물처럼 “위 표”, “이 표”, “같은 표”를 쓰면 바로 앞에 자료가 있는 것처럼 읽히지만 실제로는 다른 화면에 있다.

대표 사례:

- 표 읽기 예제는 “같은 표”로 세 가지 질문을 풀지만 그 단계에 표가 없다.
- 증감률 예제는 이전 수업의 A~D 지점 자료를 참조하며 전체 표를 보여 주지 않는다.
- 자료 비교 예제의 “이 표”는 앞 단계의 지점 매출표인지 더 앞의 A사 매출·점유율 설명인지 혼동된다. 해당 예제에는 시장표가 없다.
- 그래프 읽기 예제는 1월·4월·5월의 점과 기울기를 설명하지만 예제 단계에 그래프가 없다.
- 조건 선택 예제와 직접 연습은 다른 단계의 업체 표를 참조한다.

개선: 예제·문항 하나를 독립된 화면으로 보고, 그 화면에 필요한 자료를 모두 제공한다. 긴 자료는 고정된 참고 표로 열어 볼 수 있게 하거나 각 단계에 재사용 블록을 둔다.

근거: [src/features/learning/learning-workspace.tsx:1135](/Users/zeratulspc/Documents/Development/geunyang-math/src/features/learning/learning-workspace.tsx:1135), [ncs-data-reading:example:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:408), [ncs-graph:example:text:v2](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:1587), [ncs-data-compare:example:text:v4](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:1047).

### N13 · P2 — 이전 본문에 맞춘 소제목이 남음

| 수업 | 남아 있는 제목 | 문제 |
| --- | --- | --- |
| 수리능력 소개 | 시험이 재는 것은 수학 실력이 아니다 | 업무에 필요한 계산 능력을 배운다는 본문과 어울리지 않는 단정 |
| 기초연산 | 계산이 어려워서 틀리는 게 아니다 | 사용자의 어려움을 단정하고 계산 설명을 생략하는 명분이 됨 |
| 단위환산 단계 | 900이 미터인가 피트인가 | 본문은 2km+500m이며 900·피트 설명은 없음 |
| 도표분석 | 문항이 가장 많은 영역 | 대상 시험이나 근거 없음 |
| 도표작성 | 직접 그리게 하지는 않는다 | 다음 수업은 직접 그리는 실습이며 본문도 이를 안내 |
| 속력 | 틀리는 원인은 계산이 아니라 단위 | 본문은 단위 맞추기로 개선되었으나 제목은 이전 단정 유지 |

개선: 제목을 “길이 단위를 맞춰 더하기”, “전달할 내용에 맞는 도표 고르기”, “분을 시간으로 바꾸기”처럼 해당 단계의 행동으로 쓴다.

### N14 · P2 — 기초 소개에서 너무 많은 개념을 압축

‘수리능력 시작하기’의 안내 시간만 합계 100분이다. 이 과정에서 구거법·할푼리·가중평균·중앙값·표준편차·복합 할인·%p·시장점유율 역산·여러 그래프 종류를 이미 다룬다. 이후 통계·자료해석 과정에서 같은 예제가 다시 등장한다. 현재 목록은 필요한 수업을 골라 들을 수 있으므로 반드시 100분을 먼저 수강해야 한다고 단정하지는 않는다.

- 소개는 네 영역을 실제 짧은 문제로 맛보는 정도로 줄인다.
- 혼합 계산·비율·단위환산은 단계별로 직접 계산하게 한다.
- 구거법·할푼리 같은 추가 규칙은 기본 계산 목표와 별도로 다룰지 우선순위를 재검토한다.
- 표준편차 계산처럼 제곱·제곱근을 요구하는 내용은 선행 설명이나 복습 연결을 제공한다. `ncs-spread`의 선행 개념은 평균·빈도뿐이다.

### N15 · P2 — 분산·표준편차를 계산 절차만으로 설명

`2,4,6 → 평균 4 → 차이 -2,0,2 → 제곱 4,0,4 → 분산 8/3 → √(8/3)`으로 넘어간다. 왜 차이를 그냥 더하지 않는지, 왜 제곱한 뒤 제곱근을 구하는지, 결과를 어떻게 해석하는지 설명이 약하다. 첫 예제가 깔끔한 수로 끝나지 않아 새 기호의 부담도 크다.

개선: 먼저 평균이 같은 두 자료를 점으로 비교한다. 계산을 가르칠 때는 `2,2,6,6`처럼 평균 4, 분산 4, 표준편차 2가 되는 자료로 과정을 보여 준다. 해석과 계산을 단계로 나누고 각각 연습한다.

근거: [ncs-spread:deviation:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:886).

### N16 · P2 — 개념과 공식의 적용 조건을 지나치게 생략

- “같은 횟수인 값이 둘이면 최빈값도 둘”: 같은 횟수뿐 아니라 **가장 높은 빈도**여야 한다. 예를 들어 1,1,2,2,3,3,3의 최빈값은 3 하나다.
- “유난히 큰 값이 있으면 알맞은 대표값은 중앙값”: 보통 구성원의 수준을 설명하는지, 전체 비용을 계산하는지 목적이 필요하다. 무조건 평균을 배제하게 하지 않는다.
- “같은 전체에서 나온 비중들은 더해서 100%”: 서로 겹치지 않으며 전체를 빠짐없이 나눈 항목이라는 조건이 필요하다. 복수 응답 설문은 합계가 100%를 넘을 수 있다.
- 표 읽기의 “전체이면 열, 그 항목이면 행”: 현재 표의 배치에서만 맞다. 가로·세로가 바뀐 표도 제공해야 한다.
- “눈금이 0에서 시작하지 않으면 차이가 커 보인다”: 0보다 큰 값에서 축을 잘라 시작하는 막대그래프 예제로 한정해 설명한다. 시작점·축 범위·그래프 종류를 구별해야 한다.
- “확률 120%면 두 번 센 것”: 계산 실수나 분모 선택 오류도 가능하다. 점검할 원인을 한 가지로 단정하지 않는다.
- 일률의 “마지막에 뒤집는 것”: 남은 일만 처리하는 경우는 `남은 양 ÷ 하루 작업량`이다. 바로 앞 예제는 이 계산을 쓰는데 마지막 문장이 일괄 역수 규칙처럼 읽힌다.

근거: [ncs-spread:mode:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:840), [ncs-frequency:summary:text:v2](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:422), [ncs-data-reading:summary:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:468), [ncs-work:example:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:1220).

### N17 · P2 — 도표작성 수업의 목표와 실습 범위가 다름

본문은 축 최댓값·눈금 간격·제목·단위·기간을 정하라고 하지만, 실습은 이미 정해진 축과 간격에서 막대 높이만 조절한다. 축 최댓값 50, 간격 10을 사용자가 선택할 수 없고 제목·단위 입력도 없다. “끝값은 최댓값보다 커야”와 “30 이상”처럼 기준도 일치하지 않는다.

개선: 실습 목표를 “주어진 축에 값을 표시하기”로 명확히 제한하거나, 수업 목표대로 축·눈금·제목을 선택하는 단계를 추가한다. 적절한 도표에는 여러 답이 가능하다는 점을 반영한다.

근거: [ncs-chart-draw:axis:text:v3](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:2427), [src/features/learning/content-blocks.tsx:430](/Users/zeratulspc/Documents/Development/geunyang-math/src/features/learning/content-blocks.tsx:430).

### N18 · P2 — 말한 능력을 실제 문제로 확인하지 않음

- `ncs-graph`의 연습·확인·복습 7문항은 모두 텍스트뿐이다. 그래프에서 값을 직접 읽는 문항이 없다. 누적 막대도 실제 그림에서 구간 값을 계산하지 않는다.
- `ncs-interest`는 복리 계산식을 가르치지만 연결된 7문항에는 복리 금액 계산이 없다. 드릴의 이자 문항도 단리만 다룬다.
- `ncs-condition`은 실제 후보 표에 여러 조건을 적용해 최종 업체를 선택하는 연습보다, “어떤 조건부터?”, “몇 곳 남나?” 같은 풀이 요령 확인에 치우쳐 있다.
- 농도는 물 추가·증발을 설명한 뒤 ‘혼자 확인하기’에서 농도가 다른 소금물 혼합을 처음 요구한다. 혼합 계산 예제나 단계별 안내가 필요하다.
- 통계 드릴에는 “120건 중 30건이 A유형이라면 A유형은 몇 건?”처럼 답을 그대로 옮기는 문항도 있다. 첫 도입용 확인과 독립적인 숙달 평가를 구별해야 한다.

개선: 학습 목표별로 ‘완전한 예제 → 일부 단계 채우기 → 다른 숫자·자료로 독립 해결 → 오답 해설’을 연결한다. 보기에서 설명 문구를 고르는 것만으로 실무 계산·자료 읽기의 숙달을 판단하지 않는다.

### N19 · P2 — 시험 전략과 빈도에 대한 근거 없는 단정

“문항이 가장 많은 자리”, “시험은 대개 보기가 넉넉히 떨어져”, “보기가 5%쯤 떨어져”, “모든 후보를 따지면 시간이 모자라”, “시험에서는 뒤집은 쪽이 더 많이 나와요”가 본문과 사전에 반복된다. 어떤 기관·시기·유형에 대한 설명인지 출처가 없다.

개선: “보기 사이 차이가 충분히 크다면 어림할 수 있어요”처럼 적용 조건을 말한다. 한 예제에서 유용한 요령을 모든 시험에 통하는 규칙으로 확대하지 않는다. 어림 후 판단할 수 없는 가까운 보기도 함께 연습한다.

### N20 · P2 — 사전에도 같은 어려움이 남음

연결 사전 28개 중 개선된 정의도 있지만, 다음 표현은 본문에서 도움말을 열어도 문제를 해결하지 못한다.

- `chance`: “바라는 경우”, “이어지는 일은 확률을 곱해요”, 확률이 1을 넘으면 무조건 중복 계산이라는 단정.
- `chart-types`: “추이·구성비·두 요소가 만나는 위치”, “이 셋만 확실히 해도 대부분 풀려요”.
- `verification`: “자릿수를 모두 더해 9를 버리고”, “틀린 것을 잡는 그물”. 자릿수의 개수와 각 자리 숫자의 합도 구별해야 한다.
- `table-reading`: 표 배치와 관계없이 전체는 세로로 읽는다는 설명.
- `median-mode`: 최고 빈도 조건 누락, 치수 자료 전체를 ‘수로 더할 수 없는 자료’로 단정.
- `interest`: `a(1+r)^n`에서 a·r·n의 뜻이 사전 안에 없다. 단리의 연 단위 환산과 연복리의 이자 적용 주기를 구별해야 한다.
- `speed`: 정의를 ‘한 시간’에 한정한 뒤 초속으로 넘어가며, 단위만 오류 원인이라고 단정한다.

개선: 개념 사전은 해당 수업을 읽지 않아도 이해할 수 있어야 한다. 뜻·짧은 예·조건·대표적인 혼동을 포함하고, 수업 본문·요약·그림·힌트를 한 묶음으로 검수한다.

사전 원문: [chance](/Users/zeratulspc/Documents/Development/geunyang-math/content/glossary-v38.json:38), [chart-types](/Users/zeratulspc/Documents/Development/geunyang-math/content/glossary-v40.json:323), [verification](/Users/zeratulspc/Documents/Development/geunyang-math/content/glossary-v40.json:283), [table-reading](/Users/zeratulspc/Documents/Development/geunyang-math/content/glossary-v40.json:483), [median-mode](/Users/zeratulspc/Documents/Development/geunyang-math/content/glossary-v40.json:203), [interest](/Users/zeratulspc/Documents/Development/geunyang-math/content/glossary-v37.json:63), [speed](/Users/zeratulspc/Documents/Development/geunyang-math/content/glossary-v40.json:443).

## 4. 수업별 조사 결과

아래 표는 전수 조사 범위와 각 수업에서 우선 개선할 지점을 연결한다. 개별 문장 전체가 모두 나쁘다는 뜻은 아니다.

| 코스 | 수업 | 우선 개선 지점 |
| --- | --- | --- |
| 수리능력 시작하기 | [왜 수리능력을 보는가](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:89) | 지점 크기와 가중평균을 잘못 연결(N07). 시험 영역 분류에 비중이 높고 실제 계산 안내가 적음. |
| 수리능력 시작하기 | [기초연산: 빠르게, 그리고 틀리지 않게](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:576) | 계산이 쉽다는 단정, 본문과 다른 단위환산 제목. 구거법 추가 학습 부담. 계산 순서·검산 절차를 분리해 설명. |
| 수리능력 시작하기 | [기초통계: 대표값과 자료가 흩어진 정도](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:1132) | 평균·가중평균·중앙값·표준편차를 한 수업에 압축. 대표값 선택의 목적과 합계를 구하는 중간 단계 보강. |
| 수리능력 시작하기 | [도표분석: 고르는 눈과, 읽을 때 틀리는 원인](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:1505) | 추이·구성비·점유율·%p 용어 설명, 실제 자료 없이 표를 언급하는 예제, 총량과 비율의 모호한 구별. |
| 수리능력 시작하기 | [도표작성: 자료에 맞는 도표를 고르고 만들기](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:1995) | “직접 그리게 하지는 않는다” 제목 불일치. 그래프 선택·축 설정·왜곡 해석을 실제 자료로 연습. |
| 수리능력 시작하기 | [도표작성 실습: 자료를 옮겨 그려 본다](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-numeracy.json:2405) | 눈금 간격 복수 정답(N01). 축 최댓값 규칙 불일치, 실습에서 정할 수 있는 항목과 수업 목표 차이(N17). |
| 응용계산 | [원가와 정가: 붙인 만큼과 깎은 만큼](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:79) | 원가 기준 이익률임을 명시. 정가만으로 이익을 묻는 드릴 조건 보완(N10). |
| 응용계산 | [소금물의 농도: 녹아 있는 양으로 따지기](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:374) | “물을 1/3만큼 더했다”의 기준을 소금물 전체로 명시. 혼합 계산을 확인 문제 전에 예제로 안내. |
| 응용계산 | [속력·시간·거리: 셋 중 둘을 알면](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:693) | 단위 환산의 실제 나눗셈을 보여 주고 오류 원인 단정을 제거. 역방향 방정식 풀이를 별도 단계로 연습. |
| 응용계산 | [일률: 전체를 1로 두면 하루치가 보인다](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:1009) | 얼마짜리·하루치·뒤집는다는 표현 구체화. 전체 일과 남은 일의 계산을 구별하고 힌트 보강. |
| 응용계산 | [이자: 단리는 원금에만, 복리는 이자에도](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:1309) | 원리합계의 뜻을 반복 연결. 복리 계산 연습 추가(N18), 3개월 이자율을 “3개월 이자가 원금의 몇 %”로 명시. |
| 응용계산 | [환율과 수수료: 어느 쪽으로 바꾸는가](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-applied.json:1743) | 두 돈을 오간다·수수료를 얹는다는 표현 구체화. 곱해요/나눠요 힌트 보강. 수출입 유불리는 조건 없는 일반화를 피함. |
| 기초통계 | [빈도와 비중: 몇 건이고, 몇 %인가](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:71) | 부서별 지출이라고 시작하지만 항목은 인건비·임차료 등 비용 항목임. 비중 합계 100%의 조건 명시. |
| 기초통계 | [평균: 여럿을 하나의 수로](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:456) | 개선된 가중평균 설명은 활용 가능. “뺄셈 하나로 끝난다”의 생략 계산, 평균 역산의 출제 빈도 단정 보완. |
| 기초통계 | [대표값과 흩어진 정도](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:795) | 표준편차의 제곱·제곱근 연결(N15). 최빈값 최고 빈도 조건, 대표값의 사용 목적, “잘하는 날/못하는 날”의 성과 단정 보완. |
| 기초통계 | [경우의 수와 확률: 세어서 나눈다](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-statistics.json:1251) | 독립 조건 누락(N05). 바라는 경우 표현 수정. 단어만으로 덧셈·곱셈을 고르는 규칙과 사전 재작성. |
| 자료해석 | [표에서 값 찾기: 제목·단위·합계](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:90) | 줄/행 표현 통일. 표를 예제 화면에 함께 제공. 표의 방향과 보기 간격에 관한 일반화 제한. |
| 자료해석 | [증감과 증감률: 얼마나 늘었나](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:497) | 그림의 잘못된 부등호·캡션(N06). 증가량과 증가율이 다른 결론을 만드는 사례. 감소율과 음의 증감률 연결 설명. |
| 자료해석 | [부분과 비율로 전체 구하기, 표로 알 수 있는 것 구별하기](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:823) | 회사 매출·시장 전체 매출·점유율의 대상을 명시. 예제에 시장표 제공. 표에 없으면 모른다는 드릴 수정(N08). |
| 자료해석 | [그래프에서 값 읽기: 눈금부터 센다](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:1136) | 실제 그래프를 보고 푸는 문제 추가. 기울기와 증가량 조건(N09). 단위 힌트, 불필요한 분수 형식 보완. |
| 자료해석 | [조건을 걸어 고르기: 지워 나가면 빨라진다](/Users/zeratulspc/Documents/Development/geunyang-math/prisma/seed/ncs-data.json:1676) | 표 누락(N03), 소수 정답 거부(N02), 가중치·납기·점수 표현 설명. 실제 조건으로 업체를 선택하는 연습 추가. |

## 5. 재작성 방향과 완료 기준

### 권장 순서

1. **정확성과 풀이 가능성 복구:** N01~N09, 표 누락, 잘못된 그림, 첫 보기 정답 편중부터 처리한다.
2. **수업 설계 재작성:** 한 단계에서 무엇을 배워 무엇을 풀 수 있어야 하는지 정하고, 자료·예제·연습을 다시 배치한다.
3. **풀이와 힌트 보강:** 문항마다 설명을 따라 답에 도달할 수 있도록 해설을 작성한다.
4. **표현 통일:** 본문뿐 아니라 제목·캡션·표 주석·힌트·사전·오답 피드백까지 같은 기준을 적용한다.
5. **실제 화면 검수:** 독립 수업 단계와 문제집 화면에서 필요한 정보가 모두 있는지 확인한다.

### 새 수업 한 단위의 권장 구조

- 익숙한 상황과 구할 값을 먼저 제시한다.
- 필요한 용어는 그 상황의 숫자로 설명한다.
- 한 번에 새 판단 하나만 추가한다.
- 각 계산에서 그 수를 더하거나 나누는 이유를 적는다.
- 같은 화면에서 표·그림·설명을 함께 볼 수 있게 한다.
- 유도 연습 뒤에는 다른 숫자·배치의 자료를 혼자 풀게 한다.
- 풀이 해설에서 정답뿐 아니라 흔한 오답이 왜 나오는지도 설명한다.

예를 들어 가중평균은 ‘가중치’부터 외우게 하지 않고, **부서별 총점 구하기 → 총점 더하기 → 전체 인원으로 나누기 → 인원수가 반영된다는 뜻을 가중평균으로 이름 붙이기** 순서가 적절하다. 현재 `ncs-mean:weighted`는 이 방향으로 이미 개선되어 있어 활용할 수 있다.

### 재작성 후 검수 기준

- 해당 화면만 읽어도 문제를 풀 수 있는가?
- 문장의 주어·비교 기준·분모·단위가 명확한가?
- 필요한 전문 용어를 지우지 않고 쉬운 말과 예로 설명했는가?
- 공식이 성립하는 조건이 본문·문제·사전에 일관되게 있는가?
- 조건을 만족하는 다른 답을 잘못 거부하지 않는가?
- 답안 형식이 그 수업의 학습 목표와 맞는가?
- 문제에서 배운 능력을 실제로 사용해야 하는가?
- 그림의 수치·축·높이·범례·캡션이 같은 사실을 전달하는가?
- 어려운 사용자가 힌트와 해설을 통해 다음 행동을 알 수 있는가?
- “쉽다”, “이것뿐”, “항상”, “대개” 같은 표현이 설명을 대신하고 있지 않은가?

수정 배포 시에는 현재의 콘텐츠 버전 관리 방식에 따라 새 수업·문제집 버전으로 발행하고, 기존 학습 기록이 참조하는 과거 버전을 보존해야 한다.
