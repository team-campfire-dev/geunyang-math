# DB 콘텐츠 관리

2026-09-14 · [DB 콘텐츠 전환 #6](https://github.com/team-campfire-dev/geunyang-math/pull/6) 운영 반영 완료. 릴리스별 검증은 [배포 기록](deployment.md#릴리스별-검증-기록)을 따른다.

기본 콘텐츠와 이후 발행한 콘텐츠의 운영 원본은 MySQL이다. 앱은 `ClassVersion`, `DiagnosticVersion`, `Skill`을 읽는다. 클래스·진단 문항·개념 이름을 TypeScript/JSON 파일에서 불러오는 런타임 경로는 없다.

## 저장 구조

- `ClassVersion.document`: 클래스 섹션, 콘텐츠 블록, 문항, 비공개 채점 규칙·힌트·해설, 숙제 문항 ID를 함께 보관하는 불변 JSON 문서.
- `DiagnosticVersion`: 진단 이름·설명·예상 시간·발행 시각과 불변 문항 JSON. `diagnosticKey=starting-point`의 최신 발행 판본을 새 진단에 사용한다.
- `Skill`: 개념 키, 화면에 표시하는 이름, 표시 순서. 이름과 순서는 수정할 수 있다.
- `Enrollment.classVersionId`, `AssignmentItem.problemSnapshot`, `DiagnosticRun.document`: 수강·과제·진단의 기존 판본을 계속 참조하거나 복사해 보존한다.

JSON은 DB 안의 확장 가능한 블록 형식이다. `kind`, `typeVersion`, `payload`, `required`, `fallback` 계약은 유지한다. 기존 블록으로 만든 콘텐츠는 앱 재배포 없이 등록할 수 있다. 새로운 그래프·도형 블록 종류는 검증 스키마와 웹/모바일 렌더러를 추가한 뒤 배포해야 한다. 이번 변경은 편집 UI나 AI 생성기를 추가하지 않는다.

## 초기 설치와 기존 DB 업그레이드

`20260914030000_database_content` migration이 기본 3개 클래스(문항 15개), 진단 1개(문항 6개), 개념 3개를 한 번 등록한다. 클래스 판본이 이미 있으면 내용, 해시, 발행 시각을 그대로 둔다. 기존 진단 실행과 과제 snapshot을 변경하지 않는다. 테이블 및 UTF-8 SQL 문자열 비교에 기존과 동일한 `utf8mb4_unicode_ci`를 명시한다.

배포는 `db:migrate → content:verify` 순서다. 매번 기본 파일을 다시 등록하지 않는다. `db:seed`는 이전 명령 호환용 읽기 전용 검증 별칭이다. migration SQL의 초기 데이터와 `tests/fixtures/initial-content.json`은 역사적 이전 자료·테스트 fixture이므로 운영 콘텐츠를 수정하는 곳이 아니다.

## 콘텐츠 내보내기·등록

검토된 DB 접속 환경의 서버/관리자 터미널에서 실행한다. `DATABASE_URL`은 해당 DB로 설정한다. 명령은 지정된 DB를 대상으로 하며 운영용 비밀값은 셸 기록이나 저장소에 적지 않는다.

```sh
npm run content:verify
npm run content:export -- --out /secure/path/content-export.json
npm run content:import -- --file /secure/path/reviewed-content.json --dry-run
npm run content:import -- --file /secure/path/reviewed-content.json
npm run content:verify
```

내보내기에는 정답·채점 규칙·힌트·해설이 포함된다. 파일은 `0600` 권한으로 새로 만들며 기존 파일을 덮어쓰지 않는다. 공개 API나 모바일 번들에 포함하지 않는다. 등록·검증 결과는 개수만 출력한다. 웹 사용자에게 등록 API를 제공하지 않는다.

번들 형식은 아래와 같다. 내보낸 파일을 복사해 편집하면 각 문서의 전체 형식을 확인할 수 있다.

```json
{
  "schemaVersion": 1,
  "skills": [],
  "classes": [],
  "diagnostics": []
}
```

필요한 항목만 넣는 부분 등록도 지원한다. 예를 들어 기존 개념을 참조하는 새 클래스만 넣고 `skills`와 `diagnostics`는 빈 배열로 두어도 된다. 개념 키는 기존 DB 또는 같은 번들에 반드시 있어야 한다. 파일 크기는 최대 5 MiB이며 큰 번들은 나누어 등록한다.

발행한 클래스/진단은 덮어쓰지 않는다. 수정하려면 `versionId`를 새로 부여한다. 내용이 바뀐 문항도 `problemVersionId`를 새로 부여하고 섹션·숙제 참조를 함께 변경한다. 클래스·진단의 같은 판본 ID에 동일 내용을 재등록하면 기존 판본을 변경하지 않는다. `Skill`은 같은 키로 이름·표시 순서를 갱신할 수 있다. MySQL이 JSON 객체 키 순서를 바꾸어도 의미가 같으면 동일한 내용으로 판단한다. 기존 해시는 다시 계산하지 않으며 새 판본 해시는 정렬된 JSON 키를 기준으로 계산한다.

새 클래스/진단 판본은 번들 배열 순서대로 발행된다. 같은 classKey/diagnosticKey를 가진 새 판본 중 마지막 항목이 최신이 된다. 내보내기도 발행 순서로 제공한다. 이미 있는 판본 재등록은 최신 판본을 되돌리지 않는다. 이전 내용으로 되돌리고 싶다면 새 판본 ID로 재발행한다.

등록 전 전체 참조와 문서 형식을 검사한다. 알 수 없는 필수 블록, 중복 ID, 없는 개념, 바뀐 기존 판본, 기존 문제 ID의 다른 내용, 클래스와 진단에 겹치는 문제 ID는 거부한다. 쓰기는 한 DB 트랜잭션으로 처리하며 `--dry-run`은 쓰지 않는다.

## 학습 중 콘텐츠가 추가되면

새로 수강하는 사람에게 최신 클래스가 제공된다. 이미 수강한 사람은 시작했던 클래스 판본을 유지한다. 배정된 과제와 저장한 답안도 그대로다. 시작점 확인의 안내·문항 수·예상 시간은 DB에서 읽고, 시작한 진단은 그때 복사한 문항으로 끝까지 이어간다. 진단 개편만으로 진행 중인 진단을 교체하지 않는다. 완료 후 재진단을 안내하는 별도 UX는 후속 범위다.

## 검증

`tests/content-store.test.ts`에서 MySQL 초기 데이터, 내보내기 재등록, dry run, DB만으로 새 클래스·개념·진단 제공, 불변 판본·문항 보호, 과제와 진단 snapshot 보존을 검사한다. 기존 채점·개인화·인증 테스트도 함께 실행한다. 전체 190개 테스트·타입 검사·웹/모바일 빌드를 통과했다. 로컬에서 이전 릴리스의 DB와 학습 기록을 생성한 뒤 새 migration을 적용해 기존 모든 행과 해시·시각·snapshot이 동일함을 확인했다. 운영에서도 migration·배포 성공과 공개 클래스 3개·블록·15문항의 이전 내용 일치를 확인했다. 이 검증은 수학 콘텐츠의 전문가 검수를 대신하지 않는다.
