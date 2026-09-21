# geunyang math

수학을 배우려는 누구나 자신의 속도로 배우는 포괄적인 수학 교육 웹 서비스입니다. 수업·학습 기록·복습 과제와 콘텐츠 편집기를 제공하며, 다양한 수학 콘텐츠와 AI 수업 작성으로 확장합니다.

현재 [운영 웹](https://geunyang-math.team-campfire.dev/)에서 **Google 로그인 → 선택형 진단 → 맞춤 추천 → 수업 학습 → 개인 복습 과제 → 제출·기록 복원**을 제공합니다. 2026-09-21 코드 기준은 답을 쓰는 숫자 키패드까지입니다. MySQL 통합 검사와 화면 렌더 검사를 포함한 601개 테스트와 웹·모바일 빌드를 통과했습니다. 실제 배포 버전은 아래 배포 기록에서 별도로 확인합니다. 기능별 구현·후속 범위는 [구현 현황](docs/implementation-status.md), 릴리스별 근거는 [배포 기록](docs/deployment.md#릴리스별-검증-기록)에서 확인합니다.

## 현재 구현

- 기초 과정(분수 · 소수 · 비와 비율)에서 시작해 중학교 과정과 고등학교 1학년으로 이어지는 **코스 31개, 수업 97개** — 고등학교 1학년까지 이었고, **중학교 1·2학년 과정을 온전히 채웠으며**, 중3에 남은 빈 곳(삼각비 · 원의 성질 · 대푯값과 산포도)을 메우는 중
- 코스의 순서는 번들이 적습니다. 아무것도 고르지 않은 학습자는 그 순서만으로 추천받기 때문입니다
- 앞의 답을 따라 다음 문제를 고르는 시작점 확인 — 한 문제의 답이 그 위나 아래 개념까지 함께 정합니다
- 배우려는 과정을 고르면 거기까지 가는 데 필요한 것만 확인하고, 추천도 그쪽을 향합니다
- 시작점 확인 문항 295개가 카탈로그의 개념 148개를 개념마다 둘씩 묻습니다. 은행이 두 배가 되어도 한 사람이 받는 문항 수는 늘지 않습니다
- 모든 수업이 장면으로 움직이는 그림이나 학습자가 끌어다 놓는 활동을 갖춤
- 설명·풀이 예시·연습·확인퀴즈·정리, 수식과 수직선·좌표평면·기하·분수 막대 그림
- 뜻풀이의 맥락 표시, 연결된 개념을 따라 읽는 공유 패널과 모바일 시트, 원래 수업으로 복귀
- 서버에 저장하는 진도·답안·힌트 사용 기록과 결정적인 정수·분수 채점, 평문과 `\frac` 표기 답안 인식
- 수강 완료 시 생성되는 개인 복습 과제, 문항별 답안 저장과 최종 제출
- **연습장에서 문제집을 직접 골라 풀기** — 수업을 열지 않고 문제만 풀고 싶을 때. 코스별로 이름 있는 문제집을 늘어놓고, 푼 기록은 수업에서 푼 것과 똑같이 남습니다
- 코스마다 어느 수업에도 딸리지 않은 **20문항짜리 「모아 풀기」** 문제집이 하나씩 있습니다
- **보기에서 고르는 문항**과 써 내는 문항을 함께 씁니다. 어느 보기가 정답인지는 학습자에게 내려가지 않습니다
- 답을 쓸 때 **숫자 키패드**가 분수 선과 음수 부호를 내주고, 쓴 답을 수식으로 그려 보여 줍니다. 휴대폰 키보드를 함께 띄우지 않고 **대신합니다** — 키보드로 쓰고 싶으면 한 번 눌러 바꿉니다
- 기본 8문제 진단, 선수개념·첫 풀이 기반 추천과 이유·이력, 직접 선택/자동 추천 복귀
- 배우려는 과정·하루 5·10·20분 설정, 새 복습 과제의 문항 수와 1/3일 권장 시점 조정
- DB 기반 코스·수업·진단·개념·뜻풀이, 콘텐츠 import/export/verify와 기존 수강·과제 판본 보존
- Google 웹 로그인, 같은 Google 계정의 학습 기록 복원, 세션 만료·로그아웃
- 화면 크기에 대응하는 공용 UI와 Capacitor용 정적 export 빌드

진단·첫 풀이·선행개념에 따른 규칙 기반 추천과 시간에 맞춘 새 복습 과제를 제공합니다. 수업·진단 문항·개념·용어는 DB에서 읽으며, `/authoring` 화면이나 [콘텐츠 관리 명령](docs/content-management.md)으로 새 판본을 발행합니다. 화면에 아직 없는 것은 일반 이미지·판본 비교이고, AI 호출은 없습니다. 콘텐츠는 대수 줄기를 고등학교 1학년까지 이었고, 지금은 중학교의 도형·확률·통계를 메우는 중입니다. 고등학교 2학년 과정과 전문가 검수는 그다음입니다.

## 로컬 실행

Node.js **22.12 이상인 22.x**, npm, Docker Compose를 사용합니다. `package-lock.json`에 고정된 의존성을 설치합니다. 처음 내려받은 저장소에서 아래 순서로 실행하세요. 기존 `.env`가 있다면 복사 단계를 생략하고 필요한 값만 확인합니다.

```sh
npm ci
cp .env.example .env
docker compose up -d --wait db
npm run db:generate
npm run db:migrate
npm run db:seed
npm run content:publish
npm run content:verify
npm run dev
```

웹은 [http://127.0.0.1:3017](http://127.0.0.1:3017), 개발용 MySQL은 `127.0.0.1:3317`에서 실행됩니다. Compose는 개발 DB만 실행하며 앱 컨테이너나 Oracle 운영 배포를 구성하지 않습니다. 예시 DB 암호는 이 로컬 개발 환경 전용 값입니다.

| 환경 변수 | 용도 |
|---|---|
| `DATABASE_URL` | 앱과 Prisma CLI가 사용하는 MySQL 연결 |
| `APP_ORIGIN` | 고정 OAuth 콜백·복귀 주소와 쓰기 요청 origin 검증. production은 HTTPS, 개발은 loopback만 허용 |
| `GOOGLE_LOGIN_ENABLED` | `true`이고 Google 자격증명·APP_ORIGIN이 유효할 때만 Google 웹 로그인 허용 |
| `GOOGLE_CLIENT_ID` | 이 프로젝트 전용 Google OAuth Web application 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | 서버 전용 Google OAuth 클라이언트 비밀값. 공개 번들에 넣지 않음 |
| `DEV_LOGIN_ENABLED` | `true`일 때 개발용 로그인 허용 조건에 참여 |
| `CONTENT_ADMIN_SUBJECTS` | 콘텐츠 편집·발행 관리자로 볼 Google `sub` 목록(쉼표 구분). 비우면 `ContentAuthor` 행만으로 권한을 정함 |
| `CONTENT_OPEN_ACCESS` | `true`면 `/authoring`을 로그인·권한 없이 연다. 아직 사용자가 없는 배포 전용이며 기본값은 꺼짐 |
| `TEST_DATABASE_URL` | 통합 테스트 전용 DB. 이름이 `_test`로 끝나야 함 |
| `NEXT_PUBLIC_API_ORIGIN` | 모바일 번들이 호출할 원격 API의 HTTPS origin |

개발용 로그인은 **`NODE_ENV=development` + `DEV_LOGIN_ENABLED=true` + loopback 호스트**에서만 열립니다. 매번 새 학습자를 만드는 로컬 도구이며, 로그아웃·만료 후 그 개발 계정을 복구하는 로그인 방식은 없습니다. production에서는 개발용 신규 로그인과 기존 `gm_session` 사용을 모두 거부합니다.

콘텐츠 편집 화면은 `/authoring`이고, **수업을 준비하는 사람이 읽도록** 만들어져 있습니다. 가운데가 학습 화면과 같은 렌더러로 그린 그 수업이라 옆에 따로 미리보기가 없고, 제목과 글은 보이는 자리에서 바로 씁니다. 쓰는 동안 스스로 저장하고 `⌘Z`로 되돌리며, 「해보기」로 학습자가 만날 화면을 그대로 지나 볼 수 있습니다(아무것도 기록하지 않습니다). 오른쪽 칸은 **지금 고른 것 하나**만 다루고, 소개·개념·복습처럼 수업이 자신에 대해 말하는 것은 **「수업 정보」** 화면에 따로 모여 있습니다. 블록 ID·판본 ID 같은 시스템의 이름은 계정 설정 **전문가 모드**를 켤 때만 보입니다. 단계와 블록에 더해 **문항 지문·정답·힌트·해설**과 **용어 풀이**(공통 사전·수업 용어)를 고치고, 단계·블록·문항을 복제하며, 새 수업을 처음부터 시작할 수 있습니다. 작성자는 **검토 요청**으로 넘기고 발행은 관리자가 합니다. 정답이 초안 응답에 실리므로 권한이 있는 계정만 내용을 볼 수 있고, 아무 권한도 주지 않은 배포에서는 누구에게도 열리지 않습니다. 이미 발행된 문항을 고치면 새 `problemVersionId`가 만들어지고 참조가 함께 옮겨갑니다(자세한 규칙은 [DB 콘텐츠 관리](docs/content-management.md)). 권한은 `admin`(모든 초안·발행)과 `author`(자기 초안)이며, **관리자는 화면의 「편집 권한」에서 다른 계정에 역할을 주고 거둡니다** — 환경 변수도 재기동도 필요 없습니다. 아직 관리자가 한 명도 없는 새 배포에서는 `CONTENT_ADMIN_SUBJECTS`에 Google `sub`를 넣어 첫 관리자를 세우고, 그 계정으로 화면에서 역할을 나눠 준 뒤 환경 변수를 비워도 됩니다. 로컬 개발 로그인 계정에는 Google `sub`가 없으므로 `ContentAuthor` 행을 직접 넣어 시험합니다.

`CONTENT_OPEN_ACCESS=true`를 켜면 이 모든 절차 없이 `/authoring`이 로그인 없이 열립니다. 아직 아무도 쓰지 않는 배포에서 혼자 편집할 때를 위한 스위치이고, 켜져 있는 동안에는 **경로를 찾은 누구든 발행·삭제하고 미발행 초안을 볼 수 있습니다.** 이때 저장되는 초안의 작성자는 공용 `open-authoring` 계정입니다. 서비스를 공개하기 전에 끄고, 역할 기반 권한으로 돌아갑니다. 켜진 상태로 첫 요청이 오면 서버 로그에 `content_authoring_open`을 한 번 남깁니다.

Google 로그인은 `GET /api/auth/google/start`에서 시작하고 `GET /api/auth/google/callback`에서 완료합니다. Google Cloud의 **Web application** 클라이언트에 `${APP_ORIGIN}/api/auth/google/callback`을 정확한 승인 리디렉션 URI로 등록한 뒤 세 가지 Google 환경 변수를 설정합니다. 운영 콜백은 `https://geunyang-math.team-campfire.dev/api/auth/google/callback`입니다. 로컬에서 Google 로그인을 시험할 경우 별도로 승인한 loopback 콜백과 그에 맞는 APP_ORIGIN을 사용합니다. `.env.example`의 기본값은 Google 로그인 비활성입니다.

요청 범위는 `openid email profile`뿐입니다. 서버는 일회용 state·브라우저 바인딩, PKCE, nonce와 Google ID 토큰의 서명·issuer·audience·만료·verified email을 검증합니다. 계정은 이메일이 아닌 Google `sub`로 연결하므로 같은 Google 계정으로 재로그인하면 기존 진도·과제를 불러옵니다. 이름이나 이메일이 같아도 개발 계정이나 다른 Google 계정과 자동 병합하지 않습니다. 운영 세션은 7일짜리 `__Host-gm_session` HttpOnly·Secure·SameSite=Lax cookie이며, 재로그인 시 해당 브라우저 세션을 회전하고 로그아웃 시 폐기합니다. Google access/refresh token은 보관하지 않습니다.

Google 클라이언트 비밀값, 인증 코드, ID/access/refresh token, 세션 cookie를 Git·브라우저 저장소·로그에 남기지 않습니다. 프록시의 OAuth 콜백 query 로깅도 별도로 확인해야 합니다. 설정·배포와 검증 상태는 [배포 문서](docs/deployment.md)를 따릅니다.

`POST /api/v1/learning` 요청에는 화면에서 확인한 계정 ID를 `X-Learning-User-Id` 헤더로 보냅니다. 서버는 먼저 cookie 인증과 origin을 검증하고 이 ID가 실제 로그인 계정과 일치해야 본문을 처리합니다. 헤더가 없거나 다른 탭의 로그인으로 계정이 바뀌었으면 `409 account_changed`를 반환하며 저장하지 않습니다. 클라이언트는 이전 계정의 화면·초안을 비우고 세션과 학습 상태를 다시 조회해야 합니다. 이 헤더는 인증 자격증명을 대신하지 않습니다.

운영 DB는 `sslcert=<절대 CA 경로>&sslaccept=strict`로 인증서와 호스트 이름을 검증합니다. 알려지지 않은 옵션이나 검증 완화는 거부하며, 로컬 개발 URL은 기존대로 사용할 수 있습니다. 앱과 migration 계정·환경 파일은 분리합니다.

`GET /api/health`는 DB 연결과 수업·개념·진단 콘텐츠 존재 여부를 확인합니다. 콘텐츠가 없거나 DB에 연결하지 못하면 503을 반환합니다. `GET /api/version`은 앱 버전과 빌드 commit 값을 반환하며, 실제 배포에서는 `NEXT_PUBLIC_BUILD_COMMIT`을 주입해야 합니다.

## 테스트

DB 없이 채점·콘텐츠·공식 Google ID 토큰 검증과 로그인 보호 검사를 실행할 수 있습니다. `TEST_DATABASE_URL`을 지정하지 않으면 MySQL 통합 검사만 건너뜁니다.

```sh
npm run typecheck
npm test
```

통합 테스트는 앱 개발 DB와 구분한 `geunyang_math_test`를 사용합니다. 로컬 Compose의 DB가 준비된 후 한 번 생성하고, 별도로 migration을 적용합니다.

```sh
docker compose exec -T db mysql -uroot -plocal-root-only <<'SQL'
CREATE DATABASE IF NOT EXISTS geunyang_math_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON geunyang_math_test.* TO 'geunyang'@'%';
SQL

DATABASE_URL=mysql://geunyang:local-development-only@127.0.0.1:3317/geunyang_math_test npm run db:migrate
DATABASE_URL=mysql://geunyang:local-development-only@127.0.0.1:3317/geunyang_math_test npm run db:seed
TEST_DATABASE_URL=mysql://geunyang:local-development-only@127.0.0.1:3317/geunyang_math_test npm test
```

통합 검사는 연결 전에 테스트 DB명을 확인하고, 새 테스트 사용자와 개인 scope를 만듭니다. 기본 콘텐츠는 전체 migration 이후 `db:seed`와 `content:publish`로 설치합니다. 학습 테스트 fixture는 기존 판본을 유지하고 없는 판본만 추가하며, 판본 보존 검사에서는 해시도 비교합니다.

**각 검사는 자기가 넣은 것을 끝나고 지웁니다.** 시작할 때 이미 있던 행을 적어 두고, 끝날 때 그 뒤에 생긴 판본·개념·용어와 자기가 만든 학습자와 그 학습자의 기록을 지웁니다. 자기가 넣지 않은 행은 건드리지 않으므로 기본 콘텐츠와 다른 검사의 행은 그대로 있고, truncate·drop·일괄 삭제도 하지 않습니다. 반복 실행해도 실행 전에 설치되어 있던 콘텐츠는 보존됩니다.

발행된 판본은 앱이 지우지 않는 것이라, 이 정리가 없으면 실행할 때마다 판본이 쌓이고 1000개를 넘는 순간 번들 상한에 걸려 콘텐츠 검사가 통째로 실패합니다. 실제로 한 번 겪었고, 그때는 테스트 DB를 지우고 다시 만들어 넘어갔습니다.


콘텐츠 검사는 DB만으로 새 콘텐츠 제공, 내보내기·재등록·dry run, 잘못된 참조·불변 판본 거부와 기존 수강·과제의 판본 고정을 확인합니다. 개인화 검사는 진단 재접속·계정 격리·첫 풀이 기반 추천·직접 선택·기존 과제 보존을 확인합니다. 학습 검사 범위는 사용자 간 접근 차단, 배정 문항 확인, 단계 순서, 중복·동시 요청, 힌트 전후의 판정, 수강 완료와 과제 생성, 확정 제출 보존, 독립 과제와 수업 판본 고정입니다. Google 인증에는 위조 서명·잘못된 audience·만료·nonce, 일회용 callback의 동시 소비, 동시 첫 로그인 시 계정 중복 방지, 세션 회전·로그아웃 CSRF와 개발 계정 분리 검사가 포함됩니다. 자동 테스트는 실제 Google 계정으로 진행하는 동의 화면·브라우저 로그인을 대신하지 않습니다.

화면 렌더 테스트는 `tests/*.test.tsx`에 있고 jsdom에서 실제 컴포넌트를 그려 확인합니다. DB가 필요 없어 `npm test`만으로 돌아갑니다. 새로 쓸 때는 파일 첫 줄에 `// @vitest-environment jsdom`을 적고, `@testing-library/react` 대신 [tests/render.tsx](tests/render.tsx)를 가져옵니다 — jsdom에 없는 `matchMedia`를 채우고 검사마다 화면을 정리합니다. 서버가 필요한 화면은 `fetch`를 대신 세워 실제 API 클라이언트를 그대로 지나게 합니다 — 클라이언트 모듈을 흉내 내면 서버에 대한 설명을 검사하게 되고, `fetch`를 답하게 하면 서버가 한 일(초안을 다시 말해 주는 것, 저장을 거절하는 것)을 검사가 직접 정할 수 있습니다. 자동 저장처럼 시간이 걸리는 것은 가짜 타이머로 밀며, 이때 `waitFor`는 그 타이머 위에서 돌지 않으므로 쓰지 않습니다. 요소는 CSS 클래스가 아니라 화면에 보이는 이름(역할·레이블·문구)으로 찾습니다. 그래야 검사가 학습자와 작성자가 실제로 만나는 것을 붙잡고, 스타일을 고쳤다는 이유로 깨지지 않습니다. 브라우저의 실제 레이아웃·CSS는 이 검사가 대신하지 않습니다.

## 파일럿 기록 집계

학습 기록에서 좁은 파일럿의 지표를 집계합니다. **읽기만 하며 아무것도 쓰지 않습니다.**

```sh
npm run pilot:report -- --out report.json
npm run pilot:report -- --out report.json --from 2026-10-01 --to 2026-10-15
```

수업 완주율과 멈춘 단계, 문항별 첫 풀이 결과와 힌트 열람, 복습 제출과 지연, 진단 완주, 다른 날 다시 푼 사람 수를 셉니다. **누구인지는 나오지 않습니다** — 이름도 id도 그 해시도 넣지 않고 수만 셉니다. 다만 **채점기가 읽지 못한 답안 원문**은 그대로 나옵니다. 사람들이 실제로 무엇을 써 넣는지가 파일럿이 알아내려는 것이기 때문입니다.

그래서 이 파일은 학습자의 글을 담습니다. 0600으로 쓰고 이미 있는 파일은 덮어쓰지 않으며, 내용을 화면에 찍지 않습니다. 운영 DB에 대해 돌릴 때는 migrator 이미지의 `DATABASE_URL`을 씁니다.

## 웹·모바일 빌드

```sh
npm run build
NEXT_PUBLIC_API_ORIGIN=https://api.example.invalid npm run build:mobile
```

위의 `.invalid` 주소는 **컴파일 검증용**입니다. 실제 모바일 실행에는 사용할 수 없으며, 향후 앱을 배포할 때 실제 HTTPS API origin으로 바꿉니다. 모바일 빌드는 `.mobile-build/`에 브라우저 코드만 복사하고 성공한 결과를 `out/`으로 내보냅니다. 원본 API·서버 파일이나 웹 `.next` 산출물을 이동하지 않습니다.

전체 검증은 환경 변수를 함께 지정합니다.

```sh
TEST_DATABASE_URL=mysql://geunyang:local-development-only@127.0.0.1:3317/geunyang_math_test NEXT_PUBLIC_API_ORIGIN=https://api.example.invalid npm run verify
```

정적 export는 실제 성공했지만, Capacitor runtime·iOS/Android 프로젝트·네이티브 인증·CORS·오프라인 제출·OTA는 구현하지 않았습니다. Google 로그인 버튼은 서버가 사용 가능하다고 응답한 같은 origin의 일반 웹에서만 제공합니다. 현재 웹 cookie 인증이 native WebView에서 그대로 작동한다고 가정하지 않으며, Google 인증을 embedded WebView 안에서 여는 방식으로 확장하지 않습니다. 자세한 경계와 로컬 API 빌드 예외는 [모바일 구조 문서](docs/mobile-architecture.md)에 있습니다.

GitHub Actions의 [CI](.github/workflows/ci.yml)는 Node 22와 MySQL 8.4로 의존성 설치, Prisma 생성·migration, 타입 검사, 단위·통합 테스트, 웹 빌드와 모바일 정적 export를 실행합니다. `ORACLE_DEPLOY_ENABLED=true`와 배포 시크릿을 설정한 뒤에는 검증된 main만 Oracle에 배포하며, private/public health와 commit까지 확인합니다. 최초 서버 준비와 복구 방식은 [배포 문서](docs/deployment.md)를 참고하세요.

## 코드 구조

```text
src/app/                    공용 화면 진입점과 서버 API 라우트
src/features/learning/      학습 UI · 블록 렌더러 · HTTP 클라이언트
src/shared/api.ts           브라우저에 전달하는 공개 DTO
src/core/                  콘텐츠 계약 · 등록 검증 · 채점 · 개인화 규칙
src/server/                세션 · DB 콘텐츠 관리 · 학습/과제 서비스 · 요청 검증
prisma/                    MySQL schema · 버전 migration · 초기 콘텐츠 이전
tests/                     콘텐츠/채점 단위 검사와 실제 MySQL 통합 검사
content/                    정답이 없는 검토 완료 콘텐츠 번들(개념·뜻풀이)
scripts/content.ts          콘텐츠 import/export/verify CLI
scripts/build-mobile.mjs    서버 코드를 제외한 정적 export
```

공개 DTO에 정답·채점 규칙·비공개 해설을 포함하지 않습니다. 정답은 서버 전용인 문제집 판본의 문항 행에만 있고, 수업·과제·진단은 그 판본을 참조합니다. 웹·모바일은 같은 HTTP 계약을 사용하며, 기관·반·교사 권한은 후속 단계에서 개인 scope와 구분해 구현합니다.

[구현 현황과 계획의 차이](docs/implementation-status.md)에서 실제 구현 범위, 검증 상태, 남은 출시 조건을 확인할 수 있습니다.

## 문서 안내

- [문서 목록](docs/README.md): 문서별 역할과 최신 기준
- [제품 방향](docs/product-direction.md): 학습 대상, 개인화·편집기·AI·기관 확장 원칙
- [구현 현황](docs/implementation-status.md): 완료 범위, 검증 결과와 다음 구현 순서
- [개인화](docs/personalization.md): 추천·학습 증거·새 복습 과제의 규칙과 한계
- [DB 콘텐츠 관리](docs/content-management.md): 내보내기·등록·판본 보존 절차
- [배포](docs/deployment.md): Oracle·NPM·Google 설정, 복구와 릴리스 기록
- [모바일 구조](docs/mobile-architecture.md): 공용 UI·서버 경계와 native 후속 작업
