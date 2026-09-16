# 용어 사전을 스키마와 코드에 반영하는 변경안

기준일: 2026-09-16 · 상태: **확정(2026-09-17). 아래 「확정된 결정」의 권장안대로 진행한다.** 진척: A 개명, B 코스·정체 표 반영.

[용어 사전](glossary.md)의 결정을 DB 스키마와 코드에 옮기는 순서다. 이름의 기준은 코드가 아니라 용어 사전이고, 지금 코드의 이름은 그 문서의 「옛 이름과의 대응」을 따른다.

## 전제

**운영 데이터를 보존하지 않는다.** 아직 실사용 서비스가 아니라는 판단이다. 그래서 이 안은 판형이 바뀌는 단계마다 콘텐츠와 학습 기록을 **지우고 다시 심는** 쪽을 택한다. 판본을 옮기는 SQL을 단계마다 쓰는 것보다 훨씬 적은 코드로 같은 결과를 내고, 되돌릴 과거가 없으므로 해시·발행 시각·학습 기록의 보존 검증도 필요 없다.

바뀌는 것은 데이터 쪽 전제만이다. 아래 규칙은 그대로 지킨다.

- 발행된 판본은 불변이고, 고치면 새 판본이다. 판본 ID는 수업·진단·뜻풀이·**문제집**을 통틀어 겹치지 않는다(`ContentBlock`이 자신을 가진 판본 ID로 매달린다).
- 정답·채점·권한 검사는 서버에 둔다. `src/core/*`의 `server-only` 경계를 옮기지 않는다.
- 블록 스키마는 `kind@typeVersion`이 식별한다. 형이 바뀌면 `typeVersion`을 올린다. 다만 지우고 다시 심는 이 안에서는 옛 판을 쓰는 발행 판본이 남지 않으므로 옛 스키마를 `retired`로 두지 않고 **지운다**(데이터를 보존했다면 지울 수 없었을 것이다).

두 가지 제약이 순서와 방식을 정한다.

- **migrator 계정에 DROP 권한이 없다**([배포 문서](deployment.md)의 계정 표: DML, CREATE, ALTER, INDEX, REFERENCES). `RENAME TABLE`은 옛 이름에 DROP이 필요하고, `Skill`·`TermVersion`을 없애는 것도 DROP이다. 그래서 **A 단계 전에 운영 migrator에 DROP을 한 번 부여해야 한다**(DB VM root). 부여하지 않으면 새 이름으로 표를 만들고 `INSERT … SELECT`로 복사한 뒤 옛 표를 남기는 수밖에 없고, 그것은 이 안의 취지에 맞지 않는다.
- **앱 복귀는 migration을 되돌리지 않는다**(배포 문서: "후속 migration은 이전 앱과 호환되도록 작성해야 한다"). 이름을 바꾸는 A 단계부터 이 호환은 깨진다. 실사용이 없으므로 **되돌리기는 앞으로 고쳐 나가는 것**으로 하고, 이 문장을 배포 문서에서 고친다. 또 배포 중 migration이 먼저 돌고 새 앱이 뒤에 뜨므로, 그 사이 옛 앱은 몇 분간 오류를 낸다.

## 1. 새로 생기는 것

### 코스와 정체 표

수업·문제집·진단은 판본이 아닌 **정체**(identity)를 따로 갖는다. 지금은 `classKey` 문자열이 정체를 대신하고 발행된 판본이 하나도 없는 수업은 초안 행으로만 존재하는데, 「코스 없이 떠 있는 수업은 없다」를 지키려면 초안 단계부터 코스가 정해져 있어야 한다. 그래서 정체 표는 **초안을 만들 때** 생기고, 판본 표는 발행할 때 생긴다. 판본이 0개인 정체 행은 「아직 발행되지 않은 것」이고, 카탈로그·health는 판본이 있는 것만 센다.

