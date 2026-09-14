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

이번 운영 범위는 공개 클래스 카탈로그와 수업 설명 열람이다. Google OAuth가 없는 상태이므로 운영 환경에서는 개발용 계정 생성과 기존 개발 세션 사용을 모두 거부한다. 개인 학습 저장을 공개하려면 운영용 인증을 별도로 연결해야 한다.

## Cooo에서 참고한 부분

Cooo의 같은 앱·DB VM, Nginx Proxy Manager(NPM), 와일드카드 인증서를 사용한다. 사용 포트를 실제 조회해 기존 3000~3006과 겹치지 않는 3007을 선택했다. Cooo의 이미지 빌드→스키마 준비→앱 교체→healthy 확인 순서를 따르되, geunyang math는 `prisma migrate deploy`와 불변 seed를 사용한다. 공유 VM의 이미지 prune이나 다른 Compose 프로젝트 변경은 실행하지 않는다.

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
| `ENV_FILE` | 앱 계정의 DATABASE_URL, APP_ORIGIN, DEV_LOGIN_ENABLED=false |
| `MIGRATION_ENV_FILE` | migration 계정의 DATABASE_URL, DEV_LOGIN_ENABLED=false |

환경 파일과 키는 Git에 넣지 않는다. 값은 shell 코드 안에 직접 삽입하지 않고 환경변수→권한 0600 파일→SCP로 전달한다. 앱 컨테이너에는 migration 계정 비밀번호를 전달하지 않는다. 서버·시크릿 준비 후 repository variable `ORACLE_DEPLOY_ENABLED=true`를 설정해야 자동 배포가 활성화된다.

## HTTPS 프록시

사용할 와일드카드 인증서는 NPM의 `npm-8`이며 2026-11-17까지 유효함을 확인했다. DNS는 기존 Cloudflare 경로로 해석된다. [NPM의 공식 custom HTTP 설정](https://nginxproxymanager.com/advanced-config/#custom-nginx-configurations)을 이용한다.

[geunyang-math.conf](../deploy/nginx/geunyang-math.conf)를 앱 VM의 `/home/ubuntu/nginx/data/nginx/geunyang-math/server.conf`에 두고, `/home/ubuntu/nginx/data/nginx/custom/http.conf`에서 다음 한 줄로 포함한다.

```nginx
include /data/nginx/geunyang-math/server.conf;
```

기존 설정을 백업하고 `docker exec nginx-app-1 nginx -t`가 성공한 뒤 reload한다. 실패하면 추가 설정만 복구한다. 이 호스트는 저장소에서 관리하는 custom 설정이며 NPM UI의 Proxy Hosts 목록에 자동 등록되는 항목은 아니다. 같은 도메인의 UI 항목을 중복 생성하지 않는다.

## 배포와 복구

[GitHub workflow](../.github/workflows/ci.yml)는 모든 브랜치의 타입·단위/실제 MySQL 검사·웹/모바일 빌드를 실행한다. 운영 배포는 검증에 성공한 `main` push 또는 `main`의 수동 실행에서만 진행한다. PR에서는 배포 비밀값을 사용하지 않는다.

검증한 Git SHA의 archive와 환경 파일을 `incoming/`으로 전송한다. SHA별 `releases/<sha>/` 디렉터리에서 [deploy-remote.sh](../scripts/deploy-remote.sh)를 실행한다. 스크립트는 앱과 migrator 이미지를 따로 만들고, migration→seed→기동→사설·공개 health/version 확인이 끝나야 `current`를 새 릴리스로 바꾼다.

이전 릴리스와 해당 환경 파일은 복구를 위해 보존한다. 실패하면 이전 앱 이미지와 환경으로 복귀한다. 앱 복귀는 이미 적용한 DB migration을 되돌리지 않으므로 후속 migration은 이전 앱과 호환되도록 작성해야 한다. 자동화는 운영 DB의 DROP이나 데이터 삭제 권한을 새로 부여하지 않는다.

독립 앱 서비스만 교체하므로 같은 VM의 Cooo·서랍·Constella 등은 재시작하지 않는다. 새 배포가 진행 중인 운영 workflow를 자동 취소하지 않으며, 원격에서도 프로젝트별 잠금을 사용한다.

## 검증 기록

- 앱 VM 자원·포트와 DB 서버 버전·TLS 지원: 읽기 전용 확인 완료.
- 기존 DNS와 와일드카드 인증서: 확인 완료.
- ARM64 앱 이미지와 별도 migrator: 로컬 컨테이너 빌드·실행 성공. non-root, health, revision, 개발 로그인 차단 확인.
- 콘텐츠·학습/과제·인증/TLS 검사 89개 통과. 배포 포인터 복구 회귀 검사 5개 추가 통과.
- 운영 DB·계정 생성: 사용자의 명시적 승인 후 생성 완료. 두 계정의 DB 한정 권한과 앱 VM 호스트 제한, REQUIRE SSL을 확인함.
- NPM custom HTTPS 프록시: 기존 설정 백업, nginx 문법 검사와 reload 완료.
- GitHub 배포 시크릿: 사용자의 명시적 승인 후 6개 등록 완료. `ORACLE_DEPLOY_ENABLED=true` 설정 완료.
- 실제 DB TLS 연결, 운영 migration, 공개 HTTPS: 최초 운영 배포의 검증 항목. 실행 결과와 배포 SHA는 [GitHub Actions](https://github.com/team-campfire-dev/geunyang-math/actions)의 운영 배포 기록에서 확인한다.

운영 연결 후에는 TLS cipher 존재, 잘못된 CA/호스트 이름 거부, 앱 계정의 DDL 거부, health 200, 정확한 commit, 카탈로그 3개, 비인증 쓰기 거부를 확인한다. 이 준비 기록은 특정 후속 릴리스의 정상 상태를 보장하지 않으며, 릴리스별 성공 여부는 해당 배포 실행 결과를 기준으로 한다.
