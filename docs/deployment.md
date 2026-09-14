# Oracle 운영 배포

2026-09-14 배포 준비. 현재 상태는 아래 검증 기록을 기준으로 한다.

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

기존 공개 범위는 클래스 카탈로그와 수업 설명 열람이다. 이번 변경에는 Google 웹 로그인과 같은 Google 계정의 학습 기록 복원을 구현했고 전용 Google web client·배포 시크릿을 준비했다. 운영에서 개인 학습 저장을 제공하는 상태는 해당 릴리스의 배포·실계정 검증 결과로 확정한다. 개발용 계정 생성과 기존 개발 세션 사용은 운영에서 계속 거부한다.

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

인증서는 2026-11-17까지 유효함을 확인했다. 프록시 호스트와 인증서 설정은 NPM UI에서 변경하며, 앱 배포 workflow는 이 설정을 수정하지 않는다.

UI 관리 방식으로 전환하면서 기존 custom HTTP 설정을 백업하고, `/home/ubuntu/nginx/data/nginx/custom/http.conf`에서 이 프로젝트 설정을 포함하던 한 줄만 제거했다. 서버에 남아 있는 `/home/ubuntu/nginx/data/nginx/geunyang-math/server.conf`는 현재 비활성 파일이며 사용하지 않는다. 저장소의 이전 custom 프록시 설정과 설치 스크립트도 제거했다. 같은 도메인의 변경은 기존 Proxy Hosts 항목에서 진행한다.

## 배포와 복구

[GitHub workflow](../.github/workflows/ci.yml)는 모든 브랜치의 타입·단위/실제 MySQL 검사·웹/모바일 빌드를 실행한다. 운영 배포는 검증에 성공한 `main` push 또는 `main`의 수동 실행에서만 진행한다. PR에서는 배포 비밀값을 사용하지 않는다.

검증한 Git SHA의 archive와 환경 파일을 `incoming/`으로 전송한다. SHA별 `releases/<sha>/` 디렉터리에서 [deploy-remote.sh](../scripts/deploy-remote.sh)를 실행한다. 스크립트는 앱과 migrator 이미지를 따로 만들고, migration→content:verify→기동→사설·공개 health/version 확인이 끝나야 `current`를 새 릴리스로 바꾼다.

릴리스 archive는 제한된 파일 권한을 유지한다. Dockerfile은 migrator가 읽는 package·Prisma 설정·소스를 `node` 사용자 소유로 복사한다. CI는 실제로 권한 600/700의 archive에서 migrator를 빌드하고, 일반 사용자로 소스를 읽으며 빈 테스트 DB에 migration과 콘텐츠 검증을 실행하는지 검사한다. 최초 배포에서 확인된 root 소유 파일의 `EACCES` 재발을 이 경로로 검증한다.

이전 릴리스와 해당 환경 파일은 복구를 위해 보존한다. 실패하면 이전 앱 이미지와 환경으로 복귀한다. 앱 복귀는 이미 적용한 DB migration을 되돌리지 않으므로 후속 migration은 이전 앱과 호환되도록 작성해야 한다. 자동화는 운영 DB의 DROP이나 데이터 삭제 권한을 새로 부여하지 않는다.

독립 앱 서비스만 교체하므로 같은 VM의 Cooo·서랍·Constella 등은 재시작하지 않는다. 새 배포가 진행 중인 운영 workflow를 자동 취소하지 않으며, 원격에서도 프로젝트별 잠금을 사용한다.

## 검증 기록

- 앱 VM 자원·포트와 DB 서버 버전·TLS 지원: 읽기 전용 확인 완료.
- 기존 DNS와 와일드카드 인증서: 확인 완료.
- ARM64 앱 이미지와 별도 migrator: 로컬 컨테이너 빌드·실행 성공. non-root, health, revision, 개발 로그인 차단 확인.
- Google OAuth 변경 후 로컬 전체 검사 161개와 타입 검사 통과. OAuth 공식 verifier 단위 검사 21개·MySQL 인증 통합 검사 10개, 클라이언트 인증 경계 검사 28개 포함. 실제 Google 계정의 로그인 결과와는 구분한다.
- 운영 DB·계정 생성: 사용자의 명시적 승인 후 생성 완료. 두 계정의 DB 한정 권한과 앱 VM 호스트 제한, REQUIRE SSL을 확인함.
- NPM Proxy Hosts UI: 도메인과 `http://10.0.0.130:3007` 연결, 와일드카드 SSL 설정 저장 및 Online 상태 확인. 기존 custom include는 백업 후 제거 완료.
- GitHub 배포 시크릿: 사용자의 명시적 승인 후 6개 등록 완료. `ORACLE_DEPLOY_ENABLED=true` 설정 완료.
- Google OAuth 전용 web client 생성과 앱 배포 시크릿 등록: 완료. 릴리스별 운영 배포·추가 migration·실계정 검증 결과는 아래 Actions 실행과 별도 배포 결과 기록을 기준으로 확인.
- 실제 DB TLS 연결, 운영 migration, 공개 HTTPS와 배포 SHA는 [GitHub Actions](https://github.com/team-campfire-dev/geunyang-math/actions)의 운영 배포 기록에서 확인한다. 기존 릴리스의 성공을 새 OAuth 릴리스의 검증 완료로 취급하지 않는다.

운영 연결 후에는 TLS cipher 존재, 잘못된 CA/호스트 이름 거부, 앱 계정의 DDL 거부, health 200, 정확한 commit, 카탈로그 3개, 비인증 쓰기 거부를 확인한다. 이 준비 기록은 특정 후속 릴리스의 정상 상태를 보장하지 않으며, 릴리스별 성공 여부는 해당 배포 실행 결과를 기준으로 한다.

구현 근거: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google 공식 Node.js 인증 라이브러리](https://github.com/googleapis/google-auth-library-nodejs).