```prisma
model Course {
  id          String   @id @default(cuid())
  key         String   @unique @db.VarChar(100)   // 'fractions'
  title       String   @db.VarChar(191)
  summary     String   @default("") @db.VarChar(500)
  ownerUserId String?  @db.VarChar(191)           // null = 플랫폼. 조직 모델은 미정이라 자리만
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  lessons     Lesson[]
  problemSets ProblemSet[]
  diagnostics Diagnostic[]
}

model Lesson {                       // 정체. 코스 안 순서를 든다 = (코스, 수업) 연결
  key       String  @id @db.VarChar(100)
  courseId  String  @db.VarChar(191)
  course    Course  @relation(fields: [courseId], references: [id])
  order     Int
  createdAt DateTime @default(now())
  versions  LessonVersion[]
  @@index([courseId, order])
}

model ProblemSet {                   // 정체. name이 null이면 자동으로 생긴 것 = 목록에 안 뜬다
  id        String  @id @default(cuid())
  courseId  String  @db.VarChar(191)
  course    Course  @relation(fields: [courseId], references: [id])
  name      String? @db.VarChar(191)
  createdAt DateTime @default(now())
  versions  ProblemSetVersion[]
  @@index([courseId])
}

model ProblemSetVersion {            // 불변. 문제는 PublishedProblem 행, 블록은 ContentBlock 행
  id           String   @id @db.VarChar(191)      // 전역 판본 ID 규칙에 들어간다
  problemSetId String   @db.VarChar(191)
  problemSet   ProblemSet @relation(fields: [problemSetId], references: [id])
  contentHash  String   @db.VarChar(64)
  publishedAt  DateTime @default(now())
  @@index([problemSetId, publishedAt])
}

model Diagnostic {                   // 정체. 소유만 코스로 내린다
  key       String  @id @db.VarChar(100)
  courseId  String  @db.VarChar(191)
  course    Course  @relation(fields: [courseId], references: [id])
  versions  DiagnosticVersion[]
}
```

`LessonVersion.order`는 사라지고 `Lesson.order`가 코스 안 순서다. 코스는 얼리지 않으므로 순서 변경은 곧 반영된다.

### 개념 — `Skill`과 `TermVersion`을 합친 것

```prisma
model Concept {                      // 전역. key는 불변
  key         String  @id @db.VarChar(100)
  label       String  @db.VarChar(191)             // 공통 사전의 호칭
  assessable  Boolean                              // 문제가 이것을 평가할 수 있는가
  createdAt   DateTime @default(now())
  definitions ConceptDefinition[]
}

model ConceptDefinition {            // 범위별 호칭·뜻풀이. 얼리지 않고 초안도 없다 — 저장이 곧 최신
  id         String  @id @default(cuid())          // 블록이 이 ID로 매달린다 → 판본 ID 규칙에 들어간다
  conceptKey String  @db.VarChar(100)
  concept    Concept @relation(fields: [conceptKey], references: [key])
  scopeKind  String  @db.VarChar(20)               // ConceptScope: global | organization | course | lesson
  scopeKey   String  @default("") @db.VarChar(100)
  label      String? @db.VarChar(191)              // 이 범위의 호칭. null이면 Concept.label
  summary    String? @db.VarChar(500)              // 뜻풀이 한 줄. 블록이 없으면 호칭만 있는 행
  updatedAt  DateTime @updatedAt
  @@unique([conceptKey, scopeKind, scopeKey])
}
```

행마다 뜻풀이와 평가가 각각 있거나 없다는 용어 사전의 표가 그대로 이 두 표다. `분모`는 `assessable=false`에 뜻풀이가 있고, `분수를 크기 순으로 나열하기`는 `assessable=true`에 뜻풀이가 없다. 뜻풀이의 본문은 지금처럼 `ContentBlock` 행이고 `ownerKind='definition'`, `ownerVersionId=ConceptDefinition.id`다. 얼리지 않으므로 저장은 그 정의의 블록 행을 지우고 다시 쓰는 한 트랜잭션이다.

`ContentBlock.ownerVersionId`는 이제 판본이 아닌 것(뜻풀이)도 가리키므로 이름이 조금 어긋난다. 칸 이름을 `ownerId`로 바꾸는 것은 별도 결정으로 두고, 이 안에서는 그대로 둔다.

## 2. 없어지는 것

| 없어지는 것 | 대신 | 단계 |
|---|---|---|
| `Skill` 표, `Skill.order` | `Concept`. 화면의 개념 순서는 코스의 수업 순서에서 유도한다(그 개념을 처음 가르치는 수업의 순서, 없는 것은 뒤에 이름순) | C |
| `TermVersion` 표, `TermVersion.skillKey` | `ConceptDefinition`. 뜻풀이가 곧 개념이므로 「어느 개념의 용어인가」를 따로 적지 않는다 | C |
| `LessonVersion.order`(옛 `ClassVersion.order`), `metadata.public.order` | `Lesson.order` | B |
| `metadata.homeworkProblemIds` | `metadata.review` — 복습 후보 풀을 문제집 참조로 든다(아래 3) | D |
| `core.problem_set@1`(문제 ID 목록만) | `core.problem_set@2` — 문제집 ID + 판본 ID + 고른 문제 ID | D |
| `core.rich_text@2`의 `terms[].termKey` | `core.rich_text@3`의 `terms[].conceptKey` | C |
| `AssignmentRecipient.assignmentPolicy` | `Assignment.policy` | E |
| `AssignmentItem.problemSnapshot` | 문제집 판본이 불변이므로 `problemVersionId`로 읽는다 | E |
| `diagnosticProblemSchema`(힌트·해설 없는 별도 문제형) | 진단은 문제집을 쓰고, 힌트를 안 보이는 것은 정책이다 | F |
| 검증 규칙 「판본마다 달라지는 용어의 개념」 | 뜻풀이에 개념이 따라붙지 않으므로 규칙 자체가 사라진다 | C |

