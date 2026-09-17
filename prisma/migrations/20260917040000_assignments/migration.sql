-- An assignment names the problem set version its questions come from and keeps its own policy
-- and schedule (docs/glossary.md): homework, exam and review are values of the policy, not kinds
-- of thing, and the period is a rule on the assignment that each recipient resolves to moments.
-- An item then only picks and orders questions; their content is read from the frozen set version,
-- so the copy every item carried goes.
--
-- Existing assignments were all issued by the system as the review of a lesson version, whose
-- review pool became a problem set in the previous step, so they move to that set. One that names
-- no lesson version cannot be placed and goes with everything recorded against it. The working
-- table is an ordinary one (the migrator may not create temporary tables) and is removed first,
-- so the data part can run again after an interruption.

DROP TABLE IF EXISTS `unplaced`;

ALTER TABLE `Assignment`
  ADD COLUMN `problemSetId`        VARCHAR(191) NULL AFTER `sourceLessonVersionId`,
  ADD COLUMN `problemSetVersionId` VARCHAR(191) NULL AFTER `problemSetId`,
  ADD COLUMN `policy`              JSON NULL AFTER `problemSetVersionId`,
  ADD COLUMN `schedule`            JSON NULL AFTER `policy`,
  MODIFY COLUMN `issuedAt` DATETIME(3) NULL;

UPDATE `Assignment` AS `assignment`
JOIN `LessonVersion` AS `version` ON `version`.`id` = `assignment`.`sourceLessonVersionId`
SET `assignment`.`problemSetId`        = `version`.`metadata` ->> '$.review.problemSetId',
    `assignment`.`problemSetVersionId` = `version`.`metadata` ->> '$.review.problemSetVersionId',
    `assignment`.`policy`   = JSON_OBJECT('kind', 'review', 'hints', TRUE, 'results', 'per-item', 'solutions', 'never'),
    `assignment`.`schedule` = JSON_OBJECT()
WHERE `assignment`.`problemSetVersionId` IS NULL
  AND JSON_TYPE(`version`.`metadata` -> '$.review') = 'OBJECT';

-- What could not be placed goes, deepest rows first.
CREATE TABLE `unplaced` AS SELECT `id` FROM `Assignment` WHERE `problemSetVersionId` IS NULL;

DELETE `revision` FROM `AssessmentRevision` AS `revision`
JOIN `Attempt` AS `attempt` ON `attempt`.`id` = `revision`.`attemptId`
LEFT JOIN `AssignmentItem` AS `item` ON `item`.`id` = `attempt`.`assignmentItemId`
LEFT JOIN `Submission` AS `submission` ON `submission`.`id` = `attempt`.`submissionId`
LEFT JOIN `AssignmentRecipient` AS `recipient` ON `recipient`.`id` = `submission`.`recipientId`
WHERE `item`.`assignmentId` IN (SELECT `id` FROM `unplaced`) OR `recipient`.`assignmentId` IN (SELECT `id` FROM `unplaced`);

DELETE `selected` FROM `SubmissionItem` AS `selected`
JOIN `Submission` AS `submission` ON `submission`.`id` = `selected`.`submissionId`
JOIN `AssignmentRecipient` AS `recipient` ON `recipient`.`id` = `submission`.`recipientId`
WHERE `recipient`.`assignmentId` IN (SELECT `id` FROM `unplaced`);

DELETE `attempt` FROM `Attempt` AS `attempt`
LEFT JOIN `AssignmentItem` AS `item` ON `item`.`id` = `attempt`.`assignmentItemId`
LEFT JOIN `Submission` AS `submission` ON `submission`.`id` = `attempt`.`submissionId`
LEFT JOIN `AssignmentRecipient` AS `recipient` ON `recipient`.`id` = `submission`.`recipientId`
WHERE `item`.`assignmentId` IN (SELECT `id` FROM `unplaced`) OR `recipient`.`assignmentId` IN (SELECT `id` FROM `unplaced`);

DELETE `submission` FROM `Submission` AS `submission`
JOIN `AssignmentRecipient` AS `recipient` ON `recipient`.`id` = `submission`.`recipientId`
WHERE `recipient`.`assignmentId` IN (SELECT `id` FROM `unplaced`);

DELETE FROM `AssignmentRecipient` WHERE `assignmentId` IN (SELECT `id` FROM `unplaced`);
DELETE FROM `AssignmentItem` WHERE `assignmentId` IN (SELECT `id` FROM `unplaced`);
DELETE FROM `Assignment` WHERE `id` IN (SELECT `id` FROM `unplaced`);

DROP TABLE `unplaced`;

ALTER TABLE `Assignment`
  MODIFY COLUMN `problemSetId`        VARCHAR(191) NOT NULL,
  MODIFY COLUMN `problemSetVersionId` VARCHAR(191) NOT NULL,
  MODIFY COLUMN `policy`              JSON NOT NULL,
  MODIFY COLUMN `schedule`            JSON NOT NULL;

ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_problemSetVersionId_fkey`
  FOREIGN KEY (`problemSetVersionId`) REFERENCES `ProblemSetVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- A recipient keeps only the moments that differ from the assignment's rule. The policy was never
-- the recipient's; it is the assignment's now.
ALTER TABLE `AssignmentRecipient`
  ADD COLUMN `opensAt` DATETIME(3) NULL AFTER `recommendedAt`,
  DROP COLUMN `assignmentPolicy`;

ALTER TABLE `AssignmentItem` DROP COLUMN `problemSnapshot`;
