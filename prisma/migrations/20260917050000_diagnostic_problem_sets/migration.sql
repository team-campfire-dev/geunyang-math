-- A diagnostic names its questions the way a lesson step does: a frozen problem set version and the
-- questions it picked, in order (docs/glossary.md). Every published question is then a problem
-- set's, and 'diagnostic' leaves PublishedProblem.ownerKind. The questions a diagnostic version
-- carried become a set named after the diagnostic, `<diagnosticKey>` with versions `<key>:vN` in
-- order of publication, and the seed file uses the same names. The working table is an ordinary
-- one (the migrator may not create temporary tables) and is removed first.

DROP TABLE IF EXISTS `placement`;

ALTER TABLE `DiagnosticVersion`
  ADD COLUMN `problemSetId`        VARCHAR(191) NULL AFTER `estimatedMinutes`,
  ADD COLUMN `problemSetVersionId` VARCHAR(191) NULL AFTER `problemSetId`,
  ADD COLUMN `problemVersionIds`   JSON NULL AFTER `problemSetVersionId`;

CREATE TABLE `placement` AS
SELECT `version`.`id` AS `diagnosticVersionId`, `version`.`diagnosticKey`, `diagnostic`.`courseId`, `version`.`title`, `version`.`publishedAt`,
  `version`.`diagnosticKey` AS `problemSetId`,
  CONCAT(`version`.`diagnosticKey`, ':v', ROW_NUMBER() OVER (PARTITION BY `version`.`diagnosticKey` ORDER BY `version`.`publishedAt`, `version`.`id`)) AS `setVersionId`,
  `listed`.`problemVersionIds`
FROM `DiagnosticVersion` AS `version`
JOIN `Diagnostic` AS `diagnostic` ON `diagnostic`.`key` = `version`.`diagnosticKey`
JOIN (
  SELECT `ownerVersionId`, CAST(CONCAT('["', GROUP_CONCAT(`problemVersionId` ORDER BY `order` SEPARATOR '","'), '"]') AS JSON) AS `problemVersionIds`
  FROM `PublishedProblem` WHERE `ownerKind` = 'diagnostic' GROUP BY `ownerVersionId`
) AS `listed` ON `listed`.`ownerVersionId` = `version`.`id`;

INSERT INTO `ProblemSet` (`id`, `courseId`, `name`)
SELECT `problemSetId`, MIN(`courseId`), MAX(`title`) FROM `placement` GROUP BY `problemSetId`;

INSERT INTO `ProblemSetVersion` (`id`, `problemSetId`, `contentHash`, `publishedAt`)
SELECT `setVersionId`, `problemSetId`, SHA2(`setVersionId`, 256), `publishedAt` FROM `placement`;

UPDATE `DiagnosticVersion` AS `version`
JOIN `placement` ON `placement`.`diagnosticVersionId` = `version`.`id`
SET `version`.`problemSetId` = `placement`.`problemSetId`,
    `version`.`problemSetVersionId` = `placement`.`setVersionId`,
    `version`.`problemVersionIds` = `placement`.`problemVersionIds`;

UPDATE `PublishedProblem` AS `problem`
JOIN `placement` ON `placement`.`diagnosticVersionId` = `problem`.`ownerVersionId`
SET `problem`.`ownerKind` = 'problem_set', `problem`.`ownerVersionId` = `placement`.`setVersionId`
WHERE `problem`.`ownerKind` = 'diagnostic';

UPDATE `ContentBlock` AS `block`
JOIN `placement` ON `placement`.`diagnosticVersionId` = `block`.`ownerVersionId`
SET `block`.`ownerVersionId` = `placement`.`setVersionId`
WHERE `block`.`ownerKind` = 'problem';

DROP TABLE `placement`;

ALTER TABLE `DiagnosticVersion`
  MODIFY COLUMN `problemSetId`        VARCHAR(191) NOT NULL,
  MODIFY COLUMN `problemSetVersionId` VARCHAR(191) NOT NULL,
  MODIFY COLUMN `problemVersionIds`   JSON NOT NULL;

ALTER TABLE `DiagnosticVersion` ADD CONSTRAINT `DiagnosticVersion_problemSetVersionId_fkey`
  FOREIGN KEY (`problemSetVersionId`) REFERENCES `ProblemSetVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