## 3. 옮겨가는 것

### 문제의 주인: 수업 → 문제집

`PublishedProblem.ownerKind`는 `'class' | 'diagnostic'`에서 **`'problem_set'` 하나**가 된다(F가 끝나면). `ownerVersionId`는 `ProblemSetVersion.id`. 한 문제는 문제집 하나에만 속하고, `validateReferences`가 같은 문제 ID가 두 문제집 판본에 나타나는 것을 거부한다(지금은 같은 ID·다른 내용만 거부한다).

수업의 단계는 참조만 한다.

```json
{ "kind": "core.problem_set", "typeVersion": 2,
  "payload": { "problemSetId": "…", "problemSetVersionId": "…:v1", "problemVersionIds": ["…"] } }
```

`problemVersionIds`는 그 문제집 판본이 가진 문제의 부분집합이며 순번이 아니라 ID다. 지금 `validateClass`에 있는 「어느 활동도 가리키지 않는 문제 거부」(`Unreferenced problem version`)는 문제집 쪽으로 간다 — 문제집의 문제는 문제집 것이고, 수업이 그중 일부만 고르는 것은 정상이다. 「문제가 평가하는 개념을 그 문제 안에서 설명하면 거부」는 문제 단위 규칙이라 그대로다.

복습 후보 풀(옛 `homeworkProblemIds`)은 수업 판본이 문제집을 참조하는 것으로 남는다.

```json
"metadata": { "public": { … }, "review": { "problemSetId": "…", "problemSetVersionId": "…", "problemVersionIds": ["…"] } }
```

`review`가 null이면 수강 완료 때 복습 과제를 만들지 않는다. 처음 심는 수업 3개는 숙제 2문제씩을 이름 없는 문제집 하나로 옮긴다.

### 과제 기간: 배정 → 과제

과제가 규칙을 들고 배정이 절대 시각으로 푼다.

```prisma
model Assignment {
  …
  problemSetId        String  @db.VarChar(191)
  problemSetVersionId String  @db.VarChar(191)
  // 정책. 숙제·시험·복습은 여기의 값이다: { kind: 'homework'|'exam'|'review', hints: boolean, results: …, solutions: … }
  policy              Json
  // 기간 규칙. 절대(at) 또는 상대(after — 완료 후 n일). 없으면 열림/닫힘 없음
  schedule            Json     // { opens?: {kind:'at', at} , due?: {kind:'at', at} | {kind:'after', days} }
  issuedAt            DateTime?  // null = 아직 내지 않음
}

model AssignmentRecipient {
  …
  opensAt        DateTime?   // 비어 있으면 과제의 것을 따른다. 채워져 있으면 그 사람만 다른 것
  dueAt          DateTime?
  recommendedAt  DateTime?   // 복습의 권장 시점. 마감이 아니다. 지금 그대로
  // assignmentPolicy 삭제
}
```

상대 규칙(`after`)은 배정할 때 그 사람의 완료 시각으로 풀어 `AssignmentRecipient.dueAt`에 쓴다. 절대 규칙은 과제에만 두고 배정은 비워 둔다. `AssignmentItem`은 「고른 문제들」의 순서만 들고 내용은 문제집 판본에서 읽는다.

`Assignment.policySnapshot`은 지금 복습 사유·분량·간격을 담는데, 그 안의 정책 부분이 `policy`로 나오고 사유(`reviewReason`, `reviewVersion`, `intervalDays`)는 `policySnapshot`에 남는다.

### 초안: 수업 전용 → `ownerKind` + `ownerKey`

```prisma
model ContentDraft {
  id            String  @id @default(cuid())
  ownerKind     String  @db.VarChar(20)      // 'lesson' | 'problem_set'
  ownerKey      String  @db.VarChar(191)     // Lesson.key | ProblemSet.id
  versionId     String  @db.VarChar(191)     // 발행하면 이 ID의 판본이 된다
  baseVersionId String? @db.VarChar(191)
  title         String  @db.VarChar(191)
  document      Json
  status        String  @default("draft")
  authorId      String
  publishedVersionId String?
  …
  @@index([ownerKind, ownerKey])
}
```

