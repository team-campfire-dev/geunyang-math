# Oracle 운영 배포

2026-09-14 기준 운영 배포 완료. 최근 기능 릴리스는 DB 콘텐츠 전환 `0c5e505`이며, 릴리스별 실행과 검증 범위는 아래 [검증 기록](#릴리스별-검증-기록)을 기준으로 한다. 문서 변경 이후 최신 배포 commit은 `/api/version`과 GitHub Actions에서 확인한다.

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

비로그인 사용자는 클래스 카탈로그와 수업 설명을 열람할 수 있다. Google 로그인 후에는 개인 진도·답안·과제·진단·추천 이력을 저장하고 같은 계정으로 복원한다. Google 운영 로그인·설정 복원과 DB 콘텐츠 전환 후 기존 학습 상태 조회를 확인했다. 개발용 계정 생성과 기존 개발 세션 사용은 운영에서 거부한다.

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

Google `sub`를 대소문자까지 구분해 `GoogleIdentity`에 연결한다. 같은 Google 계정으로 다시 로그인하면 같은 User·개인 Scope·수강·과제를 읽는다. 이메일이나 이름이 같아도 다른 Google 계정 또는 개발 계정을 자동 연결하지 않는다. 운영 세션은 7일의 `__Host-gm_session` Secure·HttpOnly·SameSite=Lax host-only cookie이고, 재로그인 시 기존 브라우저 세션을 회전한다. 로그아웃은 동일 origin을 확인한 후 서버 세션과 cookie를 폐기한다. 기존 `gm_session`과 `authMethod=development` 세션은 production에서 계속 거부한다.

`20260914010000_google_auth` migration은 Session의 `authMethod`를 기본값 `development`로 추가하고 GoogleIdentity·OAuthAttempt 테이블을 만든다. 기존 데이터나 baseline migration을 수정·삭제하지 않으며, 현재 migration 계정의 CREATE·ALTER·INDEX·REFERENCES 권한으로 적용한다. rollback 시 앱만 복구하고 이미 적용한 schema는 유지한다.

인증 코드, ID/access/refresh token, 세션 cookie, client secret, 원문 provider 오류를 Git·브라우저 저장소·배포 출력·앱 로그·crash report에 남기지 않는다. 앱은 Google access/refresh token을 영속 저장하지 않고 callback 실패를 `cancelled`, `expired`, `unavailable`, `failed` 중 하나로만 돌려준다. NPM 호스트 #9에는 `/api/auth/google/callback` custom location을 추가하고 `access_log off; error_log /dev/null crit;`를 적용했다. 정상 HTTPS 콜백의 인증 query는 NPM 로그에서 제외하며 upstream에는 그대로 전달한다. HTTP→HTTPS 리디렉션 로그나 Cloudflare 내부 로그의 수집 여부까지 보증하지 않는다. 전체 `$request`·`$request_uri`나 URL query를 수집하는 로깅·APM 설정은 이 경로에서 제거하거나 마스킹한다. 앱 로그 보호만으로 NPM·Cloudflare 로그 설정까지 검증한 것으로 간주하지 않는다.

배포 후에는 health/version과 함께 session의 `googleLogin=true`, Google 승인 화면과 정확한 callback, 취소·만료의 안전한 복귀, 정상 로그인, 클래스 학습 저장, 로그아웃 후 접근 차단, 같은 Google 계정으로 재로그인한 기록 복원을 확인한다. Google 계정을 바꿔 다른 사람의 학습 기록이 보이지 않는지도 확인한다. 실제 계정의 동의·로그인 결과는 자동 테스트와 구분해 기록한다. 네이티브 인증은 별도 구현이며 현재 웹 흐름을 WebView에 그대로 적용하지 않는다.

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

검증한 Git SHA의 archive와 환경 파일을 `incoming/`으로 전송한다. SHA별 `releases/<sha>/` 디렉터리에서 [deploy-remote.sh](../scripts/deploy-remote.sh)를 실행한다. 스크립트는 앱과 migrator 이미지를 따로 만들고, migration→저장소 번들 발행→content:verify→기동→사설·공개 health/version 확인이 끝나야 `current`를 새 릴리스로 바꾼다.

릴리스 archive는 제한된 파일 권한을 유지한다. Dockerfile은 migrator가 읽는 package·Prisma 설정·소스를 `node` 사용자 소유로 복사한다. CI는 실제로 권한 600/700의 archive에서 migrator를 빌드하고, 일반 사용자로 소스를 읽으며 빈 테스트 DB에 migration과 콘텐츠 검증을 실행하는지 검사한다. 최초 배포에서 확인된 root 소유 파일의 `EACCES` 재발을 이 경로로 검증한다.

릴리스 포인터를 새로 커밋한 뒤에는 현재와 직전 릴리스만 남기고 이전 릴리스 디렉터리, 그 SHA의 앱·migrator 이미지, 지난 배포의 롤백 태그, `incoming/`에 남아 있던 비공개 환경 파일 사본을 지운다. 배포마다 이미지 두 개(앱 468MB, migrator 1.6GB)가 쌓여 디스크를 채우던 문제를 막고, 오래된 환경 파일 사본도 함께 정리하기 위해서다. 빌드 캐시는 이 VM의 다른 프로젝트와 공유하므로 72시간 이상 쓰이지 않은 항목만 지운다. 이 단계는 커밋 이후에 실행하며, 실패해도 기록만 남기고 배포 결과를 바꾸지 않는다.

이전 릴리스와 해당 환경 파일은 복구를 위해 보존한다. 실패하면 이전 앱 이미지와 환경으로 복귀한다. 앱 복귀는 이미 적용한 DB migration을 되돌리지 않으므로 후속 migration은 이전 앱과 호환되도록 작성해야 한다. 자동화는 운영 DB의 DROP이나 데이터 삭제 권한을 새로 부여하지 않는다.

독립 앱 서비스만 교체하므로 같은 VM의 Cooo·서랍·Constella 등은 재시작하지 않는다. 새 배포가 진행 중인 운영 workflow를 자동 취소하지 않으며, 원격에서도 프로젝트별 잠금을 사용한다.

## 릴리스별 검증 기록

모든 날짜는 2026-09-14다. 아래 commit은 기능 검증 당시의 릴리스이며, 후속 문서 배포의 commit과 다를 수 있다.

| 릴리스 | commit | 검증·운영 결과 |
|---|---|---|
| [Google 로그인 #4](https://github.com/team-campfire-dev/geunyang-math/pull/4) | `4509346` | 161개 테스트, 웹·모바일 빌드, 운영 DB migration·배포 성공. 실제 Google 로그인에서 학습 시간 저장→로그아웃→같은 계정 재로그인 복원 확인. [실행](https://github.com/team-campfire-dev/geunyang-math/actions/runs/34805433313) |
| [규칙 기반 개인화 #5](https://github.com/team-campfire-dev/geunyang-math/pull/5) | `87a1717` | 179개 테스트, 웹·모바일 빌드·운영 배포 성공. 로컬 브라우저 진단 이어하기·추천 변경·직접 선택 검증, 운영 개인화 화면 조회 확인. [실행](https://github.com/team-campfire-dev/geunyang-math/actions/runs/34809013344) |
| [DB 콘텐츠 관리 #6](https://github.com/team-campfire-dev/geunyang-math/pull/6) | `0c5e505` | 190개 테스트, 신규 DB 설치·기존 DB 업그레이드·CLI 검증, 웹·모바일 빌드·Oracle 배포 성공. 공개 클래스 3개·블록·15문항의 이전 내용 일치와 기존 계정 학습 상태 조회 확인. [실행](https://github.com/team-campfire-dev/geunyang-math/actions/runs/34811307476) |
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
| [용어 편집 화면 #23](https://github.com/team-campfire-dev/geunyang-math/pull/23) | `3551f86` | 공통 사전과 클래스 용어를 화면에서 쓰고 고친다. 저장이 곧 다음 판본의 발행. 배포 성공. |
| [본문에서 `@`로 걸기 #24](https://github.com/team-campfire-dev/geunyang-math/pull/24) | `7f98fe6` | 저장 형식은 그대로 두고 거는 방법만 바꿨다. 몇 번째 낱말인지는 적은 자리가 정한다. 배포 성공. |
| [노출 판단을 작성자에게 #25](https://github.com/team-campfire-dev/geunyang-math/pull/25) | `5a83905` | 서버가 진도로 용어를 숨기던 규칙을 걷어냈다. 발행된 v4 판본은 자기 개념에 주석을 달지 않아 배포 직후 보이는 용어가 늘지는 않는다. 배포 성공. |

#22는 base가 `feat/scoped-terms`였던 스택 PR이라 머지 결과가 main에 닿지 않았고, 같은 내용을 #23으로 다시 올렸다.

DB 콘텐츠 migration `20260914030000_database_content`는 Skill·DiagnosticVersion과 초기 콘텐츠를 등록한다. 기본 콘텐츠는 클래스 3개(수업·숙제 문항 15개), 진단 1종(6문항), 개념 3개다. 기존 ClassVersion 행의 내용·해시·발행 시각을 덮어쓰지 않는다. 배포용 migrator는 `db:migrate` 후 저장소의 `content/*.json`을 `content:publish`로 발행하고 `content:verify`를 실행한다. `AppliedContentBundle`에 같은 checksum이 있으면 건너뛰므로 내용이 그대로인 배포는 DB를 건드리지 않고, 이미 발행한 판본을 고쳐 커밋하면 배포가 실패한다. 등록 명령과 불변 판본 정책은 [DB 콘텐츠 관리](content-management.md)를 따른다. `20260915020000_published_problem_index`는 문항 이름 색인 `PublishedProblem`을 만들고 이미 발행된 문서에서 한 번 채운다. 발행된 내용은 건드리지 않으므로 되돌릴 때는 이전 이미지를 다시 띄우면 되고, 표를 남겨 두어도 앱은 영향을 받지 않는다. `20260915030000_class_section_blocks`는 섹션과 블록 표를 만들고 같은 방식으로 채운다. 운영 기준으로 판본 6개에서 섹션 30개·블록 134개가 나오므로, 배포 후 `content:verify`가 `indexedBlocks: 134`, `indexedProblems: 36`을 보고해야 한다. 어긋나면 배포가 그 자리에서 멈춘다. `20260916000000_read_class_from_rows`부터 앱이 클래스를 **행에서 읽는다**. `ClassVersion.metadata`와 `PublishedProblem`의 문항 칸들을 채우고, `content:verify`는 행을 도로 맞춘 결과가 `document`와 같은지 대조한다.

되돌리기: 이전 이미지는 `document`를 읽고 그 칸은 그대로 기록되므로 학습 화면은 그대로 돈다. 다만 **되돌린 상태에서 새 콘텐츠를 발행하면 실패한다** — 옛 코드는 새로 생긴 필수 칸을 채우지 않는다. 되돌린 동안에는 발행을 하지 않는다.

초기 인프라 점검에서는 앱 VM·포트·DNS·와일드카드 인증서, ARM64 non-root 이미지·revision·health, DB TLS 연결과 잘못된 CA/호스트 이름 거부, 앱 계정의 DB 한정 DML·호스트 제한·REQUIRE SSL을 확인했다. NPM Proxy Hosts 등록과 Google HTTPS callback 로그 제외, 배포 시크릿 6개와 자동 배포 활성화도 완료했다. 이 기록은 이후 인증서·권한·프록시 변경을 자동 검증한다는 뜻은 아니다.

최근 기능 릴리스에서는 공개 health 정상, 정확한 commit, `googleLogin=true`·`developmentLogin=false`를 확인했다. 공개 API의 클래스 문서에서 비공개 채점 명세가 노출되지 않음을 비교했다. 운영 화면 점검은 기존 계정의 조회만 수행했고 실제 진단·과제 답안을 새로 제출하지 않았다. 기존 DB 업그레이드의 모든 행·해시·시각·snapshot 보존 비교는 별도의 로컬 테스트 DB에서 수행했다.

## 운영 콘텐츠·데이터 작업 기록

2026-09-15에 수식과 용어 주석을 담은 클래스 판본 `fraction-meaning:v4`·`fraction-equivalence:v4`·`fraction-addition:v4`를 운영에 발행했다. migrator 이미지로 `content:import`를 실행했고 `newClasses: 3`, 용어는 이미 등록되어 `unchangedVersions: 6`이었다. 공개 API에서 카탈로그가 v4로 바뀌고 수식·용어 주석·glossary가 내려오는 것을 확인했다. 기존 판본은 그대로 남아 있다.

같은 날 요청에 따라 운영 DB의 계정 데이터를 전부 삭제했다. FK 자식부터 `AssessmentRevision`·`SubmissionItem`·`Attempt`·`Submission`·`AssignmentRecipient`·`AssignmentItem`·`Assignment`·`Enrollment`·`HintUse`·`DiagnosticRun`·`RecommendationHistory`·`Session`·`GoogleIdentity`·`OAuthAttempt`·`Scope`·`User` 순으로 비웠다. 콘텐츠 테이블은 건드리지 않았고 삭제 후 `content:verify`로 클래스 6판본·문항 30·개념 3·진단 1·용어 6이 그대로임을 확인했다. 되돌릴 백업 절차는 아직 없다.

수동 작업 중 확인한 제약이 두 가지 있다. 첫째, `scp`로 올린 번들은 `ubuntu`(uid 1001) 소유 0600이라 `node`(uid 1000)로 도는 컨테이너가 읽지 못한다. `--user 1000:1001`과 그룹 읽기 권한으로 실행한 뒤 권한을 되돌린다. 둘째, `migrate` 서비스만 쓰더라도 Compose는 파일 전체를 해석하므로 `APP_BIND_IP`·`DEPLOY_ENV_FILE`까지 필요하다. 일회성 작업은 같은 환경 파일·CA·호스트 별칭을 주어 `docker run`으로 직접 실행하는 편이 간단하다.

## 운영 후속 작업

- 백업 생성·복원 훈련과 복구 소요 시간 확인. 계정 데이터를 전체 삭제한 뒤라 되돌릴 수단이 없는 상태가 실제로 확인됐다.
- 계정 삭제·데이터 보관 절차, 장애 관측과 모니터링 확장.
- 사용자 결정에 따라 Google 동의 화면의 공유 이름 변경.
- 인증서 갱신과 DB CA/호스트 변경 시 앱·migrator의 TLS 연결 및 프록시 설정 재검증.

새 릴리스는 해당 Actions 성공과 공개 `/api/health`·`/api/version`을 확인한다. 과거 릴리스의 성공 기록만으로 현재 배포 상태를 확정하지 않는다.

구현 근거: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google 공식 Node.js 인증 라이브러리](https://github.com/googleapis/google-auth-library-nodejs).
