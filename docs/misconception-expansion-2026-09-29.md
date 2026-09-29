# 오개념 이름표 확대 — 2026-09-29

헷갈림 요약과 기존 모아 풀기가 더 많은 실제 계산 절차를 읽을 수 있도록, 8개 과정의 문항 판본 120개에 예상 오답 이름표 140개를 추가했다. 이 중 109개 판본은 처음 이름표를 받았고 11개는 기존 이름표를 보강했다.

## 근거와 범위

운영 오답 빈도는 이번 작업에서 확인하지 못했다. 연결된 로컬 개발 DB의 기록은 한 계정의 소량 기록이므로 운영 학습자의 분포로 취급하지 않았다. 아래 값들은 **문항에서 잘못된 계산 과정을 직접 재현해 만든 예상 오답**이다. 실제로 자주 관측된 오답이라는 주장은 하지 않는다.

지문·정답·응답 형식·힌트·해설·판본 ID는 그대로이며 `misreadings`만 추가했다. 시작점 확인 은행과 낱말의 뜻만 묻는 문항은 건드리지 않았다. 같은 판본이 여러 문제집에 등장하면 이름표도 동일하게 넣었다. 기본 배포의 `db:seed`가 이름표를 적용하며, 운영 DB를 직접 수정하지 않았다.

저장소의 모든 seed를 **problemVersionId로 중복 제거**한 기준으로 이름표가 있는 판본은 **287 → 396**, 예상 오답은 **419 → 559**다. 전체 2,320개에는 이전 판본과 시작점 확인 은행도 들어가므로 현재 수업의 고유 문항 수와는 다른 집계다.

| 과정 | 변경한 문항 판본 | 처음 이름표를 붙인 판본 | 추가한 예상 오답 |
| --- | ---: | ---: | ---: |
| 분수 | 12 | 1 | 12 |
| 비와 비율 | 22 | 22 | 25 |
| 소수 | 9 | 9 | 9 |
| 정수와 유리수 | 7 | 7 | 8 |
| 문자와 식 | 11 | 11 | 11 |
| 일차방정식 | 31 | 31 | 35 |
| 소인수분해 | 20 | 20 | 32 |
| 인수분해 | 8 | 8 | 8 |
| 합계 | 120 | 109 | 140 |

## 판별 기준

- 이름표는 「어떻게 계산했을 수 있는가」의 단서다. 실제 생각을 확정하는 진단으로 읽지 않는다.
- 새 어휘 다섯 개: 최대공약수·최소공배수 바꾸기, 두 수의 곱을 최소공배수로 쓰기, 약수 개수에서 지수에 1을 빠뜨리기, 약수 개수의 선택지를 곱하지 않고 더하기, 괄호의 첫 항에만 곱하기.
- 정수 입력을 요구하면 `0.4`나 `7.5`는 `invalid`이므로 이름표 후보에서 제외했다. 정수로 받는 백분율 문항을 억지로 바꾸지 않았다.
- 기약분수라는 문장이 있어도 해당 판본이 동치인 미약분 답을 정답으로 받는다면 이름표를 붙이지 않았다. 실제로 기약분수를 요구하는 문항에만 붙였다.
- 약분 이름표는 표기보다 값으로 대조한다. 따라서 안내 문구도 「한 번 나누고 끝냈다」고 단정하지 않고 공약수가 남았는지 확인하도록 바꿨다.

## 추가한 값과 잘못된 계산 과정

아래 표는 검수용 근거다. 문항마다 실제 채점 결과가 `incorrect`이고 해당 오개념 키가 나오는지 검사한다. 대표 계산은 별도의 회귀 테스트에서 다시 계산하고, 발행된 판본의 불변 지문 검증도 유지한다.