수업 초안의 `core.problem_set@2` 블록이 **아직 발행되지 않은 문제집 판본 ID**를 가리키고, 그 ID로 `ContentDraft(ownerKind='problem_set')` 행이 있으면 그것이 함께 발행할 초안이다. 발행은 수업 초안이 가리키는 문제집 초안을 모아 `importContent` 한 트랜잭션에 넣는다. 그래서 발행된 수업이 초안 문제집을 가리키는 상태는 생기지 않는다. 문제집 초안을 따로 발행하는 길은 두지 않는다(수업 없이 문제집만 고치는 것은 시험을 낼 때의 일이고, 그때는 과제가 문제집을 참조한다).

편집기에서 단계에 문제를 더하면 `ProblemSet` 행(이름 없음)과 문제집 초안이 그 자리에서 생긴다. 이름 있는 문제집을 여러 수업이 참조할 때의 「전부 고치기 / 이 수업만 따로 두기」는 이 안의 범위 밖이고 그다음 화면 작업이다.

## 4. 개명

| 지금 | 새 이름 | 비고 |
|---|---|---|
| `ClassVersion` · `ClassSection` | `LessonVersion` · `LessonSection` | 표 이름. 인덱스·FK 이름도 함께 |
| `classKey` · `classVersionId` · `sourceClassVersionId` · `preferredClassKey` | `lessonKey` · `lessonVersionId` · `sourceLessonVersionId` · `preferredLessonKey` | 칸·필드·API 필드. `?classKey=` 쿼리, `enrollment.start {classKey}`, `class.complete` → `lesson.complete`, `context: 'class'` → `'lesson'`(`Attempt`·`HintUse.contextKind` 값 포함) |
| `PublicClass` · `ClassDocument` · `StoredClass` · `validateClass` · `toPublicClass` · `classRecord(s)` | `PublicLesson` · `LessonDocument` · `StoredLesson` · `validateLesson` · `toPublicLesson` · `lessonRecord(s)` | 타입·함수 |
| `Scope` · `scope` relation | `LearningScope` · `learningScope` | 표 이름. `scopeId`·`ownerScopeId` 칸 이름은 그대로 둔다(FK가 뜻을 정하고, 개념 범위와는 표가 다르다) |
| `TermVersion.scopeKind` 값 `'class'` | `'lesson'` | `TermScopeKind` 타입 → `ConceptScope`. 값은 `global`·`organization`·`course`·`lesson` |
| `skillKey(s)` · `prerequisiteSkillKeys` · `SkillChoice` · `SkillPicker` · `skillReadiness` | `conceptKey(s)` · `prerequisiteConceptKeys` · `ConceptChoice` · `ConceptPicker` · `conceptReadiness` | 용어 사전이 직접 적진 않았으나 `Skill`이 개념에 흡수되므로 따라간다. 가장 많은 자리(28개 파일, 210곳) |
| 화면의 「클래스」 | 「수업」 | 문구만. `learning-workspace.tsx`에 42곳 |

`ContentBlock.ownerKind`의 `'section'`은 그대로다(단계 = `Section`). `'term'`은 `'definition'`으로, `PublishedProblem.ownerKind`의 `'class'`는 A에서 `'lesson'`으로, D에서 `'problem_set'`으로 간다.

## 5. migration 순서

한 단계가 한 PR이고 한 migration이다. 판형이 바뀌는 단계는 콘텐츠 표(`LessonVersion`·`LessonSection`·`PublishedProblem`·`ContentBlock`·진단·뜻풀이·초안)와 학습 기록 표(`Enrollment`·`Attempt`·`HintUse`·`Assignment*`·`Submission*`·`DiagnosticRun`·`RecommendationHistory`)를 `DELETE`하고 `AppliedContentBundle`을 비운다. 배포 명령은 `db:migrate → db:seed → content:publish → content:verify`가 되고, **`db:seed`가 다시 진짜 씨앗이 된다** — `prisma/seed/fractions.json`(지금 `tests/fixtures/initial-content.json`을 옮긴 것)을 `importContent`로 등록한다. 같은 판본이 이미 있으면 바뀌지 않은 것으로 지나가므로 매 배포 실행해도 안전하다. 60KB의 hex `INSERT`가 든 `20260914030000_database_content`는 지우지 않는다(적용된 migration은 고치지 않는다). 새 DB에서는 그 씨앗이 심기고 뒤 단계에서 지워지고 `db:seed`로 다시 심긴다 — 낭비지만 무해하고, 마지막 G 단계에서 정리한다.

