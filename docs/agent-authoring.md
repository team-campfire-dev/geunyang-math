# AI 편집 통로

2026-10-22 작성 · 코드 기준: `feat/agent-authoring`

Claude·ChatGPT·Gemini의 **채팅 창**에서 이 서비스를 연결하면, 그 AI가 작성자의 계정으로 수업을 만들고 고치고 검토를 요청할 수 있다. 세 앱이 공통으로 받는 것이 **원격 MCP 서버**라서, 앱 서버(Next.js) 안에 MCP 경로와 그 앞의 OAuth를 두었다. 새 컨테이너는 없다.

작성자가 편집 화면에서 만든 **코드**가 열쇠다. 채팅 앱은 우리 헤더를 붙일 수 없으므로 코드를 매 요청에 싣지 않는다. 앱이 연결을 청할 때 우리 연결 화면이 열리고, 작성자가 거기에 코드를 한 번 넣으면 앱은 그 코드를 대신하는 토큰을 받는다. 코드를 거두면 그 코드로 맺은 연결이 모두 끊긴다.

사람이 편집 화면에서 하는 일과 같은 서버 코드로 일한다. 이 통로가 더하는 것은 **울타리**뿐이다 — 어떤 동작에 닿는지, 발행을 맡겼는지, 저장이 어느 판의 초안 위에서 만들어졌는지.

## 쓰는 법

1. 편집 화면 → 「AI 연결」 → 이름과 기간(1·7·30·90일)을 골라 「코드 만들기」. **코드는 이때 한 번만 보인다.**
2. 같은 화면의 커넥터 주소(`https://<서비스>/api/mcp`)를 채팅 앱에 넣는다.
   - **Claude**: 설정 → 커넥터 → 커스텀 커넥터 추가.
   - **ChatGPT**: 설정의 앱(커넥터)에서 MCP 서버 추가, 인증은 OAuth. 메뉴 이름과 위치는 2026년에 여러 번 바뀌었다.
   - **Gemini**: 웹 앱에서 MCP 서버 주소로 「커스텀 앱」 추가. Google 도움말 기준으로 **미국·만 18세 이상·개인 계정·영어**에서만 열려 있어 한국 계정으로는 지금 안 될 가능성이 크다. 회사 계정은 Gemini Enterprise 쪽 경로가 따로 있다.
3. 앱이 그냥수학의 연결 화면을 연다. 앱 이름과 돌아갈 주소(호스트)를 확인하고 코드를 넣어 「연결하기」.
4. 채팅에서 「중2 일차방정식 수업의 설명을 더 쉽게 고쳐 줘」처럼 말한다. 고친 초안은 편집 화면 초안 목록에 내 이름으로 보이고, 검토 요청이면 「검토 요청」 상태다.
5. 다 쓰면 「거두기」. 「건넨 코드」 목록에 코드마다 연결된 앱이 나온다.

Claude Code·Codex처럼 요청을 직접 보내는 도구에는 「API 안내와 함께 복사」로 코드와 `/api/v1/agent` 안내를 함께 건넨다(아래 「코드를 직접 쓰는 API」). 같은 코드를 MCP 주소에 `Authorization: Bearer gmk_…`로 보내도 된다.

## 무엇을 할 수 있나

코드는 **만든 계정보다 더 할 수 없다.** 역할은 호출마다 다시 읽으므로 계정이 편집 권한을 잃으면 코드도, 그 코드로 맺은 연결도 바로 막힌다.

MCP 도구(발행하지 않는 코드에 25개):

| 묶음 | 도구 |
|---|---|
| 읽기 | `get_guide`(권한·규칙·블록 형식·작성 지침 전문) `list_lessons` `list_concepts` `read_draft` `read_published_lesson` `list_definitions` `wrong_answers` |
| 열기·만들기 | `open_lesson_draft`(열린 초안이 있으면 그것, 없으면 새로) `create_lesson` |
| 고치기 | `update_lesson_info` `add_section` `update_section` `move_section` `remove_section` `add_block` `update_block` `move_block` `remove_block` `add_problem` `update_problem` `move_problem` `remove_problem` |
| 확인·마무리 | `validate_draft` `try_answer` `request_review` |
| 발행을 맡긴 코드만 | `publish_draft` |

고치는 도구는 **한 곳씩** 바꾼다. 서버가 그때의 초안을 읽어 그 자리만 바꾸고, 아래의 「읽은 뒤 바뀌었으면 거절」 검사를 거쳐 저장한 뒤 개요(모든 단계·블록·문항의 이름과 한 줄 요약, 남은 issues)를 돌려준다. 채팅 모델이 긴 수업 JSON을 통째로 다시 써 보내다 깨뜨리는 일을 막으려는 설계다.

뜻풀이 저장은 MCP에 없고, 아래 API에서 발행을 맡긴 코드만 할 수 있다(뜻풀이는 판본이 없어 저장이 곧 노출이다). 닿지 않는 것: 코스 정보·순서, 개념 추가, 시작점 확인, 문제집 이름, 초안 삭제, 역할과 계정, 편집 화면 설정, 「AI로 문제 만들기」(건너편이 이미 모델이고, 이 서비스의 예산을 쓰게 된다).

## MCP와 OAuth

