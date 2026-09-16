-- A lesson, a problem set or a diagnostic belongs to exactly one course (docs/glossary.md). The
-- course and the identities of what it keeps get tables of their own, apart from any version: a
-- lesson has a course from its first draft, and the order of lessons is the course's to change.
--
-- The three published lessons and the one diagnostic are gathered into one course. The global
-- `order` a lesson version carried goes with it — the position is the course's, not the version's —
-- and leaves the document too, which changes the migrated versions' content hash (already known not
-- to be comparable across releases).

CREATE TABLE `Course` (
  `id`          VARCHAR(191) NOT NULL,
  `key`         VARCHAR(100) NOT NULL,
  `title`       VARCHAR(191) NOT NULL,
  `summary`     VARCHAR(500) NOT NULL DEFAULT '',
  `ownerUserId` VARCHAR(191) NULL,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3) NOT NULL,
  UNIQUE INDEX `Course_key_key` (`key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Lesson` (
  `key`       VARCHAR(100) NOT NULL,
  `courseId`  VARCHAR(191) NOT NULL,
  `order`     INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `Lesson_courseId_order_idx` (`courseId`, `order`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Diagnostic` (
  `key`      VARCHAR(100) NOT NULL,
  `courseId` VARCHAR(191) NOT NULL,
  INDEX `Diagnostic_courseId_idx` (`courseId`),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Lesson` ADD CONSTRAINT `Lesson_courseId_fkey`
  FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Diagnostic` ADD CONSTRAINT `Diagnostic_courseId_fkey`
  FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Everything published so far is the platform's fraction course.
INSERT INTO `Course` (`id`, `key`, `title`, `summary`, `updatedAt`)
SELECT 'fractions', 'fractions', '분수', '분수가 무엇인지에서 시작해 크기를 맞추고 더하는 것까지 이어지는 기초 과정이에요.', CURRENT_TIMESTAMP(3)
WHERE EXISTS (SELECT 1 FROM `LessonVersion`) OR EXISTS (SELECT 1 FROM `DiagnosticVersion`);

-- Each lesson key once, at the position its versions held.
INSERT INTO `Lesson` (`key`, `courseId`, `order`)
SELECT `lessonKey`, 'fractions', MIN(`order`) FROM `LessonVersion` GROUP BY `lessonKey`;

INSERT INTO `Diagnostic` (`key`, `courseId`)
SELECT DISTINCT `diagnosticKey`, 'fractions' FROM `DiagnosticVersion`;

ALTER TABLE `LessonVersion` ADD CONSTRAINT `LessonVersion_lessonKey_fkey`
  FOREIGN KEY (`lessonKey`) REFERENCES `Lesson`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `DiagnosticVersion` ADD CONSTRAINT `DiagnosticVersion_diagnosticKey_fkey`
  FOREIGN KEY (`diagnosticKey`) REFERENCES `Diagnostic`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The position leaves the version and the document.
ALTER TABLE `LessonVersion` DROP COLUMN `order`;
UPDATE `LessonVersion` SET `metadata` = JSON_REMOVE(`metadata`, '$.public.order')
WHERE JSON_CONTAINS_PATH(`metadata`, 'one', '$.public.order');
UPDATE `ContentDraft` SET `document` = JSON_REMOVE(`document`, '$.public.order')
WHERE JSON_CONTAINS_PATH(`document`, 'one', '$.public.order');