| 단계 | migration이 하는 일 | 데이터 | 앞 단계 없이 안전한가 |
|---|---|---|---|
| **A 개명** | `RENAME TABLE` 3개(`ClassVersion`→`LessonVersion`, `ClassSection`→`LessonSection`, `Scope`→`LearningScope`), `RENAME COLUMN` 5개, 인덱스·FK 이름 변경, `UPDATE PublishedProblem SET ownerKind='lesson'`, `UPDATE TermVersion SET scopeKind='lesson' WHERE 'class'`, `ContentBlock.payload`의 `"scopeKind":"class"` 치환(`REGEXP_REPLACE` 후 `CAST AS JSON`) | 그대로 옮겨진다(지우지 않음) | **DROP 권한이 먼저다.** 그 외 의존 없음. 첫 단계여야 뒤 단계가 새 이름으로 쓰인다 |
| **B 코스·정체** | `Course`·`Lesson`·`Diagnostic` 표 생성. `LessonVersion.order` 칸 삭제, `metadata.public.order` `JSON_REMOVE`. `LessonVersion.lessonKey`·`DiagnosticVersion.diagnosticKey`에 FK | 행이 적어 SQL로 옮겼다(코스 하나 INSERT, 수업 키마다 `Lesson` 행). 씨앗 `prisma/seed/fractions.json`에 `courses`가 들어가고 `db:seed`가 진짜 씨앗이 된 것도 이 단계다 | A 뒤여야 한다(이름). C와는 순서를 바꿔도 된다 |
| **C 개념** | `Concept`·`ConceptDefinition` 표 생성. `Skill`·`TermVersion` `DROP TABLE`. `PublishedProblem.skillKeys`→`conceptKeys` `RENAME COLUMN`. `ContentBlock.ownerKind 'term'`→`'definition'` | 지우고 다시 심는다. 씨앗: 평가하는 개념 3개(`fraction.meaning`·`fraction.equivalence`·`fraction.addition`, `assessable=true`) + 뜻풀이 6개를 각각 개념으로(`assessable=false`). `약분`↔`동치분수와 약분` 같은 병합은 하지 않는다(운영자의 사후 병합) | A 뒤. B와 독립 |
| **D 문제집** | `ProblemSet`·`ProblemSetVersion` 표 생성. `ContentDraft`: `classKey`→`ownerKind`+`ownerKey`. `PublishedProblem.ownerKind`에 `'problem_set'` | 지우고 다시 심는다. 씨앗: 수업마다 연습·확인 활동이 문제집 2개, 숙제가 문제집 1개(모두 이름 없음). 문제 ID는 그대로 | B(코스가 문제집의 주인)·C(`assessable` 검사) 뒤. 가장 큰 단계 |
| **E 과제** | `Assignment`에 `problemSetId`·`problemSetVersionId`·`policy`·`schedule` 추가, `issuedAt` nullable. `AssignmentRecipient.assignmentPolicy` 삭제, `opensAt` 추가. `AssignmentItem.problemSnapshot` 삭제 | 학습 기록만 지운다(D 뒤라 남은 것이 거의 없다) | D 뒤 |
| **F 진단** | `DiagnosticVersion`에 `problemSetId`·`problemSetVersionId`·`problemVersionIds` 추가. `PublishedProblem.ownerKind`에서 `'diagnostic'` 없어짐 | 지우고 다시 심는다. 씨앗: 진단 6문항이 이름 있는 문제집 `시작점 확인` 하나 | D 뒤. E와 독립 |
| **G 정리(선택)** | migration 15+6개를 baseline 하나로 squash. 문서 정리 | 운영·테스트·개발 DB를 한 번 비우고 새로 만든다 | 모두 끝난 뒤 한 번. 하지 않아도 동작한다 |

「앞 단계 없이 안전한가」의 뜻: 각 migration은 빈 DB에서도, 앞 단계까지만 적용된 DB에서도 돈다. 순서를 바꿀 수 있는 곳은 표에 적었다(B↔C, E↔F). 되돌리기는 없다 — 전제에 적은 대로 앞으로 고친다.

## 6. PR 단위

각 PR이 끝난 시점에 앱이 동작하고 20개 테스트 파일이 전부 돈다. 아래 파일 목록은 grep으로 확인한 것이다.

### PR A — 개명

- migration 1개(위 A). `prisma/schema.prisma` 모델·필드 이름.
- 서버: `src/server/content-store.ts`(`classRecord(s)`·`classMetadata`·`indexClassDocument`), `src/server/learning-service.ts`(`catalog`·`classDocument`·`ownedEnrollment`·`class.complete`·`context 'class'`), `src/server/authoring.ts`(`classKey` 전반, `createClass`→`createLesson`), `src/server/google-auth.ts`(scope 생성), `src/app/api/health/route.ts`, `src/app/api/v1/learning/route.ts`(`?classKey=`).
- 코어·공유: `src/core/content.ts`(`StoredClass`·`validateClass`·`toPublicClass`), `src/core/content-bundle.ts`(번들 `classes`→`lessons`), `src/core/glossary.ts`, `src/core/personalization.ts`, `src/shared/api.ts`(`PublicClass`·`ClassDocument`·`ClassSection`·`LearningAction`), `src/shared/authoring.ts`(`classKeyPattern`·`ClassChoice`·`nextBlockId` 등의 `classKey` 인자), `src/shared/rich-text.ts`(`TermScopeKind`의 `'class'`).
- 화면: `src/features/authoring/authoring-workspace.tsx`·`problem-editor.tsx`·`term-editor.tsx`·`term-mentions.tsx`·`lesson-sheet.tsx`, `src/features/learning/learning-workspace.tsx`·`content-blocks.tsx`·`api-client.ts`·`auth-client.ts`·`diagnostic-panel.tsx`.
- 테스트 20개 중 `classKey`를 쓰는 12개와 `tests/cleanup.ts`, `tests/fixtures/content.ts`. `tests/fixtures/initial-content.json`의 `public.classKey`.
- 문서: `content-management.md`·`implementation-status.md`·`mobile-architecture.md`·`deployment.md`(되돌리기 문장)·`README.md`.

