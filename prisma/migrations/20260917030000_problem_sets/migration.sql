-- The owner of a question is a problem set, and the owner of a problem set is a course
-- (docs/glossary.md). A lesson's step only references a set: its id, a frozen version of it and the
-- questions it picked. The questions a lesson kept for homework were never homework — they were the
-- pool its review assignments draw from — so they become a problem set the lesson version
-- references as `review`.
--
-- Each activity block of each published lesson version becomes one problem set version, named
-- `<lessonKey>:<sectionRole>` for the set and `<lessonKey>:<role>:<vN>` for the version, so every
-- version of a lesson keeps its own version of the set and the seed file finds the same names. The
-- content hash of a migrated set version is a placeholder; hashes were already not comparable.
-- A lesson version with two sections of one role would collide on these names, and this migration
-- would stop rather than merge them.

CREATE TABLE `ProblemSet` (
  `id`        VARCHAR(191) NOT NULL,
  `courseId`  VARCHAR(191) NOT NULL,
  `name`      VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ProblemSet_courseId_idx` (`courseId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProblemSetVersion` (
  `id`           VARCHAR(191) NOT NULL,
  `problemSetId` VARCHAR(191) NOT NULL,
  `contentHash`  VARCHAR(64) NOT NULL,
  `publishedAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ProblemSetVersion_problemSetId_publishedAt_idx` (`problemSetId`, `publishedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProblemSet` ADD CONSTRAINT `ProblemSet_courseId_fkey`
  FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ProblemSetVersion` ADD CONSTRAINT `ProblemSetVersion_problemSetId_fkey`
  FOREIGN KEY (`problemSetId`) REFERENCES `ProblemSet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every activity block of every published lesson version, with the names its set will take.
CREATE TEMPORARY TABLE `activity` AS
SELECT `block`.`ownerVersionId` AS `lessonVersionId`, `block`.`ownerId` AS `sectionId`, `block`.`order` AS `blockOrder`,
  `version`.`lessonKey`, `lesson`.`courseId`, `section`.`role`,
  CONCAT(`version`.`lessonKey`, ':', `section`.`role`) AS `problemSetId`,
  CONCAT(`version`.`lessonKey`, ':', `section`.`role`, ':', SUBSTRING_INDEX(`version`.`id`, ':', -1)) AS `setVersionId`
FROM `ContentBlock` AS `block`
JOIN `LessonVersion` AS `version` ON `version`.`id` = `block`.`ownerVersionId`
JOIN `Lesson` AS `lesson` ON `lesson`.`key` = `version`.`lessonKey`
JOIN `LessonSection` AS `section` ON `section`.`lessonVersionId` = `block`.`ownerVersionId` AND `section`.`sectionId` = `block`.`ownerId`
WHERE `block`.`ownerKind` = 'section' AND `block`.`kind` = 'core.problem_set' AND `block`.`typeVersion` = 1;

-- The homework pool of every lesson version, as a set of its own.
CREATE TEMPORARY TABLE `review` AS
SELECT `version`.`id` AS `lessonVersionId`, `version`.`lessonKey`, `lesson`.`courseId`,
  CONCAT(`version`.`lessonKey`, ':review') AS `problemSetId`,
  CONCAT(`version`.`lessonKey`, ':review:', SUBSTRING_INDEX(`version`.`id`, ':', -1)) AS `setVersionId`,
  `version`.`metadata` -> '$.homeworkProblemIds' AS `problemVersionIds`
FROM `LessonVersion` AS `version`
JOIN `Lesson` AS `lesson` ON `lesson`.`key` = `version`.`lessonKey`
WHERE JSON_LENGTH(`version`.`metadata` -> '$.homeworkProblemIds') > 0;

INSERT INTO `ProblemSet` (`id`, `courseId`)
SELECT DISTINCT `problemSetId`, `courseId` FROM `activity`
UNION SELECT DISTINCT `problemSetId`, `courseId` FROM `review`;

INSERT INTO `ProblemSetVersion` (`id`, `problemSetId`, `contentHash`, `publishedAt`)
SELECT `activity`.`setVersionId`, `activity`.`problemSetId`, SHA2(`activity`.`setVersionId`, 256), `version`.`publishedAt`
FROM `activity` JOIN `LessonVersion` AS `version` ON `version`.`id` = `activity`.`lessonVersionId`
UNION
SELECT `review`.`setVersionId`, `review`.`problemSetId`, SHA2(`review`.`setVersionId`, 256), `version`.`publishedAt`
FROM `review` JOIN `LessonVersion` AS `version` ON `version`.`id` = `review`.`lessonVersionId`;

-- Which question goes to which set version: the ones the block lists, and the ones homework lists.
CREATE TEMPORARY TABLE `moved` AS
SELECT `activity`.`lessonVersionId`, `activity`.`setVersionId`,
  CONVERT(`listed`.`problemVersionId` USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `problemVersionId`
FROM `activity`
JOIN `ContentBlock` AS `block` ON `block`.`ownerKind` = 'section' AND `block`.`ownerVersionId` = `activity`.`lessonVersionId`
  AND `block`.`ownerId` = `activity`.`sectionId` AND `block`.`order` = `activity`.`blockOrder`,
JSON_TABLE(`block`.`payload`, '$.problemVersionIds[*]' COLUMNS (`problemVersionId` VARCHAR(191) PATH '$')) AS `listed`
UNION
SELECT `review`.`lessonVersionId`, `review`.`setVersionId`,
  CONVERT(`listed`.`problemVersionId` USING utf8mb4) COLLATE utf8mb4_unicode_ci
FROM `review`, JSON_TABLE(`review`.`problemVersionIds`, '$[*]' COLUMNS (`problemVersionId` VARCHAR(191) PATH '$')) AS `listed`;

UPDATE `PublishedProblem` AS `problem`
JOIN `moved` ON `moved`.`lessonVersionId` = `problem`.`ownerVersionId` AND `moved`.`problemVersionId` = `problem`.`problemVersionId`
SET `problem`.`ownerKind` = 'problem_set', `problem`.`ownerVersionId` = `moved`.`setVersionId`
WHERE `problem`.`ownerKind` = 'lesson';

UPDATE `ContentBlock` AS `block`
JOIN `moved` ON `moved`.`lessonVersionId` = `block`.`ownerVersionId` AND `moved`.`problemVersionId` = `block`.`ownerId`
SET `block`.`ownerVersionId` = `moved`.`setVersionId`
WHERE `block`.`ownerKind` = 'problem';

-- The step now references the set: its id, the version, and the questions it picked, in core.problem_set@2.
UPDATE `ContentBlock` AS `block`
JOIN `activity` ON `activity`.`lessonVersionId` = `block`.`ownerVersionId` AND `activity`.`sectionId` = `block`.`ownerId`
  AND `activity`.`blockOrder` = `block`.`order`
SET `block`.`typeVersion` = 2,
    `block`.`payload` = JSON_OBJECT('problemSetId', `activity`.`problemSetId`, 'problemSetVersionId', `activity`.`setVersionId`,
      'problemVersionIds', `block`.`payload` -> '$.problemVersionIds')
WHERE `block`.`ownerKind` = 'section' AND `block`.`kind` = 'core.problem_set';

-- Homework becomes the review pool: a reference to the set that holds it, or null.
UPDATE `LessonVersion` AS `version`
LEFT JOIN `review` ON `review`.`lessonVersionId` = `version`.`id`
SET `version`.`metadata` = JSON_REMOVE(JSON_SET(`version`.`metadata`, '$.review',
  IF(`review`.`setVersionId` IS NULL, CAST('null' AS JSON),
    JSON_OBJECT('problemSetId', `review`.`problemSetId`, 'problemSetVersionId', `review`.`setVersionId`, 'problemVersionIds', `review`.`problemVersionIds`))),
  '$.homeworkProblemIds');

DROP TEMPORARY TABLE `moved`;
DROP TEMPORARY TABLE `review`;
DROP TEMPORARY TABLE `activity`;

-- A draft is now a working copy of a lesson or of a problem set. Drafts in the old form are not
-- carried over.
DELETE FROM `ContentDraft`;
ALTER TABLE `ContentDraft`
  ADD COLUMN `ownerKind` VARCHAR(20) NOT NULL,
  ADD COLUMN `ownerKey` VARCHAR(191) NOT NULL,
  DROP INDEX `ContentDraft_lessonKey_idx`,
  DROP COLUMN `lessonKey`;
CREATE INDEX `ContentDraft_ownerKind_ownerKey_idx` ON `ContentDraft`(`ownerKind`, `ownerKey`);