| 문항 판본 | 예상 답 | 오개념 키 | 재현한 계산 과정 |
| --- | --- | --- | --- |
| `fraction-equivalence:practice-1:v3` | `1` | `scale-one-part` | 분모만 2→8로 바꾸고 분자 1을 그대로 둠 |
| `fraction-equivalence:practice-3:v3` | `5` | `scale-one-part` | 분자만 3→12로 바꾸고 분모 5를 그대로 둠 |
| `fraction-equivalence:check-2:v3` | `2` | `scale-one-part` | 분모만 7→21로 바꾸고 분자 2를 그대로 둠 |
| `fraction-equivalence:homework-1:v3` | `1` | `scale-one-part` | 분모만 3→12로 바꾸고 분자 1을 그대로 둠 |
| `fraction-addition:practice-2:v3` | `1` | `keep-numerators-on-common` | 분모만 3→15로 통분하고 분자 1을 유지 |
| `fraction-addition:practice-3:v3` | `2/6` | `keep-numerators-on-common` | 분모 6에 분자 1+1만 더함 |
| `fraction-addition:check-2:v3` | `2/12` | `keep-numerators-on-common` | 분모 12에 분자 1+1만 더함 |
| `fraction-addition:homework-2:v3` | `2/12` | `keep-numerators-on-common` | 분모 12에 분자 1+1만 더함 |
| `fractions:drill-6:v1` | `2` | `scale-one-part` | 분모만 5→15로 바꾸고 분자 2를 그대로 둠 |
| `fractions:drill-14:v1` | `2/6` | `keep-numerators-on-common` | 분모 6에 분자 1+1만 더함 |
| `fractions:drill-15:v1` | `2/12` | `keep-numerators-on-common` | 분모 12에 분자 1+1만 더함 |
| `fractions:drill-20:v1` | `4` | `scale-one-part` | 분자만 3→9로 바꾸고 분모 4를 그대로 둠 |
| `ratio-meaning:practice-2:v1` | `4` | `reverse-ratio` | 비교량/기준량 대신 20/5 |
| `ratio-meaning:practice-2:v1` | `1/3` | `part-over-part` | 전체 대신 나머지를 기준으로 5/(20-5) |
| `ratio-meaning:practice-3:v1` | `2/3` | `reverse-ratio` | 비교량/기준량 대신 4/6 |
| `ratio-meaning:homework-2:v1` | `20` | `reverse-ratio` | 비교량/기준량 대신 60/3 |
| `percentage-meaning:practice-3:v1` | `30` | `percent-place-value` | 30%를 100으로 나누지 않고 30로 씀 |
| `percentage-meaning:check-2:v1` | `8` | `percent-place-value` | 8%를 100으로 나누지 않고 8로 씀 |
| `percentage-meaning:homework-2:v1` | `45` | `percent-place-value` | 45%를 100으로 나누지 않고 45로 씀 |
| `percentage-of:practice-1:v1` | `100000` | `percent-as-count` | 5000×20, 백분율을 100으로 나누지 않음 |
| `percentage-of:practice-2:v1` | `3000` | `part-instead-of-total` | 낼 돈 대신 할인액 30000×10/100만 답함 |
| `percentage-of:practice-3:v1` | `1000` | `percent-as-count` | 40×25, 백분율을 100으로 나누지 않음 |
| `percentage-of:check-1:v1` | `120000` | `percent-as-count` | 8000×15, 백분율을 100으로 나누지 않음 |
| `percentage-of:check-2:v1` | `6000` | `part-instead-of-total` | 낼 돈 대신 할인액 24000×25/100만 답함 |
| `percentage-of:homework-1:v1` | `180000` | `percent-as-count` | 6000×30, 백분율을 100으로 나누지 않음 |
| `percentage-of:homework-2:v1` | `10000` | `part-instead-of-total` | 낼 돈 대신 할인액 50000×20/100만 답함 |
| `ratios:drill-4:v1` | `5/2` | `reverse-ratio` | 비교량/기준량 대신 20/8 |
| `ratios:drill-4:v1` | `2/3` | `part-over-part` | 전체 대신 나머지를 기준으로 8/(20-8) |
| `ratios:drill-5:v1` | `10/7` | `reverse-ratio` | 비교량/기준량 대신 50/35 |
| `ratios:drill-5:v1` | `7/3` | `part-over-part` | 전체 대신 나머지를 기준으로 35/(50-35) |
| `ratios:drill-11:v1` | `10000` | `percent-as-count` | 400×25, 백분율을 100으로 나누지 않음 |
| `ratios:drill-12:v1` | `24000` | `percent-as-count` | 1200×20, 백분율을 100으로 나누지 않음 |
| `ratios:drill-13:v1` | `240` | `part-instead-of-total` | 낼 돈 대신 할인액 1200×20/100만 답함 |
| `ratios:drill-14:v1` | `15000` | `percent-as-count` | 5000×3, 백분율을 100으로 나누지 않음 |
| `ratios:drill-18:v1` | `120` | `percent-place-value` | 120%를 100으로 나누지 않고 120로 씀 |
| `ratios:drill-19:v1` | `8` | `add-instead-of-scale` | 가로 3→9에 더한 6을 세로 2에도 더하여 8 |
| `ratios:drill-20:v1` | `18000` | `percent-as-count` | 300×60, 백분율을 100으로 나누지 않음 |
| `decimal-addition:practice-2:v1` | `1.37` | `decimal-place-shift` | 1.2를 1.02로 맞춰 1.02+0.35 |
| `decimal-addition:practice-3:v1` | `-0.17` | `decimal-place-shift` | 0.8을 0.08로 맞춰 0.08-0.25 |
| `decimal-addition:check-1:v1` | `0.30` | `decimal-place-shift` | 0.5를 0.05로 맞춰 0.25+0.05 |
| `decimal-addition:check-2:v1` | `0.89` | `decimal-place-shift` | 2.4를 2.04로 맞춰 2.04-1.15 |
| `decimal-addition:homework-1:v1` | `0.31` | `decimal-place-shift` | 0.6을 0.06으로 맞춰 0.06+0.25 |
| `decimal-addition:homework-2:v1` | `0.30` | `decimal-place-shift` | 1.5를 1.05로 맞춰 1.05-0.75 |
| `decimals:drill-7:v1` | `25/100` | `stop-reducing-early` | 기약분수 요구에서 0.25를 25/100으로 쓴 뒤 약분을 마치지 않음 |
| `decimals:drill-8:v1` | `6/10` | `stop-reducing-early` | 기약분수 요구에서 0.6을 6/10으로 쓴 뒤 약분을 마치지 않음 |
| `decimals:drill-15:v1` | `1.89` | `decimal-place-shift` | 1.4를 1.04로 맞춰 1.04+0.85 |
| `absolute-value:practice-2:v1` | `-2` | `compare-by-absolute` | 절댓값 2<6을 부호가 있는 수의 순서로 사용 |
| `absolute-value:check-2:v1` | `3` | `compare-by-absolute` | 절댓값 3<8을 부호가 있는 수의 순서로 사용 |
| `absolute-value:homework-2:v1` | `-4` | `compare-by-absolute` | 절댓값 4<10을 부호가 있는 수의 순서로 사용 |
| `signed-addition:homework-2:v1` | `0` | `add-denominators` | (-1+1)/(2+4)=0 |
| `integers:drill-16:v1` | `-3/6` | `stop-reducing-early` | 기약분수 요구에서 공약수가 남은 동치분수를 답함 |
| `integers:drill-17:v1` | `-5/10` | `stop-reducing-early` | 기약분수 요구에서 공약수가 남은 동치분수를 답함 |
| `integers:drill-19:v1` | `2/8` | `add-denominators` | (-1+3)/(4+4)=2/8 |
| `integers:drill-19:v1` | `2/4` | `stop-reducing-early` | 기약분수 요구에서 공약수가 남은 동치분수를 답함 |
| `expression-value:practice-1:v1` | `2` | `product-as-sum` | 3×4-5 → 3+4-5 |
| `expression-value:practice-2:v1` | `6` | `product-as-sum` | 5×(-2)+3 → 5+(-2)+3 |
| `expression-value:check-2:v1` | `-5` | `product-as-sum` | (-2)×(-3) → (-2)+(-3) |
| `linear-expression:practice-3:v1` | `2` | `distribute-first-term-only` | 3(x+2)→3x+2 |
| `linear-expression:check-1:v1` | `4` | `distribute-first-term-only` | 2(x+4)-2x→2x+4-2x |
| `linear-expression:homework-1:v1` | `-5` | `sign-on-distribute` | -(x-5)+x→-x-5+x |
| `expressions:drill-10:v1` | `1` | `product-as-sum` | 4×6-9 → 4+6-9 |
| `expressions:drill-11:v1` | `6` | `product-as-sum` | 2×(-3)+7 → 2+(-3)+7 |
| `expressions:drill-18:v1` | `4` | `distribute-first-term-only` | 3(x+4)-3x→3x+4-3x |
| `expressions:drill-19:v1` | `-9` | `sign-on-distribute` | -(x-9)+x→-x-9+x |
| `expressions:drill-20:v1` | `1` | `distribute-first-term-only` | 2(3x-1)→6x-1 |
| `equation-meaning:practice-1:v1` | `16` | `move-without-sign` | x=10+6 |
| `equation-meaning:practice-2:v1` | `-8` | `move-without-sign` | x=-5-3 |
| `equation-meaning:practice-3:v1` | `12` | `move-a-factor` | 2x=14→x=14-2 |
| `equation-meaning:check-1:v1` | `6` | `move-a-factor` | 3x=9→x=9-3 |
| `equation-meaning:check-2:v1` | `5` | `move-without-sign` | x=1+4 |
| `equation-meaning:homework-1:v1` | `-14` | `move-without-sign` | -x=9+5 |
| `equality-property:practice-2:v1` | `2` | `move-without-sign` | x=6-4 |
| `equality-property:practice-3:v1` | `30` | `move-a-factor` | 5x=35→x=35-5 |
| `equality-property:check-1:v1` | `4` | `move-without-sign` | 3x+x=8 |
| `equality-property:check-2:v1` | `12` | `move-a-factor` | -2x=10→x=10-(-2) |
| `equality-property:homework-1:v1` | `6` | `move-without-sign` | 9=4x+2x |
| `linear-equation:practice-1:v1` | `12` | `move-a-factor` | 4x=16→x=16-4 |
| `linear-equation:practice-2:v1` | `8` | `move-without-sign` | 2x=10+6 |
| `linear-equation:practice-3:v1` | `3` | `move-without-sign` | 2x=8-2 |
| `linear-equation:practice-3:v1` | `8` | `move-a-factor` | 2x=10→x=10-2 |
| `linear-equation:check-1:v1` | `10` | `move-without-sign` | x/2=4+1 |
| `linear-equation:check-2:v1` | `-13` | `move-without-sign` | -x=8+5 |
| `linear-equation:homework-1:v1` | `1` | `distribute-first-term-only` | 3(x-2)=x→3x-2=x→x=1 |
| `linear-equation:homework-2:v1` | `3/4` | `move-without-sign` | 4x=2+1 |
| `linear-equation:homework-2:v1` | `-3` | `move-a-factor` | 4x=1→x=1-4 |
| `equations:drill-1:v1` | `24` | `move-a-factor` | 4x=28→x=28-4 |
| `equations:drill-2:v1` | `15` | `move-without-sign` | x=4+11 |
| `equations:drill-4:v1` | `15` | `move-a-factor` | 5x=20→x=20-5 |
| `equations:drill-5:v1` | `-22` | `move-without-sign` | -x=13+9 |
| `equations:drill-7:v1` | `28` | `move-a-factor` | -4x=24→x=24-(-4) |
| `equations:drill-9:v1` | `-6` | `move-without-sign` | x=2-8 |
| `equations:drill-12:v1` | `11` | `move-without-sign` | 7x+4x=12 |
| `equations:drill-14:v1` | `24` | `move-a-factor` | 6x=30→x=30-6 |
| `equations:drill-15:v1` | `1` | `move-without-sign` | 3x=9-6 |
| `equations:drill-16:v1` | `3` | `move-without-sign` | 4x+x=8+7 |
| `equations:drill-16:v1` | `12` | `move-a-factor` | 3x=15→x=15-3 |
| `equations:drill-17:v1` | `-3` | `move-without-sign` | x/3=1-2 |
| `equations:drill-18:v1` | `-16` | `move-without-sign` | -x=10+6 |
| `equations:drill-19:v1` | `5/2` | `move-without-sign` | 2x=4+1 |
| `equations:drill-19:v1` | `1` | `move-a-factor` | 2x=3→x=3-2 |
| `prime-number:practice-3:v1` | `2` | `divisor-count-without-one` | 소인수 지수 [2, 1]를 1 더하지 않고 곱함 |
| `prime-number:practice-3:v1` | `5` | `add-divisor-counts` | 각 지수에 1을 더한 값들을 곱하지 않고 더함 |
| `prime-factorization:practice-3:v1` | `6` | `divisor-count-without-one` | 소인수 지수 [3, 2]를 1 더하지 않고 곱함 |
| `prime-factorization:practice-3:v1` | `7` | `add-divisor-counts` | 각 지수에 1을 더한 값들을 곱하지 않고 더함 |
| `prime-factorization:check-2:v1` | `4` | `divisor-count-without-one` | 소인수 지수 [2, 2]를 1 더하지 않고 곱함 |
| `prime-factorization:check-2:v1` | `6` | `add-divisor-counts` | 각 지수에 1을 더한 값들을 곱하지 않고 더함 |
| `gcd-lcm:practice-1:v1` | `36` | `gcd-lcm-swapped` | 12,18에서 최대공약수 대신 최소공배수를 구함 |
| `gcd-lcm:practice-2:v1` | `6` | `gcd-lcm-swapped` | 12,18에서 최소공배수 대신 최대공약수를 구함 |
| `gcd-lcm:practice-2:v1` | `216` | `product-as-lcm` | 최대공약수로 나누지 않고 12×18 |
| `gcd-lcm:practice-3:v1` | `72` | `gcd-lcm-swapped` | 24,36에서 최대공약수 대신 최소공배수를 구함 |
| `gcd-lcm:check-1:v1` | `12` | `gcd-lcm-swapped` | 24,36에서 최소공배수 대신 최대공약수를 구함 |
| `gcd-lcm:check-1:v1` | `864` | `product-as-lcm` | 최대공약수로 나누지 않고 24×36 |
| `gcd-lcm:homework-1:v1` | `4` | `gcd-lcm-swapped` | 8,20에서 최소공배수 대신 최대공약수를 구함 |
| `gcd-lcm:homework-1:v1` | `160` | `product-as-lcm` | 최대공약수로 나누지 않고 8×20 |
| `factors:drill-3:v1` | `2` | `divisor-count-without-one` | 소인수 지수 [1, 2]를 1 더하지 않고 곱함 |
| `factors:drill-3:v1` | `5` | `add-divisor-counts` | 각 지수에 1을 더한 값들을 곱하지 않고 더함 |
| `factors:drill-10:v1` | `4` | `divisor-count-without-one` | 소인수 지수 [2, 2]를 1 더하지 않고 곱함 |
| `factors:drill-10:v1` | `6` | `add-divisor-counts` | 각 지수에 1을 더한 값들을 곱하지 않고 더함 |
| `factors:drill-11:v1` | `6` | `divisor-count-without-one` | 소인수 지수 [3, 2]를 1 더하지 않고 곱함 |
| `factors:drill-11:v1` | `7` | `add-divisor-counts` | 각 지수에 1을 더한 값들을 곱하지 않고 더함 |
| `factors:drill-14:v1` | `6` | `divisor-count-without-one` | 소인수 지수 [6]를 1 더하지 않고 곱함 |
| `factors:drill-15:v1` | `48` | `gcd-lcm-swapped` | 16,24에서 최대공약수 대신 최소공배수를 구함 |
| `factors:drill-16:v1` | `8` | `gcd-lcm-swapped` | 16,24에서 최소공배수 대신 최대공약수를 구함 |
| `factors:drill-16:v1` | `384` | `product-as-lcm` | 최대공약수로 나누지 않고 16×24 |
| `factors:drill-17:v1` | `45` | `gcd-lcm-swapped` | 9,15에서 최대공약수 대신 최소공배수를 구함 |
| `factors:drill-18:v1` | `2` | `gcd-lcm-swapped` | 6,10에서 최소공배수 대신 최대공약수를 구함 |
| `factors:drill-18:v1` | `60` | `product-as-lcm` | 최대공약수로 나누지 않고 6×10 |
| `factors:drill-20:v1` | `10` | `common-denominator-as-sum` | 공통분모를 6+4로 구함 |
| `gcd-lcm:practice-1:v2` | `36` | `gcd-lcm-swapped` | 12,18에서 최대공약수 대신 최소공배수를 구함 |
| `gcd-lcm:practice-2:v2` | `6` | `gcd-lcm-swapped` | 12,18에서 최소공배수 대신 최대공약수를 구함 |
| `gcd-lcm:practice-2:v2` | `216` | `product-as-lcm` | 최대공약수로 나누지 않고 12×18 |
| `factors:drill-15:v2` | `48` | `gcd-lcm-swapped` | 16,24에서 최대공약수 대신 최소공배수를 구함 |
| `common-factor:practice-1:v1` | `9` | `forgets-to-divide-inside` | 6x+9=3(2x+9) |
| `common-factor:practice-3:v1` | `6` | `forgets-to-divide-inside` | 4x²+6x=2x(2x+6) |
| `common-factor:check-1:v1` | `10` | `forgets-to-divide-inside` | 5x²-10x=5x(x-10) |
| `common-factor:homework-1:v1` | `8` | `forgets-to-divide-inside` | 12x²-8x=4x(3x-8) |
| `factorization:drill-6:v1` | `0` | `square-termwise` | (x+7)²에서 가운데 항을 빼고 x²+49로 전개 |
| `factorization:drill-11:v1` | `12` | `forgets-to-divide-inside` | 8x+12=4(2x+12) |
| `factorization:drill-13:v1` | `6` | `forgets-to-divide-inside` | 9x²-6x=3x(3x-6) |
| `factorization:drill-15:v1` | `15` | `forgets-to-divide-inside` | 10x²+15x=5x(2x+15) |