### PR B — 코스와 정체 표, `order` 이전

- migration 1개. 씨앗을 `prisma/seed/fractions.json`으로 옮기고 `db:seed`를 진짜 씨앗으로(`prisma/seed.ts`, `scripts/content.ts`에 `seed` 명령, `Dockerfile` CMD, `README.md`). 번들 형식에 `courses`.
- `src/core/content-bundle.ts`(코스 파싱·참조 검사), `src/server/content-store.ts`(`exportContent`·`importInTransaction`이 코스·정체 행을 쓰고 읽음, `verifyRowsBelongToVersions`), `src/server/learning-service.ts`(`catalog`가 `Lesson.order`로 정렬), `src/core/glossary.ts`(`taughtIn`이 `order` 대신 코스 순서), `src/core/personalization.ts`(`classes.at(-1)`·`classes[0]`이 정렬된 목록 전제 — 정렬을 서버에서 보장), `src/server/authoring.ts`(`createClass`가 `courseId`를 받고 `Lesson` 행을 만든다, `workspace`가 코스 목록을 내려준다), `src/shared/authoring.ts`(`AuthoringAction lesson.create {courseId}`), `src/shared/api.ts`(`PublicLesson`에서 `order` 제거, `PublicCatalog`에 `courses`), `src/app/api/health/route.ts`.
- 화면: `authoring-workspace.tsx`의 새 수업 폼에 코스 선택. 학습 화면은 단일 코스라 보이는 변화 없음.
- 테스트: `content-store.test.ts`·`learning-integration.test.ts`·`personalization-integration.test.ts`·`authoring-integration.test.ts`·`learning-route.test.ts`(모두 `public.order`를 직접 만든다). `learning-integration.test.ts`의 `publishImmutable`은 `classVersion.create`를 직접 부르는데, 이 PR에서 `importContent(seed)`로 바꾸면 뒤 단계에서 다시 고칠 일이 없다. `tests/cleanup.ts`에 코스·정체 표.

### PR C — 개념

- migration 1개. `core.rich_text@3`(`conceptKey`), `@2` 삭제. 씨앗 변환(`skills`→`concepts`, `terms`→`definitions`, 주석의 `termKey`→`conceptKey`, `typeVersion 2`→`3`).
- `src/core/content.ts`(`termAnnotation`·`blockSchemas`·`termContentBlockSchema`·`termReferences`·`blockTermRefs`), `src/core/content-bundle.ts`(`skillSchema`→`conceptSchema`, `termDefinitionSchema`→`definitionSchema`, `validateReferences`: 문제의 `conceptKeys`는 `assessable`이어야 함, 「판본마다 달라지는 개념」 규칙 삭제), `src/core/glossary.ts`, `src/core/personalization.ts`(`skillReadiness` 라벨을 `Concept`에서), `src/server/content-store.ts`(`currentTerms`→`definitionsFor`, `termDefinitions`, `indexTermDocument`, 뜻풀이 저장 = 블록 행 교체), `src/server/learning-service.ts`(`db.skill` 4곳, `skills` 상태 목록, `glossaryEntries` 호출), `src/server/authoring.ts`(`listTerms`·`saveTerm`→`saveDefinition`: 판본이 아니라 갱신, `nextTermVersionId` 삭제, `termChoices`, `createLesson`의 개념 존재 검사), `src/shared/api.ts`(`GlossaryEntry.skillKey`→`conceptKey`, `PublicSkill`→`PublicConcept`, `SkillReadiness`), `src/shared/authoring.ts`(`TermEdit`·`TermSummary`·`TermChoice`·`SkillChoice`·`blockForms`의 `rich_text@2` 폼·`termBlockForms`), `src/shared/rich-text.ts`(`TermRef`·`termRefId`), `src/app/api/health/route.ts`.
- 화면: `term-editor.tsx`(뜻풀이 편집 — 저장이 갱신, 개념 만들기 폼 추가: 「기존 수업과 같은 것을 가르치나요」는 이 안의 범위 밖), `term-mentions.tsx`, `problem-editor.tsx`(`SkillPicker`가 `assessable` 개념만), `authoring-workspace.tsx`, `learning/content-blocks.tsx`(`reviewSkillKeys`).
- 테스트: `skillKey`를 쓰는 15개 파일, `glossary.test.ts`·`term-mentions.test.ts`·`rich-text.test.ts`가 특히. `content/glossary-v1.json`은 뜻풀이 6개를 새 형식으로 다시 쓴다(이름은 `glossary-v2.json`으로 — 원장이 파일 이름으로 기록하므로 옛 항목은 남지만 무해).