| 경로 | 하는 일 |
|---|---|
| `POST /api/mcp` | MCP Streamable HTTP. 요청 하나에 JSON 응답 하나, 세션 없음. GET·DELETE는 405 |
| `GET /.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728. 자원 `…/api/mcp`, 인가 서버는 이 서비스 |
| `GET /.well-known/oauth-authorization-server` | RFC 8414. S256 PKCE, 공개 클라이언트(`none`), `iss` 응답 지원 |
| `POST /api/oauth/register` | RFC 7591 동적 등록. https(또는 localhost) 주소만 |
| `/oauth/authorize` | 연결 화면. 코드를 받아 `POST /api/oauth/authorize`로 넘긴다 |
| `POST /api/oauth/token` | 인가 코드(+PKCE) 또는 갱신 토큰 → 토큰 |

- **두 세대의 MCP를 한 주소에서 받는다.** 2026-07-28판은 `initialize` 없이 요청마다 `_meta`에 판을 싣고 `MCP-Protocol-Version`·`Mcp-Method`·`Mcp-Name` 헤더가 본문과 맞아야 한다(어긋나면 `-32020`). `server/discover`와 결과의 `resultType`·`ttlMs`·`cacheScope`가 있다. 그 전 판(2025-11-25·06-18·03-26)은 `initialize`로 시작하는데, 세션 id는 주지 않는다. 세 앱이 지금 어느 판을 쓰는지는 공식 문서에 없어 둘 다 받는다.
- 토큰 없이 오면 401과 `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="lessons"`. 앱은 이것을 보고 로그인 흐름을 시작한다.
- 액세스 토큰은 1시간, 갱신 토큰은 코드의 만료까지이고 쓸 때마다 바뀐다(이전 것은 곧바로 무효). 인가 코드는 10분, 한 번만 쓴다. 모든 토큰·코드는 해시만 저장한다.
- 모든 리다이렉트 응답(오류 포함)에 `iss`를 붙인다. ChatGPT는 이 표시가 있을 때 고정 콜백 주소를 쓴다.
- **CIMD(클라이언트 메타데이터 문서)는 아직 받지 않는다.** 서버가 앱이 준 URL을 가져와야 해서 SSRF 방어가 따로 필요하다. Claude와 ChatGPT는 CIMD가 광고되지 않으면 동적 등록으로 넘어가고, Gemini는 동적 등록만 쓴다.
- 연결 화면은 다른 사이트 안에 띄울 수 없고(`frame-ancestors 'none'`), 다른 사이트로 주소를 흘리지 않는다(`Referrer-Policy: same-origin`). `no-referrer`로 두면 브라우저가 폼에 `Origin: null`을 보내 연결이 403으로 막힌다.
- MCP 요청의 `Origin`은 없거나, 이 서비스거나, claude.ai·claude.com·chatgpt.com·gemini.google.com일 때만 받는다. 채팅 앱은 자기 서버에서 부르므로 보통 없다.

## 코드를 직접 쓰는 API

`Authorization: Bearer gmk_…` 헤더를 붙일 수 있는 도구용. 편집 화면과 같은 `{ "action": … }` 본문을 받는다.

| 요청 | 돌려주는 것 |
|---|---|
| `GET /api/v1/agent` | 안내: 권한, 작업 순서와 규칙, 동작마다 JSON Schema, 블록 payload 스키마와 예시, 작성 지침 전문 |
| `GET /api/v1/agent?view=workspace` | 편집 화면의 목록에서 역할·설정을 뺀 것 |
| `GET /api/v1/agent?draftId=…` | 초안 하나. `draft.edit`가 저장할 때 보내는 형태 그대로 |
| `POST /api/v1/agent` | 동작 하나. 응답은 그 결과에서 `workspace`를 뺀 것 |

**`draft.save`는 `baseUpdatedAt`(마지막으로 읽은 초안의 `updatedAt`)을 요구한다.** 그 사이 초안이 바뀌었으면 `409 draft_changed`로 거절하고 아무것도 쓰지 않는다. MCP의 고치는 도구는 이 검사를 서버 안에서 한다.

## 저장

`20261022000000_agent_key` migration의 표 세 개.

- `AgentKey`: 코드. SHA-256 해시와 앞 10글자만 둔다. 한 계정에 10개, 기간이 지난 것은 주인이 목록을 볼 때 지운다.
- `AgentClient`: 등록한 채팅 앱(이름, 돌아갈 주소). 누구나 등록할 수 있으니 그 자체로는 아무 권한도 없다. 하루가 지나도록 연결이 하나도 없으면 다음 등록 때 지운다.
- `AgentGrant`: 코드 하나로 맺은 앱 하나의 연결. 인가 코드를 들고 있다가 토큰을 든다. 코드를 지우면(거두기·계정 삭제) 함께 지워진다.

## 운영 반영 때 확인할 것

- `APP_ORIGIN`이 https 서비스 주소여야 한다. 메타데이터의 모든 주소가 여기서 나온다.
- 앱 VM의 프록시(NPM)가 `/.well-known/…` 경로와 `Authorization` 헤더를 그대로 앱에 넘기는지.
- 반영 뒤 바깥에서 `curl https://<서비스>/.well-known/oauth-authorization-server`와, 토큰 없는 `POST /api/mcp`가 401과 `WWW-Authenticate`를 돌려주는지.

## 아직 없는 것

- 호출 횟수 제한.
- 편집 화면의 자동 저장이 AI의 저장을 알아차리는 것. AI 쪽은 거절되지만, 사람이 같은 초안을 열어 둔 채 저장하면 AI가 쓴 것을 덮을 수 있다.
- CIMD, 연결 하나만 끊기(지금은 코드를 거두면 그 코드의 연결이 모두 끊긴다), 뜻풀이 편집 도구.
