# 블라인드 비교

2026-10-21 작성 · 처음 쓴 일: 중2 2학기 기말 범위(도형의 닮음·피타고라스 정리·경우의 수와 확률) 137문항의 해설을 Claude Opus 5.5와 Gemini 4 Argon이 각각 쓰고, 누가 썼는지 가린 채 고른 것.

## 왜 이렇게 하나

「어느 모델이 사람에게 더 잘 설명하는가」는 인상으로 정하면 안 되고, 그렇다고 버리는 비교도 아깝다. 그래서 **비교의 재료를 실제로 쓸 콘텐츠로 고른다.** 두 모델이 같은 문제에 같은 지시로 해설을 쓰고, 고른 쪽이 그대로 씨앗에 들어간다. 진 쪽도 지우지 않고 남겨, 나중에 다시 보거나 섞어 쓸 수 있다.

## 순서

```sh
npm run compare:solutions -- generate --run <이름> --courses similarity,pythagoras,probability
npm run compare:solutions -- blind --run <이름>
# 비교 페이지에서 고른다 → picks.json
npm run compare:solutions -- apply --run <이름>
```

- `generate`는 문항마다 두 모델에 **같은 지시와 같은 요청**을 보낸다(`src/server/explanation.ts`의 `solutionSystem`·`solutionRequest`). 지시는 [작성 지침](lesson-writing-guide.md)에 해설 쓰기를 더한 것이다. 받는 대로 `comparisons/<이름>/candidates.json`에 쓰므로 멈춰도 다시 돌리면 이어서 한다. 실패한 것만 다시 묻는다.
- 받은 해설은 사람이 읽기 전에 자동으로 검사한다(`checkSolution`): 정답을 말했는가, 수식이 닫히고 그려지는가, 수식 안에 한글이 있는가, 보기를 번호로 가리켰는가, 「~습니다」가 섞였는가, 중2에게 제곱근을 썼는가, 너무 긴가. 어느 것도 「좋은 해설」을 뜻하지 않는다 — 그건 고르는 사람이 정한다.
- `blind`는 고르는 화면이 읽을 `blind.json`을 만든다. 문항마다 A·B의 순서를 섞고(실행 이름과 문항 ID로 정해져 다시 만들어도 같다) 모델 이름은 넣지 않는다. 어느 글자가 누구인지는 `key.json`에만 있다. 수식은 MathML로 바꿔 둔다 — 비교 페이지가 KaTeX 글꼴을 불러올 수 없어서다.
- 비교 페이지는 `comparisons/page.html` 하나를 실행마다 새 artifact로 발행하고 `blind.json`을 곁에 둔다. 고른 것은 그 artifact의 저장소(`picks/<문항 ID>`)에 남고, 그것을 `picks.json`으로 옮겨 `apply`한다.
- `apply`는 고른 해설을 `prisma/seed/<코스>.json`의 비어 있는 해설 자리에 넣는다(`--replace`면 있는 것도 바꾼다). 해설은 판본에 얼리지 않으므로 새 `problemVersionId` 없이 배포의 `db:seed`가 반영한다. `result.json`에 모델별·코스별 집계와 메모가 남는다.

## 모델

| 이름 | 호출 | 설정 |
|---|---|---|
| `claude-opus-5-5` | Anthropic SDK, 구조화된 출력 | effort `high`, 서버 측 대체(`fallbacks: "default"`) — 대체된 응답은 `served`에 다른 모델로 남는다 |
| `gemini-4-argon` | Gemini API `generateContent` REST, `responseJsonSchema` | `thinkingLevel: "high"`, 키는 `GEMINI_API_KEY`(헤더로만 보낸다) |

모델을 바꾸거나 더하려면 `src/server/explainers.ts`에 같은 모양(`Explainer`)의 구현을 하나 두고 `generate`의 목록에 넣는다. 해설이 아닌 것(수업 본문, 뜻풀이)을 비교하려면 `explanation.ts`처럼 지시·요청·검사를 한 벌 더 쓰고, 나머지 흐름(이어 하기, 섞기, 고르기, 집계)은 그대로 쓴다.

## 기록

| 실행 | 범위 | 결과 |
|---|---|---|
| `middle2-final-solutions` (2026-10-21) | 중2 기말 137문항 해설 | 274개 모두 써짐(실패·대체 0, 자동 검사 0건). 토큰 Claude 입력 95만(대부분 캐시)·출력 13만, Argon 입력 53만·출력 21만(생각 포함) — 합쳐 약 6달러. 고르는 중 |