### PR D — 문제집

- migration 1개. `core.problem_set@2`, `@1` 삭제. 씨앗 변환(`problemSets`, 수업의 `problems` 제거, 블록 payload, `metadata.review`). 번들 형식에 `problemSets`.
- `src/core/content.ts`(`StoredLesson`에서 `problems`·`homeworkProblemIds` 제거, `StoredProblemSet` 신설, `validateLesson`은 참조 형식만·`validateProblemSet`이 문제 검증, `getActivityProblemIds`가 블록의 `problemVersionIds`), `src/core/content-bundle.ts`(참조 검사: 수업이 가리키는 문제집 판본과 문제 ID가 존재하고 그 판본의 것인지, 한 문제는 한 문제집에만, 판본 ID 전역 유일에 문제집 포함), `src/server/content-store.ts`(`indexProblemSetDocument`, `lessonRecords`가 참조한 문제집 판본을 함께 읽어 `problems`를 조립, `problemRows`의 `ownerKind`), `src/server/learning-service.ts`(`createPersonalAssignment`가 `metadata.review`에서 풀을 읽음, `state`·`activity`가 조립된 `problems`를 그대로 쓰면 변화 적음), `src/server/authoring.ts`(**가장 큰 변화**: `ContentDraft` 일반화, `detail`이 수업 초안 + 참조 문제집 초안을 합쳐 `DraftEdit.problems`를 만들고 `saveDraft`가 다시 가른다, `publishDraft`가 두 종류 초안을 한 번들로, `renameEditedProblems`·`publishedProblems`는 문제집 단위, `createLesson`이 문제집도 만든다), `src/shared/authoring.ts`(`DraftDetail.homeworkProblemIds`·`looseProblems`·`dropLooseProblems` 삭제 또는 문제집 단위로, `nextProblemVersionId(classKey, role…)`→`(problemSetId…)`, `copyBlock`이 문제집 초안을 복제, `blockForms`의 문제집 폼, `editShape`).
- 화면: `authoring-workspace.tsx`(고아 문제 UI 삭제, 「어디에도 속하지 않은 문항」 제거), `problem-editor.tsx`(`ProblemSetEditor`가 문제집 이름 필드를 갖는다 — 이름을 주면 재사용 선언), `lesson-sheet.tsx`, `learning/content-blocks.tsx`(`core.problem_set@2` 렌더).
- 테스트: `core.problem_set`을 쓰는 9개 파일, `homeworkProblemIds`를 쓰는 7개 파일, `authoring-integration.test.ts`의 숙제 참조 개명 검사(350행)·고아 문항 검사(150행)는 문제집 단위로 다시 쓴다. `tests/cleanup.ts`.

### PR E — 과제

- migration 1개. `src/server/learning-service.ts`(`createPersonalAssignment`가 `problemSetId`·`policy {kind:'review', hints:true}`·`schedule {}`를 쓰고 `problemSnapshot`을 쓰지 않음, `state`·`activity`가 항목의 문제를 `publishedProblemRecords`로 읽음, `AssignmentView.policy`), `src/core/personalization.ts`(`reviewSelection` 시그니처), `src/shared/api.ts`(`AssignmentView`에 `opensAt`·`dueAt`·`policy.kind`), `src/features/learning/learning-workspace.tsx`(과제 카드의 기간 표시).
- 테스트: `learning-integration.test.ts`·`personalization-integration.test.ts`·`personalization.test.ts`·`content-store.test.ts`(과제 snapshot 보존 검사 204행은 「문제집 판본 고정」 검사로).
- 교사가 과제를 내는 API·화면은 이 안의 범위 밖이다. 이 PR은 표와 시스템 발행 경로만 옮긴다.

### PR F — 진단이 문제집을 쓴다

