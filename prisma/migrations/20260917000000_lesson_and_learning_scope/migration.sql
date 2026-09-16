-- The names the glossary decided on (docs/glossary.md): a class is a lesson, and the owner of a
-- learning record is a learning scope — the word "scope" alone had come to mean two things.
-- Rows move with their tables; nothing here changes what a published version says.
--
-- RENAME TABLE needs DROP on the old name, so the migrator account must hold DROP before this runs.
-- This step is not compatible with the previous application image: rolling back the app alone
-- leaves it reading tables that no longer carry these names.

RENAME TABLE `ClassVersion` TO `LessonVersion`,
             `ClassSection` TO `LessonSection`,
             `Scope` TO `LearningScope`;

-- Columns, and the index and constraint names Prisma derives from them.
ALTER TABLE `LessonVersion`
  RENAME COLUMN `classKey` TO `lessonKey`,
  RENAME INDEX `ClassVersion_classKey_idx` TO `LessonVersion_lessonKey_idx`;

ALTER TABLE `LessonSection`
  RENAME COLUMN `classVersionId` TO `lessonVersionId`,
  RENAME INDEX `ClassSection_classVersionId_order_idx` TO `LessonSection_lessonVersionId_order_idx`;

ALTER TABLE `Enrollment` DROP FOREIGN KEY `Enrollment_classVersionId_fkey`;
ALTER TABLE `Enrollment`
  RENAME COLUMN `classVersionId` TO `lessonVersionId`,
  RENAME INDEX `Enrollment_userId_classVersionId_key` TO `Enrollment_userId_lessonVersionId_key`;
ALTER TABLE `Enrollment` ADD CONSTRAINT `Enrollment_lessonVersionId_fkey`
  FOREIGN KEY (`lessonVersionId`) REFERENCES `LessonVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `LearningScope` DROP FOREIGN KEY `Scope_ownerUserId_fkey`;
ALTER TABLE `LearningScope`
  RENAME INDEX `Scope_ownerUserId_key` TO `LearningScope_ownerUserId_key`;
ALTER TABLE `LearningScope` ADD CONSTRAINT `LearningScope_ownerUserId_fkey`
  FOREIGN KEY (`ownerUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Assignment` RENAME COLUMN `sourceClassVersionId` TO `sourceLessonVersionId`;
ALTER TABLE `User` RENAME COLUMN `preferredClassKey` TO `preferredLessonKey`;
ALTER TABLE `ContentDraft`
  RENAME COLUMN `classKey` TO `lessonKey`,
  RENAME INDEX `ContentDraft_classKey_idx` TO `ContentDraft_lessonKey_idx`;

-- Values that named a class by the old word.
UPDATE `PublishedProblem` SET `ownerKind` = 'lesson' WHERE `ownerKind` = 'class';
UPDATE `TermVersion` SET `scopeKind` = 'lesson' WHERE `scopeKind` = 'class';
UPDATE `HintUse` SET `contextKind` = 'lesson' WHERE `contextKind` = 'class';

-- The lesson document names its key under `public`, in the published metadata and in every draft.
-- Moving the key changes the content hash of the migrated versions; that hash was already known
-- not to be comparable across releases, and the import path compares content, not hashes.
UPDATE `LessonVersion`
SET `metadata` = JSON_REMOVE(JSON_SET(`metadata`, '$.public.lessonKey', `metadata` -> '$.public.classKey'), '$.public.classKey')
WHERE JSON_CONTAINS_PATH(`metadata`, 'one', '$.public.classKey');
UPDATE `ContentDraft`
SET `document` = JSON_REMOVE(JSON_SET(`document`, '$.public.lessonKey', `document` -> '$.public.classKey'), '$.public.classKey')
WHERE JSON_CONTAINS_PATH(`document`, 'one', '$.public.classKey');

-- A recommendation snapshot names the lesson it recommended.
UPDATE `RecommendationHistory`
SET `snapshot` = CAST(REPLACE(REPLACE(CAST(`snapshot` AS CHAR CHARACTER SET utf8mb4),
  '"preferredClassKey"', '"preferredLessonKey"'), '"classKey"', '"lessonKey"') AS JSON)
WHERE CAST(`snapshot` AS CHAR CHARACTER SET utf8mb4) LIKE '%ClassKey%' OR CAST(`snapshot` AS CHAR CHARACTER SET utf8mb4) LIKE '%classKey%';

-- A term link inside a paragraph names the scope that keeps the term. MySQL prints JSON with a
-- space after the colon, so the text form is replaced and cast back; only blocks that hold such a
-- link are touched, so every other payload keeps its bytes.
UPDATE `ContentBlock`
SET `payload` = CAST(REPLACE(CAST(`payload` AS CHAR CHARACTER SET utf8mb4), '"scopeKind": "class"', '"scopeKind": "lesson"') AS JSON)
WHERE `kind` = 'core.rich_text' AND `typeVersion` = 2
  AND JSON_SEARCH(`payload`, 'one', 'class', NULL, '$.terms[*].scopeKind') IS NOT NULL;
