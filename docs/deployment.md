# Oracle 운영 배포

2026-09-17 확인 기준 최근 기능 릴리스는 개념 탐색 `b8f635e` (#48)다. [해당 검증·배포 기록](#개념-탐색-48)에 확인 근거를 남겼으며, 이전 릴리스는 아래 기록으로 보존한다. 문서 변경 이후 최신 배포 commit은 `/api/version`과 GitHub Actions에서 확인한다.

## 대상과 범위

| 항목 | 설정 |
|---|---|
| 공개 주소 | `https://geunyang-math.team-campfire.dev` |
| 앱 VM | Cooo와 같은 `152.67.215.81`, 사설 `10.0.0.130`, aarch64 |
| SSH 사용자 | `ubuntu` |
| 앱 바인딩 | 사설 IP `10.0.0.130:3007` → 컨테이너 `3000` |
| 프로젝트 루트 | `~/geunyang-math` |
| DB VM / DB | `10.0.0.135` / `geunyang_math` |
| 앱 계정 | `geunyang_math` — 전용 DB의 SELECT, INSERT, UPDATE, DELETE |
| migration 계정 | `geunyang_math_migrator` — 전용 DB의 DML, CREATE, ALTER, INDEX, REFERENCES |
| DB 계정의 접속 제한 | 앱 VM `10.0.0.130`에서만 접속, REQUIRE SSL |

DB 서버의 `partial_revokes=OFF`에서는 DB 권한 이름의 `_`가 와일드카드다. 두 계정 모두 `geunyang\_math`로 escape한 DB scope만 부여해 비슷한 이름의 다른 DB로 권한이 넓어지지 않도록 했다.

비로그인 사용자는 수업 카탈로그와 수업 설명을 열람할 수 있다. Google 로그인 후에는 개인 진도·답안·과제·진단·추천 이력을 저장하고 같은 계정으로 복원한다. Google 운영 로그인·설정 복원과 DB 콘텐츠 전환 후 기존 학습 상태 조회를 확인했다. 개발용 계정 생성과 기존 개발 세션 사용은 운영에서 거부한다.

## Cooo에서 참고한 부분

Cooo의 같은 앱·DB VM, Nginx Proxy Manager(NPM), 와일드카드 인증서를 사용한다. 사용 포트를 실제 조회해 기존 3000~3006과 겹치지 않는 3007을 선택했다. Cooo의 이미지 빌드→스키마 준비→앱 교체→healthy 확인 순서를 따르되, geunyang math는 `prisma migrate deploy`와 DB 콘텐츠 검증을 사용한다. 공유 VM의 이미지 prune이나 다른 Compose 프로젝트 변경은 실행하지 않는다.

## DB TLS

공유 DB 인증서는 사설 IP SAN을 포함하지 않고 CN이 `MySQL_Server_8.0.42_Auto_Generated_Server_Certificate`다. 따라서 단순히 IP에 접속하면서 인증서 검증을 끄지 않는다. 두 컨테이너의 `extra_hosts`에서 인증서 이름의 소문자 alias를 DB 사설 IP에 연결하고 그 이름으로 접속한다.

공개 CA는 [mysql-ca.pem](../deploy/tls/mysql-ca.pem)에 있으며 개인키가 아니다. 배포 시 `shared/mysql-ca.pem`으로 설치하고 `/run/geunyang-math/mysql-ca.pem`에 읽기 전용 마운트한다. SHA-256 fingerprint는 `79:09:DA:05:93:D3:A2:4A:A9:BB:72:CA:EC:54:8E:1B:A2:B4:BE:75:29:85:04:06:A7:CD:D0:23:5E:AD:DC:2B`다.

`DATABASE_URL`은 다음 모양이다. 앱과 migration은 다른 사용자·비밀번호로 각각 환경 파일을 만든다.

```text
mysql://<전용사용자>:<URL인코딩한비밀번호>@mysql_server_8.0.42_auto_generated_server_certificate:3306/geunyang_math?sslcert=/run/geunyang-math/mysql-ca.pem&sslaccept=strict
```

Prisma CLI와 MariaDB 어댑터 모두 CA 및 호스트 이름을 검증한다. `sslaccept=strict` 이외의 검증 완화나 알 수 없는 URL 옵션은 거부한다. 인증서가 갱신될 때 CA와 인증서 이름·별칭의 일치를 다시 확인해야 한다. 현재 workflow는 기존 CA가 다른 경우 자동 덮어쓰기를 중단한다.

## 환경 파일과 GitHub Secrets

| GitHub secret | 내용 |
|---|---|
| `HOST` | 앱 VM SSH 호스트 |
| `USERNAME` | 앱 VM SSH 사용자 |
| `KEY` | 배포용 SSH 개인키 |
| `KNOWN_HOSTS` | 확인된 앱 VM SSH 공개 호스트 키. CI에서 strict checking 사용 |
| `ENV_FILE` | 앱 계정의 DATABASE_URL, APP_ORIGIN, DEV_LOGIN_ENABLED=false, GOOGLE_LOGIN_ENABLED, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET |
| `MIGRATION_ENV_FILE` | migration 계정의 DATABASE_URL, DEV_LOGIN_ENABLED=false |

환경 파일과 키는 Git에 넣지 않는다. 값은 shell 코드 안에 직접 삽입하지 않고 환경변수→권한 0600 파일→SCP로 전달한다. 앱 컨테이너에는 migration 계정 비밀번호를 전달하지 않는다. 서버·시크릿 준비 후 repository variable `ORACLE_DEPLOY_ENABLED=true`를 설정해야 자동 배포가 활성화된다.

## Google 웹 로그인 설정과 운영 확인

기존 `teamcampfire` Google Cloud 프로젝트 안의 **Geunyang Math Web** 전용 Web application OAuth 클라이언트를 사용한다. 프로젝트는 외부 사용자·프로덕션 게시 상태다. 동의 화면의 공유 이름은 현재 Constella이며, 사용자 결정에 따라 이름 변경은 후속 작업으로 둔다. 기존 Cooo·Constella·서랍의 Google 자격증명이나 사용자 계정을 공유하지 않는다. 등록할 승인 리디렉션 URI는 아래 고정 주소다.

```text
https://geunyang-math.team-campfire.dev/api/auth/google/callback
```

| 앱 환경 변수 | 운영 값·조건 |
|---|---|
| `APP_ORIGIN` | `https://geunyang-math.team-campfire.dev` — HTTPS origin만, 경로·query·사용자 정보 없음 |
| `GOOGLE_LOGIN_ENABLED` | 준비된 경우에만 `true`; `false`이거나 설정이 잘못되면 Google 로그인·세션 사용을 거부 |
| `GOOGLE_CLIENT_ID` | 이 프로젝트 전용 Web application 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | 서버 전용 비밀값. `ENV_FILE`에만 두고 빌드 공개 변수로 전달하지 않음 |
| `DEV_LOGIN_ENABLED` | `false` 고정 |

Google 설정은 앱 환경 파일에만 필요하고 migration 환경 파일에는 넣지 않는다. 앱이 등록 요청의 Host나 사용자 제공 복귀 주소로 callback을 만들지 않는다. 로컬 Google 시험에는 별도로 승인한 loopback URI와 그에 맞는 APP_ORIGIN이 필요하다. 현재 `.env.example`은 Google 로그인을 기본 비활성화한다.

로그인 진입점은 `GET /api/auth/google/start`, callback은 `GET /api/auth/google/callback`이다. 요청 scope는 `openid email profile`만이며 offline 접근을 요청하지 않는다. 일회용 DB `OAuthAttempt`의 state·브라우저 바인딩·PKCE·nonce를 검증하고, 공식 Google 라이브러리로 ID 토큰의 서명·issuer·audience·시각을 확인한다. verified email, nonce, authorized party, 엄격한 만료도 검사한다. Google 네트워크 요청은 10초 취소 신호와 자동 재시도 금지를 적용한다.

Google `sub`를 대소문자까지 구분해 `GoogleIdentity`에 연결한다. 같은 Google 계정으로 다시 로그인하면 같은 User·개인 LearningScope·수강·과제를 읽는다. 이메일이나 이름이 같아도 다른 Google 계정 또는 개발 계정을 자동 연결하지 않는다. 운영 세션은 7일의 `__Host-gm_session` Secure·HttpOnly·SameSite=Lax host-only cookie이고, 재로그인 시 기존 브라우저 세션을 회전한다. 로그아웃은 동일 origin을 확인한 후 서버 세션과 cookie를 폐기한다. 기존 `gm_session`과 `authMethod=development` 세션은 production에서 계속 거부한다.

`20260914010000_google_auth` migration은 Session의 `authMethod`를 기본값 `development`로 추가하고 GoogleIdentity·OAuthAttempt 테이블을 만든다. 기존 데이터나 baseline migration을 수정·삭제하지 않으며, 현재 migration 계정의 CREATE·ALTER·INDEX·REFERENCES 권한으로 적용한다. rollback 시 앱만 복구하고 이미 적용한 schema는 유지한다.

인증 코드, ID/access/refresh token, 세션 cookie, client secret, 원문 provider 오류를 Git·브라우저 저장소·배포 출력·앱 로그·crash report에 남기지 않는다. 앱은 Google access/refresh token을 영속 저장하지 않고 callback 실패를 `cancelled`, `expired`, `unavailable`, `failed` 중 하나로만 돌려준다. NPM 호스트 #9에는 `/api/auth/google/callback` custom location을 추가하고 `access_log off; error_log /dev/null crit;`를 적용했다. 정상 HTTPS 콜백의 인증 query는 NPM 로그에서 제외하며 upstream에는 그대로 전달한다. HTTP→HTTPS 리디렉션 로그나 Cloudflare 내부 로그의 수집 여부까지 보증하지 않는다. 전체 `$request`·`$request_uri`나 URL query를 수집하는 로깅·APM 설정은 이 경로에서 제거하거나 마스킹한다. 앱 로그 보호만으로 NPM·Cloudflare 로그 설정까지 검증한 것으로 간주하지 않는다.

배포 후에는 health/version과 함께 session의 `googleLogin=true`, Google 승인 화면과 정확한 callback, 취소·만료의 안전한 복귀, 정상 로그인, 수업 학습 저장, 로그아웃 후 접근 차단, 같은 Google 계정으로 재로그인한 기록 복원을 확인한다. Google 계정을 바꿔 다른 사람의 학습 기록이 보이지 않는지도 확인한다. 실제 계정의 동의·로그인 결과는 자동 테스트와 구분해 기록한다. 네이티브 인증은 별도 구현이며 현재 웹 흐름을 WebView에 그대로 적용하지 않는다.

## HTTPS 프록시

프록시는 Nginx Proxy Manager의 **Hosts → Proxy Hosts**에 등록된 `geunyang-math.team-campfire.dev` 항목에서 관리한다. UI에서 설정을 저장했고 목록의 상태가 **Online**임을 확인했다. DNS는 기존 Cloudflare 경로로 해석된다.

| NPM UI 항목 | 현재 설정 |
|---|---|
| Domain Names | `geunyang-math.team-campfire.dev` |
| Scheme | `http` |
| Forward Hostname / IP | `10.0.0.130` |
| Forward Port | `3007` |
| SSL Certificate | Let's Encrypt 와일드카드 인증서 `npm-8` |
| Force SSL | 켜짐 |
| HTTP/2 Support | 켜짐 |
| Websockets Support | 켜짐 |
| Access List | Public |
| Cache Assets | 꺼짐 |

2026-09-14 점검에서 인증서 만료일이 2026-11-17임을 확인했다. 이후 갱신 여부는 NPM에서 확인한다. 프록시 호스트와 인증서 설정은 NPM UI에서 변경하며, 앱 배포 workflow는 이 설정을 수정하지 않는다.

UI 관리 방식으로 전환하면서 기존 custom HTTP 설정을 백업하고, `/home/ubuntu/nginx/data/nginx/custom/http.conf`에서 이 프로젝트 설정을 포함하던 한 줄만 제거했다. 서버에 남아 있는 `/home/ubuntu/nginx/data/nginx/geunyang-math/server.conf`는 현재 비활성 파일이며 사용하지 않는다. 저장소의 이전 custom 프록시 설정과 설치 스크립트도 제거했다. 같은 도메인의 변경은 기존 Proxy Hosts 항목에서 진행한다.

## 배포와 복구

[GitHub workflow](../.github/workflows/ci.yml)는 모든 브랜치의 타입·단위/실제 MySQL 검사·웹/모바일 빌드를 실행한다. 운영 배포는 검증에 성공한 `main` push 또는 `main`의 수동 실행에서만 진행한다. PR에서는 배포 비밀값을 사용하지 않는다.

검증한 Git SHA의 archive와 환경 파일을 `incoming/`으로 전송한다. SHA별 `releases/<sha>/` 디렉터리에서 [deploy-remote.sh](../scripts/deploy-remote.sh)를 실행한다. 스크립트는 앱과 migrator 이미지를 따로 만들고, migration→기본 콘텐츠 seed→저장소 번들 발행→content:verify→기동→사설·공개 health/version 확인이 끝나야 `current`를 새 릴리스로 바꾼다.

릴리스 archive는 제한된 파일 권한을 유지한다. Dockerfile은 migrator가 읽는 package·Prisma 설정·소스를 `node` 사용자 소유로 복사한다. CI는 실제로 권한 600/700의 archive에서 migrator를 빌드하고, 일반 사용자로 소스를 읽으며 빈 테스트 DB에 migration과 콘텐츠 검증을 실행하는지 검사한다. 최초 배포에서 확인된 root 소유 파일의 `EACCES` 재발을 이 경로로 검증한다.

릴리스 포인터를 새로 커밋한 뒤에는 현재와 직전 릴리스만 남기고 이전 릴리스 디렉터리, 그 SHA의 앱·migrator 이미지, 지난 배포의 롤백 태그, `incoming/`에 남아 있던 비공개 환경 파일 사본을 지운다. 배포마다 이미지 두 개(앱 468MB, migrator 1.6GB)가 쌓여 디스크를 채우던 문제를 막고, 오래된 환경 파일 사본도 함께 정리하기 위해서다. 빌드 캐시는 이 VM의 다른 프로젝트와 공유하므로 72시간 이상 쓰이지 않은 항목만 지운다. 이 단계는 커밋 이후에 실행하며, 실패해도 기록만 남기고 배포 결과를 바꾸지 않는다.

이전 릴리스와 해당 환경 파일은 복구를 위해 보존한다. 실패하면 이전 앱 이미지와 환경으로 복귀한다. 앱 복귀는 이미 적용한 DB migration을 되돌리지 않는다. 2026-09-16까지는 후속 migration을 이전 앱과 호환되도록 작성했으나, [용어 사전을 반영하는 스키마 변경](schema-change-plan.md)이 진행되는 동안은 이 호환을 내려놓는다 — 아직 실사용 서비스가 아니고 데이터를 보존하지 않기로 했으므로, 되돌리기는 앞으로 고쳐 나가는 것으로 한다. 자동화는 운영 DB의 데이터 삭제 권한을 새로 부여하지 않는다. `DROP`은 표 이름을 바꾸는 데 필요해 2026-09-17에 migrator 계정에 한 번 부여한다.

독립 앱 서비스만 교체하므로 같은 VM의 Cooo·서랍·Constella 등은 재시작하지 않는다. 새 배포가 진행 중인 운영 workflow를 자동 취소하지 않으며, 원격에서도 프로젝트별 잠금을 사용한다.

## 릴리스별 검증 기록

바로 아래 첫 릴리스 표의 날짜는 2026-09-14다. 이후 기록은 각 항목의 날짜를 따른다. 아래 commit은 기능 검증 당시의 릴리스이며, 후속 문서 배포의 commit과 다를 수 있다.

| 릴리스 | commit | 검증·운영 결과 |
|---|---|---|
| [Google 로그인 #4](https://github.com/team-campfire-dev/geunyang-math/pull/4) | `4509346` | 161개 테스트, 웹·모바일 빌드, 운영 DB migration·배포 성공. 실제 Google 로그인에서 학습 시간 저장→로그아웃→같은 계정 재로그인 복원 확인. [실행](https://github.com/team-campfire-dev/geunyang-math/actions/runs/34805433313) |
| [규칙 기반 개인화 #5](https://github.com/team-campfire-dev/geunyang-math/pull/5) | `87a1717` | 179개 테스트, 웹·모바일 빌드·운영 배포 성공. 로컬 브라우저 진단 이어하기·추천 변경·직접 선택 검증, 운영 개인화 화면 조회 확인. [실행](https://github.com/team-campfire-dev/geunyang-math/actions/runs/34809013344) |
| [DB 콘텐츠 관리 #6](https://github.com/team-campfire-dev/geunyang-math/pull/6) | `0c5e505` | 190개 테스트, 신규 DB 설치·기존 DB 업그레이드·CLI 검증, 웹·모바일 빌드·Oracle 배포 성공. 공개 수업 3개·블록·15문항의 이전 내용 일치와 기존 계정 학습 상태 조회 확인. [실행](https://github.com/team-campfire-dev/geunyang-math/actions/runs/34811307476) |
| [카탈로그 문구·수식 표기 #8](https://github.com/team-campfire-dev/geunyang-math/pull/8) | `e6c7e51` | 공개 카탈로그의 개념 이름, 채점의 LaTeX 부분집합, 캡션 수식과 낭독용 이름 분리. 배포 성공. |
| [용어 풀이 #9](https://github.com/team-campfire-dev/geunyang-math/pull/9) | `00e8ca1` | 용어 판본과 진행도 기반 노출, `core.rich_text@2`. 배포 성공. 이 시점 콘텐츠는 아직 v1이라 화면 변화 없음. |
| [번들 발행 자동화 #11](https://github.com/team-campfire-dev/geunyang-math/pull/11) | `7282d9a` | 배포가 `content/*.json`을 적용 이력에 따라 한 번만 발행. 이 배포에서 기본 용어 6개가 운영에 등록됨. |

2026-09-15 릴리스는 콘텐츠 블록 재편과 편집 화면이 이어진 묶음이다.

| 릴리스 | commit | 검증·운영 결과 |
|---|---|---|
| [릴리스 회수 #12](https://github.com/team-campfire-dev/geunyang-math/pull/12) | `438d5f4` | 배포가 끝난 뒤 이전 릴리스 디렉터리와 이미지를 정리. 배포 성공. |
| [편집 화면과 조작 블록 #14](https://github.com/team-campfire-dev/geunyang-math/pull/14) | `ccc123b` | `/authoring` 첫 화면, 장면을 이어 보여주는 막대와 직접 놓는 조각. 배포 성공. |
| [자유 그림 블록 #15](https://github.com/team-campfire-dev/geunyang-math/pull/15) | `edb205f` | `core.scene@1`로 좌표 위에 도형을 놓아 그린다. 배포 성공. |
| [블록 정리·장면 애니메이션 #16](https://github.com/team-campfire-dev/geunyang-math/pull/16) | `2af9b0a` | 팔레트를 네 개로 줄이고 `frames`로 같은 그림을 이어 보여준다. 발행된 판본이 쓰는 블록은 검증·렌더러를 남기고 팔레트에서만 뺐다. 배포 성공. |
| [그림 안 조작 #17](https://github.com/team-campfire-dev/geunyang-math/pull/17) | `597a826` | `zones`·`task`로 도형을 끌어다 놓는다. 채점하지 않으므로 문항·용어 풀이에서는 거부. 배포 성공. |
| [문항 편집 #18](https://github.com/team-campfire-dev/geunyang-math/pull/18) | `f0e03e3` | 「문항 묶음」이 문항을 직접 갖고 본문·정답·개념·힌트·해설을 화면에서 쓴다. 발행된 문항을 고치면 새 `problemVersionId`로 개명하고 활동·숙제 참조를 함께 옮긴다. 배포 성공. |
| [편집 권한 화면 #19](https://github.com/team-campfire-dev/geunyang-math/pull/19) | `b857796` | 관리자가 화면에서 역할을 주고 거둔다. 자기 관리자 역할과 마지막 관리자 행은 지킨다. 배포 성공. 이 시점까지 운영에는 권한을 가진 계정이 없었고, 같은 날 소유자 계정에 `admin` 행을 넣어 풀었다. |
| [문항 안 조작 금지 안내 #20](https://github.com/team-campfire-dev/geunyang-math/pull/20) | `a740fb2` | 발행 단계에서만 거부하던 것을 편집 시점에 이유와 함께 막는다. 배포 성공. |
| [용어 범위 #21](https://github.com/team-campfire-dev/geunyang-math/pull/21) | `e81f8c7` | `TermVersion`에 `scopeKind`·`scopeKey` 추가. 기존 용어 6개는 기본값으로 공통 사전이 되어 재발행이 필요 없었다. 배포 성공. |
| [용어 편집 화면 #23](https://github.com/team-campfire-dev/geunyang-math/pull/23) | `3551f86` | 공통 사전과 수업 용어를 화면에서 쓰고 고친다. 저장이 곧 다음 판본의 발행. 배포 성공. |
| [본문에서 `@`로 걸기 #24](https://github.com/team-campfire-dev/geunyang-math/pull/24) | `7f98fe6` | 저장 형식은 그대로 두고 거는 방법만 바꿨다. 몇 번째 낱말인지는 적은 자리가 정한다. 배포 성공. |
| [노출 판단을 작성자에게 #25](https://github.com/team-campfire-dev/geunyang-math/pull/25) | `5a83905` | 서버가 진도로 용어를 숨기던 규칙을 걷어냈다. 발행된 v4 판본은 자기 개념에 주석을 달지 않아 배포 직후 보이는 용어가 늘지는 않는다. 배포 성공. |

#22는 base가 `feat/scoped-terms`였던 스택 PR이라 머지 결과가 main에 닿지 않았고, 같은 내용을 #23으로 다시 올렸다.

2026-09-15~16 릴리스는 발행된 판본의 저장 구조를 옮긴 묶음이다. 운영 결과는 배포마다 migrator로 `content:verify`를 실행해 확인했다.

| 릴리스 | commit | 검증·운영 결과 |
|---|---|---|
| [문항 이름 색인 #27](https://github.com/team-campfire-dev/geunyang-math/pull/27) | `3147539` | 초안 저장이 발행 문서를 전부 읽던 것을 색인 조회로 바꿨다. 배포 후 `indexedProblems: 36`(수업 30 · 진단 6). 배포 성공. |
| [섹션·블록 표 #29](https://github.com/team-campfire-dev/geunyang-math/pull/29) | `d389777` | 표를 만들고 문서에서 채우기만 한다. 배포 후 `indexedBlocks: 134`(본문 44 · 지문 30 · 힌트 30 · 해설 30). 배포 성공. |
| [행에서 읽기 #30](https://github.com/team-campfire-dev/geunyang-math/pull/30) | `93f323d` | 카탈로그·수업 화면·학습 상태·초안 만들기가 행에서 읽는다. 판본 6개가 행에서 문서와 동일하게 되돌아옴을 확인. 배포 성공. |
| [진단·용어 블록 #31](https://github.com/team-campfire-dev/geunyang-math/pull/31) | `ad7024f` | 남은 블록을 같은 표로 옮겼다. 배포 후 `indexedBlocks: 148`(진단 지문 6 · 정의 8 추가). `fallback`을 가진 정의 블록 둘이 되돌리기 검사를 통과. 배포 성공. |
| [문서 사본 제거 #32](https://github.com/team-campfire-dev/geunyang-math/pull/32) | `9c0940c` | 발행된 판본의 `document` 칸 네 개를 지웠다. 문서 없이 같은 수(`36`·`148`)를 보고. 남은 `document` 칸은 `ContentDraft`와 `DiagnosticRun` 둘뿐임을 운영 DB에서 확인. 배포 성공. |

#28은 base가 `feat/published-problem-index`였던 스택 PR이라 머지 결과가 main에 닿지 않았고, 같은 내용을 #29로 다시 올렸다. 아래쪽 PR이 먼저 머지되어도 base 브랜치가 남아 있으면 GitHub이 재조준하지 않는다.

2026-09-16 릴리스는 편집 화면을 관리자용에서 수업을 준비하는 사람의 화면으로 옮긴 묶음이다.

| 릴리스 | commit | 검증·운영 결과 |
|---|---|---|
| [교사가 쓰는 편집 화면 #35](https://github.com/team-campfire-dev/geunyang-math/pull/35) | `03e0ad5` | 자동 저장·되돌리기, 타이포·대비, 전문가 모드, 미리보기를 편집기로, 해보기, 복제, 거부의 자리, 검토 요청·새 수업을 한 브랜치에 일곱 단계로 쌓았다. 359개 테스트(통합 포함)·웹/모바일 빌드 통과. 배포 후 `/api/version`·컨테이너 이미지·`current` 심링크가 모두 같은 커밋이고 재시작 0회·오류 로그 없음을 확인했다. migration은 배포가 적용했고 운영 DB에서 `User.editorExpertMode`가 세 계정 모두 기본값(꺼짐)인 것과 발행 콘텐츠 수(`classVersions 6`·`sections 30`·`blocks 148`·`problems 36`·`terms 6`)가 그대로인 것을 확인. |

이 릴리스의 `20260916030000_editor_expert_mode`는 `User`에 `editorExpertMode`(기본 꺼짐) 한 칸을 더하는 **추가 전용** migration이라 되돌리려면 이전 이미지를 다시 띄우면 된다. 초안 상태에 더한 `review`는 `status`가 이미 문자열 칸이라 migration이 없다.

2026-09-17 릴리스는 [용어 사전](glossary.md)의 이름을 저장 구조에 옮기는 묶음이다. 세 번의 main 배포가 모두 「Apply migrations」에서 실패했는데, 스크립트가 이 단계의 출력을 버리므로 원인은 운영 DB의 `_prisma_migrations.logs`에서 읽었다.

| 릴리스 | commit | 검증·운영 결과 |
|---|---|---|
| [클래스를 수업으로 #37](https://github.com/team-campfire-dev/geunyang-math/pull/37) | `0176f84` | migrator에 `DROP`이 없어 `RENAME TABLE`이 거부됐다(1142). 표는 하나도 바뀌지 않았고 실패 기록만 남아 다음 배포까지 막았다. `DROP`을 부여한 뒤 `prisma migrate resolve --rolled-back`으로 기록을 정리했다. |
| [코스·개념 #40](https://github.com/team-campfire-dev/geunyang-math/pull/40) | `068c684` | 위 실패 기록 때문에 시작조차 하지 않았다(P3009). |
| [문제집 #41](https://github.com/team-campfire-dev/geunyang-math/pull/41) | `7d0121a` | A·B·C는 적용됐다. D는 `CREATE TEMPORARY TABLE`에서 거부됐다(1044, migrator에 `CREATE TEMPORARY TABLES`가 없다). 그 앞의 `ProblemSet`·`ProblemSetVersion`은 만들어진 채 남았고, 되돌린 옛 앱은 개명된 표를 읽지 못해 health 503으로 서비스가 내려갔다. D를 일반 표로 고치고 반쯤 적용된 상태에서 다시 돌 수 있게 했다. |
| [문제집 migration 수정 #42](https://github.com/team-campfire-dev/geunyang-math/pull/42) | `bde6491` | D의 실패 기록을 rolled back으로 표시한 뒤 배포. migration·씨앗·검증·기동·health·commit 확인까지 통과해 A~D가 운영에 적용됐다. 공개 주소의 health `ready`, commit 일치. |
| [과제 #43](https://github.com/team-campfire-dev/geunyang-math/pull/43) | `bfdc2ea` | E. 배포 성공, health `ready`, commit 일치. 운영의 복습 과제는 migration이 복습 풀 문제집 판본으로 옮겼다. |
| [진단이 문제집을 씀 #44](https://github.com/team-campfire-dev/geunyang-math/pull/44) | `48a35d4` | F. 배포 성공, health `ready`, commit 일치. 운영의 진단 문항은 문제집 `starting-point`로 옮겨졌고 씨앗은 무변경으로 지나갔다. 이로써 [용어 사전](glossary.md)의 저장 구조 A~F가 모두 운영에 있다. |

여기서 배운 것 두 가지. migration은 migrator가 가진 권한(CREATE·ALTER·INDEX·REFERENCES·DROP)만 쓴다 — 임시 표는 쓰지 않는다. 그리고 MySQL DDL은 되돌아가지 않으므로 여러 문장으로 된 migration은 중간에 멈춘 자리에서 다시 돌 수 있게 쓴다(`DROP TABLE IF EXISTS`로 자기가 만든 것을 먼저 치운다).

DB 콘텐츠 migration `20260914030000_database_content`는 Skill·DiagnosticVersion과 초기 콘텐츠를 등록한다. 기본 콘텐츠는 수업 3개(수업·숙제 문항 15개), 진단 1종(6문항), 개념 3개다. 기존 LessonVersion 행의 내용·해시·발행 시각을 덮어쓰지 않는다. 배포용 migrator는 `db:migrate` 후 저장소의 `content/*.json`을 `content:publish`로 발행하고 `content:verify`를 실행한다. `AppliedContentBundle`에 같은 checksum이 있으면 건너뛰므로 내용이 그대로인 배포는 DB를 건드리지 않고, 이미 발행한 판본을 고쳐 커밋하면 배포가 실패한다. 등록 명령과 불변 판본 정책은 [DB 콘텐츠 관리](content-management.md)를 따른다.

### 개념 탐색 #48

- 날짜: 2026-09-17. [PR #48](https://github.com/team-campfire-dev/geunyang-math/pull/48) 병합 commit `b8f635eb470d16aed937013de50677837cc65f5d`.
- [main Actions](https://github.com/team-campfire-dev/geunyang-math/actions/runs/35195038716)에서 verify와 Oracle 배포 성공. 타입 검사·MySQL 통합 포함 392개 테스트·웹 빌드·모바일 정적 export 통과.
- 문서 마무리 중 공개 `/api/version`의 commit이 `b8f635e`와 일치하고 `/api/health`가 `ready`인 것을 확인했다. 이후 배포의 상태는 다시 조회해야 한다.
- `20260917190000_definition_usage_note`는 nullable `usageNote` 한 칸을 추가한다. 수업·학습 기록을 초기화하지 않는다. v3 사전은 기존 뜻풀이를 한 번 갱신하고 정수·공약수·기약분수를 더한다. 기본 설치 기준 개념·공통 뜻풀이는 각 10개다.
- 배포 순서: 새 이미지 빌드 → `db:migrate → db:seed → content:publish → content:verify` → 새 앱 기동·health/version 검사. seed는 기존 뜻풀이 편집을 보존하지만 v3 번들은 지정된 공통 사전 10개를 갱신하므로 별도 운영 편집이 있다면 먼저 비교한다.
- 새 사전의 `core.rich_text@3`를 처리하지 못하는 이전 서버로 앱만 롤백하면 뜻풀이 편집·콘텐츠 검증이 실패할 수 있다. migration의 nullable 칸만으로 롤백 호환성을 판단하지 않는다. 이미 적용한 v2 파일과 원장 checksum은 바꾸지 않았다.
- 실제 브라우저 검증과 후속 범위는 [개념 탐색 문서](concept-exploration-design.md#9-첫-구현의-구체적인-경계)를 따른다. 본 확인은 실제 스크린리더·네이티브 앱·수학 원고의 전문가 검수를 뜻하지 않는다.

### 저장 구조 migration

발행된 판본을 JSON 한 덩이에서 행으로 옮긴 다섯 단계다. 앞의 네 단계는 **추가 전용**이라 발행된 내용을 바꾸지 않고, 되돌리려면 이전 이미지를 다시 띄우면 된다. 마지막 단계만 되돌릴 수 없다.

| migration | 하는 일 | 되돌리기 |
|---|---|---|
| `20260915020000_published_problem_index` | 문항 이름 색인 `PublishedProblem`을 만들고 발행된 문서에서 채운다 | 이미지만 되돌리면 된다. 표를 남겨 두어도 앱은 영향받지 않는다 |
| `20260915030000_class_section_blocks` | 섹션·블록 표를 만들고 같은 방식으로 채운다. 아직 아무도 읽지 않는다 | 〃 |
| `20260916000000_read_class_from_rows` | `LessonVersion.metadata`와 `PublishedProblem`의 문항 칸을 채운다. **여기서부터 앱이 수업을 행에서 읽는다** | 이전 이미지는 `document`를 읽고 그 칸은 그대로 기록되므로 학습 화면은 돈다. 다만 **되돌린 상태에서 새 콘텐츠를 발행하면 실패한다** — 옛 코드가 새 필수 칸을 채우지 않는다 |
| `20260916010000_diagnostic_and_term_blocks` | 남아 있던 블록(진단 문항의 지문, 용어 정의의 본문)을 같은 표로 옮긴다 | 〃 |
| `20260916020000_drop_published_documents` | 발행된 판본의 `document` 칸 네 개를 지운다 | **되돌릴 수 없다.** 이전 이미지는 그 칸을 읽으므로 DB도 함께 되돌려야 한다 |

### 이름 migration

`20260917000000_lesson_and_learning_scope`는 [용어 사전](glossary.md)의 이름을 표에 옮긴다. `ClassVersion`·`ClassSection`·`Scope`를 `LessonVersion`·`LessonSection`·`LearningScope`로, `classKey`·`classVersionId`·`sourceClassVersionId`·`preferredClassKey` 칸과 그 인덕스·제약 이름을 새 이름으로 바꾸고, `ownerKind`·`scopeKind`·`contextKind`의 값 `class`와 문서 JSON 안의 `public.classKey`·용어 주석의 `scopeKind`를 `lesson`으로 고친다. 행은 그대로 옮겨지지만 옮겨진 판본의 `contentHash`는 옛 문서 기준으로 남아 있다(이미 영구 대조에 쓰지 않는다). `RENAME TABLE`이 옛 이름에 `DROP`을 요구하므로 migrator 계정에 `DROP`이 있어야 하고, 이전 앱 이미지는 이 표 이름을 읽지 못하므로 앱만 되돌릴 수 없다. 그다음 단계들은 [변경안](schema-change-plan.md)의 순서를 따른다.

`20260917010000_course_and_identity`는 코스와 정체 표(`Course`·`Lesson`·`Diagnostic`)를 만들고, 발행된 수업 3개와 진단 1개를 코스 `fractions` 하나로 묶는다. `LessonVersion.order`와 문서의 `public.order`는 `Lesson.order`로 옮겨 가며 지워진다(옮겨진 판본의 `contentHash`는 다시 옛 문서 기준으로 남는다). 행이 적어 SQL로 옮겼고 지우지 않았다. 이 배포부터 migrator는 `db:migrate` 뒤에 `db:seed`를 실행한다.

`20260917020000_concepts`는 `Skill`과 `TermVersion`을 `Concept`·`ConceptDefinition`으로 합친다. 개념 3개는 평가할 수 있는 개념이 되고, 용어 6개는 각각 설명만 있는 개념이 되며 키의 `term.` 접두어를 잃는다(`term.denominator` → `denominator`). 범위마다 마지막 판본이 그 범위의 뜻풀이 한 행이 되고(판본 id를 행 id로 그대로 쓴다), 옛 판본의 블록은 지운다. `PublishedProblem.skillKeys`는 `conceptKeys`로, 문서의 `skillKeys`·`prerequisiteSkillKeys`도 같이 바뀌며, 발행된 `core.rich_text@2` 블록은 `@3`(`definitions[].conceptKey`)으로 옮겨진다. 옛 형식의 초안은 옮기지 않고 지운다. 두 표를 `DROP TABLE`하므로 A 단계의 `DROP` 권한이 여기서도 필요하다. 저장소 번들은 `content/glossary-v2.json`으로 바뀐다 — 옛 `glossary-v1.json`의 원장 행은 남지만 파일이 없어 다시 발행되지 않는다.

`20260917030000_problem_sets`는 문제의 주인을 수업에서 문제집으로 옮긴다. 발행된 수업 판본의 활동 블록마다 문제집 `<수업키>:<단계 역할>`과 판본 `<수업키>:<역할>:<vN>`을 만들고(수업 판본마다 자기 문제집 판본을 갖는다), 숙제 풀은 `<수업키>:review`가 되어 `metadata.review`로 참조된다. `PublishedProblem`과 문항 블록은 문제집 판본으로 주인을 옮기고, 활동 블록은 `core.problem_set@2`(문제집 ID + 판본 ID + 고른 문제 ID)가 된다. 옮겨진 문제집 판본의 `contentHash`는 자리만 채운 값이다. 한 수업 판본에 같은 역할의 단계가 둘이면 이름이 겹쳐 migration이 멈춘다(병합하지 않는다). `ContentDraft`는 `ownerKind`·`ownerKey`로 일반화되고 옛 형식의 초안은 지운다. 작업용 표 `activity`·`review`·`moved`는 임시 표가 아니라 일반 표다 — migrator에 `CREATE TEMPORARY TABLES`가 없어 첫 운영 실행이 거기서 멈췄다. 그 실행이 만들어 둔 두 표를 `DROP TABLE IF EXISTS`로 먼저 치우므로, 실패 기록을 rolled back으로 표시하면 같은 migration을 다시 적용할 수 있다.

`20260917040000_assignments`는 과제가 문제집 판본을 가리키게 한다. `Assignment`에 `problemSetId`·`problemSetVersionId`(FK)·`policy`·`schedule`이 생기고 `issuedAt`은 비울 수 있게 된다. 기존 과제는 모두 시스템이 낸 복습이므로 `sourceLessonVersionId`가 가리키는 수업 판본의 `metadata.review`에서 문제집 판본을 찾아 옮기고, 정책은 `{kind:'review', hints:true, results:'per-item', solutions:'never'}`, 기간 규칙은 빈 객체로 둔다. 수업 판본이 없어 자리를 못 찾는 과제는 그 기록(시도·제출·배정·항목)과 함께 지운다. `AssignmentRecipient`는 `assignmentPolicy`를 잃고 `opensAt`을 얻으며, `AssignmentItem.problemSnapshot`은 사라진다 — 문항 내용은 문제집 판본의 행에서 읽는다. 작업용 표 `unplaced`는 일반 표다.

`20260917050000_diagnostic_problem_sets`는 진단이 문제집을 쓰게 한다. `DiagnosticVersion`에 `problemSetId`·`problemSetVersionId`(FK)·`problemVersionIds`(묻는 순서)가 생기고, 진단 판본이 갖고 있던 문항은 진단 키 이름의 문제집(`<진단키>`, 판본 `<진단키>:vN` — 발행 순서)으로 옮겨진다. `PublishedProblem`의 진단 행은 `problem_set` 소유가 되고 문항 블록도 따라간다. 씨앗은 같은 이름(`starting-point:v1`)을 쓰므로 migration 뒤 `db:seed`가 무변경으로 지나간다. 진행 중인 `DiagnosticRun`은 시작 시점의 문항 사본을 들고 있어 영향이 없다. 작업용 표 `placement`는 일반 표다.

사본이 있는 동안 `content:verify`는 배포마다 행과 `document`를 대조했다 — 처음에는 문항 색인을, 그다음에는 블록을, 세 번째 단계부터는 행을 도로 맞춘 결과 전체를 한 글자도 다르지 않은지 봤다. 네 번의 배포(#27·#29·#30·#31)가 모두 같음을 확인한 뒤에 사본을 지웠다. 지금 `content:verify`가 보고하는 수는 운영 기준으로 `indexedProblems: 36`, `indexedBlocks: 148`이고, 어긋나면 배포가 그 자리에서 멈춘다.

초기 인프라 점검에서는 앱 VM·포트·DNS·와일드카드 인증서, ARM64 non-root 이미지·revision·health, DB TLS 연결과 잘못된 CA/호스트 이름 거부, 앱 계정의 DB 한정 DML·호스트 제한·REQUIRE SSL을 확인했다. NPM Proxy Hosts 등록과 Google HTTPS callback 로그 제외, 배포 시크릿 6개와 자동 배포 활성화도 완료했다. 이 기록은 이후 인증서·권한·프록시 변경을 자동 검증한다는 뜻은 아니다.

최근 기능 릴리스에서는 공개 health 정상, 정확한 commit, `googleLogin=true`·`developmentLogin=false`를 확인했다. 공개 API의 수업 문서에서 비공개 채점 명세가 노출되지 않음을 비교했다. 운영 화면 점검은 기존 계정의 조회만 수행했고 실제 진단·과제 답안을 새로 제출하지 않았다. 기존 DB 업그레이드의 모든 행·해시·시각·snapshot 보존 비교는 별도의 로컬 테스트 DB에서 수행했다.

## 운영 콘텐츠·데이터 작업 기록

2026-09-15에 수식과 용어 주석을 담은 수업 판본 `fraction-meaning:v4`·`fraction-equivalence:v4`·`fraction-addition:v4`를 운영에 발행했다. migrator 이미지로 `content:import`를 실행했고 `newClasses: 3`, 용어는 이미 등록되어 `unchangedVersions: 6`이었다. 공개 API에서 카탈로그가 v4로 바뀌고 수식·용어 주석·glossary가 내려오는 것을 확인했다. 기존 판본은 그대로 남아 있다.

같은 날 요청에 따라 운영 DB의 계정 데이터를 전부 삭제했다. FK 자식부터 `AssessmentRevision`·`SubmissionItem`·`Attempt`·`Submission`·`AssignmentRecipient`·`AssignmentItem`·`Assignment`·`Enrollment`·`HintUse`·`DiagnosticRun`·`RecommendationHistory`·`Session`·`GoogleIdentity`·`OAuthAttempt`·`LearningScope`·`User` 순으로 비웠다. 콘텐츠 테이블은 건드리지 않았고 삭제 후 `content:verify`로 수업 6판본·문항 30·개념 3·진단 1·용어 6이 그대로임을 확인했다. 되돌릴 백업 절차는 아직 없다.

수동 작업 중 확인한 제약이 두 가지 있다. 첫째, `scp`로 올린 번들은 `ubuntu`(uid 1001) 소유 0600이라 `node`(uid 1000)로 도는 컨테이너가 읽지 못한다. `--user 1000:1001`과 그룹 읽기 권한으로 실행한 뒤 권한을 되돌린다. 둘째, `migrate` 서비스만 쓰더라도 Compose는 파일 전체를 해석하므로 `APP_BIND_IP`·`DEPLOY_ENV_FILE`까지 필요하다. 일회성 작업은 같은 환경 파일·CA·호스트 별칭을 주어 `docker run`으로 직접 실행하는 편이 간단하다.

### 2026-09-17 개념과 기본 수업 재작성 (#47)

`20260917060000_atomic_concept_curriculum`은 실사용 전 콘텐츠 교체를 위해 기존 플랫폼 수업 `fraction-meaning`, `fraction-equivalence`, `fraction-addition`과 `starting-point` 진단의 구 판본·초안 및 연결된 학습 기록을 정리한다. 계정·인증·편집 권한과 다른 코스는 유지한다. 다른 수업·진단·초안이 참조하는 문제집 판본과 다른 콘텐츠가 사용하는 옛 개념은 보존한다. 적용 전에 해당 기본 수업을 사용 중인 서비스가 아닌지 확인해야 하며, 실사용 후에는 이 초기화 정책을 재사용하지 않는다.

뒤따르는 `db:seed`가 새 수업 3개, 수업·복습 문항 17개, 진단 8문항을 설치한다. `content:publish`가 분수·분자·분모·동치분수·약분·통분·덧셈의 공통 뜻풀이를 갱신한다. 이 초기화는 구 학습 기록을 복구하지 않으므로 앱 이미지 롤백만으로 옛 수업 이력을 되살릴 수 없다. [#47 main 실행](https://github.com/team-campfire-dev/geunyang-math/actions/runs/35189780079)은 검증·배포에 성공했다. 후속 #48 확인 당시 공개 `/api/version`에서도 이 릴리스 `df588ec`를 확인한 뒤 새 배포로 전환되는 것을 확인했다.

### 2026-09-17 편집 화면 정리

수업을 준비하는 사람이 한 번에 한 가지만 보도록 편집 화면을 정리했다. 수업 단위 설정을 「수업 정보」 화면으로 옮기고, 개념 선택을 칩과 검색으로 바꾸고, 하단 상시 단추를 다섯에서 둘로 줄이고, 초안 삭제를 화면 안 확인으로 바꿨다. **DB 스키마·서버 API·발행 규칙은 바뀌지 않았으므로 migration도 콘텐츠 작업도 없다** — 새 앱 이미지만 올라간다.

세 PR을 쌓아 올렸는데 #51이 main이 아니라 스택 아래 브랜치로 머지되어 그 내용이 main에 닿지 않았다. 닫힌 PR은 base를 옮길 수 없으므로 같은 브랜치를 main 위로 rebase해 **#53**으로 다시 열어 머지했다(rebase가 이미 squash된 커밋을 patch-id로 알아보고 떨군다). main에는 `c8233aa`(#50) → `ff14817`(#53) → `a984737`(#52) 순으로 올라갔다.

각 단계에서 격리된 MySQL 테스트 DB로 24개 파일 392개 테스트, 웹·모바일 빌드가 통과했다. 세 번의 main 실행이 모두 검증·배포에 성공했고, 마지막 배포 후 공개 `/api/version`이 `a984737`, `/api/health`가 ready임을 확인했다. 화면 확인은 데스크톱 1440×900과 375px에서 직접 조작으로 했고 렌더 자동 테스트는 여전히 없다.

## 운영 후속 작업

- 백업 생성·복원 훈련과 복구 소요 시간 확인. 계정 데이터를 전체 삭제한 뒤라 되돌릴 수단이 없는 상태가 실제로 확인됐다.
- 계정 삭제·데이터 보관 절차, 장애 관측과 모니터링 확장.
- 사용자 결정에 따라 Google 동의 화면의 공유 이름 변경.
- 인증서 갱신과 DB CA/호스트 변경 시 앱·migrator의 TLS 연결 및 프록시 설정 재검증.

새 릴리스는 해당 Actions 성공과 공개 `/api/health`·`/api/version`을 확인한다. 과거 릴리스의 성공 기록만으로 현재 배포 상태를 확정하지 않는다.

구현 근거: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google 공식 Node.js 인증 라이브러리](https://github.com/googleapis/google-auth-library-nodejs).