- migration 1개. 씨앗 변환. `src/core/content.ts`(`diagnosticProblemSchema` 삭제 — 문제집의 문제형 하나. 해설 없는 문제를 허용하려면 `solution` `min(1)`을 `min(0)`으로 낮춰야 한다 → 아래 결정 5), `src/core/content-bundle.ts`(`diagnosticDefinitionSchema`가 참조형), `src/server/content-store.ts`(`diagnosticDefinitions`·`indexDiagnosticDocument`·`currentDiagnostic`), `src/server/learning-service.ts`(`diagnostic.start`가 참조를 풀어 `DiagnosticRun.document`에 복사 — 답안이 `Attempt`가 아니라 `answers`에 쌓이는 것은 그대로).
- 테스트: `content-store.test.ts`(진단 색인 233행)·`personalization-integration.test.ts`·`learning-integration.test.ts`. `tests/cleanup.ts`.

### PR G — 정리(선택)

- migration squash, `20260914030000_database_content`의 hex 씨앗 제거, `docs/deployment.md`의 「저장 구조 migration」 표를 이력으로 옮김, `glossary.md`의 「옛 이름과의 대응」을 「반영 완료」로.

## 확정된 결정

2026-09-17에 아래 아홉 항목을 권장안대로 확정했다.

1. **DROP 권한.** 운영 migrator(`geunyang_math_migrator`)에 `DROP`을 부여한다. A 단계가 main에 머지되기 전에 DB VM에서 한 번 실행한다. 대안(새 표 생성 + 복사 + 옛 표 방치)은 권하지 않는다.
2. **되돌리기 규칙.** 「후속 migration은 이전 앱과 호환」을 이 작업 동안 내려놓는다. 배포 문서의 문장을 고친다.
3. **씨앗을 저장소에 둔다.** `prisma/seed/fractions.json`에 정답이 들어간다. hex migration이 이미 저장소에 정답을 담고 있으므로 새로 새는 것은 없지만, `content-management.md`의 「정답 있는 번들은 저장소에 두지 않는다」 문장은 「플랫폼 기본 콘텐츠는 예외」로 고친다.
4. **블록 판 올리기.** `core.problem_set@2`, `core.rich_text@3`으로 올리고 옛 판을 지운다(권장). 대안은 같은 판 번호 아래 형을 바꾸는 것이고, 아무 판본도 남지 않으므로 가능은 하지만 `kind@typeVersion`이 스키마를 식별한다는 계약을 이 한 번만 어기는 셈이다.
5. **문제 하나의 형.** 진단이 문제집을 쓰려면 문제집의 문제형이 하나여야 한다. 지금 진단 문제는 해설이 없고 수업 문제는 해설이 필수다. 안: `solution`을 선택으로 낮추고(`min(0)`), 수업 편집기가 해설 없는 문제에 경고만 한다. 대안: 진단 6문항에 해설을 써 넣는다(내용 작업).
6. **개념 키.** 뜻풀이 6개가 개념이 될 때 키를 `term.denominator` 그대로 둘지 `denominator`로 바꿀지. 안: 바꾼다(씨앗 변환에서 치환 한 번). `분수`(`term.fraction`)와 `분수의 의미`(`fraction.meaning`)를 합칠지는 판단하지 않고 둘 다 둔다.
7. **코스 소유.** `Course.ownerUserId`(null = 플랫폼)로 시작한다. 조직 모델이 정해지면 그때 옮긴다.
8. **과제 기간의 표현.** `schedule` Json 하나 vs `opensAt`·`dueAt`·`dueAfterDays` 칸 셋. 안: Json(상대·절대 두 종류를 한 자리에 두고 나중에 종류가 늘어도 칸이 늘지 않는다).
9. **PR 순서.** A→B→C→D→E→F(→G). B와 C, E와 F는 서로 바꿔도 된다.

## 검사

서버·스키마를 건드리는 PR마다 테스트 DB에 migration을 적용하고 통합 검사를 포함해 돌린다.

```sh
DATABASE_URL='mysql://geunyang:local-development-only@127.0.0.1:3317/geunyang_math_test' npx prisma migrate deploy
DATABASE_URL='mysql://geunyang:local-development-only@127.0.0.1:3317/geunyang_math_test' npm run db:seed
TEST_DATABASE_URL='mysql://geunyang:local-development-only@127.0.0.1:3317/geunyang_math_test' npm test
```

`TEST_DATABASE_URL` 없이는 통합 검사 4개 파일이 통째로 건너뛰므로 초록만 보고 판단하지 않는다. 웹 빌드(`npm run build`)와 모바일 export(`NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3017 MOBILE_ALLOW_LOCAL_API=1 npm run build:mobile`)는 단계별로 따로 돌린다. Prisma 칸을 더한 뒤에는 dev 서버를 재기동한다.

PR마다 문서를 같이 고친다 — 현재 구현과 후속 계획을 구분하고, 운영 코드를 바꾸지 않은 문서 수정은 새 기능 검증으로 기록하지 않는다([docs/README.md](README.md)).
