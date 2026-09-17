-- Pre-launch rewrite of the three platform fraction lessons and their starting diagnostic.
-- Only these identities and their dependent records are reset. Other courses, authored content,
-- account/authentication data, author permissions and learning scopes remain intact.
-- db:seed installs the new lessons; content:publish updates their atomic concept definitions.
-- Ordinary working table, as the deployment migrator does not require CREATE TEMPORARY TABLES.
DROP TABLE IF EXISTS `curriculum_reset_targets`;
CREATE TABLE `curriculum_reset_targets` (
  `kind` VARCHAR(40) NOT NULL, `id` VARCHAR(191) NOT NULL,
  PRIMARY KEY (`kind`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'lesson', `id` FROM `LessonVersion` WHERE `lessonKey` IN ('fraction-meaning', 'fraction-equivalence', 'fraction-addition');
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'set', `id` FROM `ProblemSetVersion` WHERE `problemSetId` IN ('fraction-meaning:practice', 'fraction-meaning:check', 'fraction-meaning:review', 'fraction-equivalence:practice', 'fraction-equivalence:check', 'fraction-equivalence:review', 'fraction-addition:practice', 'fraction-addition:check', 'fraction-addition:review', 'starting-point')
  AND NOT EXISTS (SELECT 1 FROM `ContentBlock` WHERE `ownerKind` = 'section' AND `ownerVersionId` NOT IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'lesson') AND JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.problemSetVersionId')) = `ProblemSetVersion`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `LessonVersion` WHERE `lessonKey` NOT IN ('fraction-meaning', 'fraction-equivalence', 'fraction-addition') AND JSON_SEARCH(`metadata`, 'one', `ProblemSetVersion`.`id`) IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM `DiagnosticVersion` WHERE `diagnosticKey` <> 'starting-point' AND `problemSetVersionId` = `ProblemSetVersion`.`id`)
  AND NOT EXISTS (SELECT 1 FROM `ContentDraft` WHERE `ownerKind` = 'lesson' AND `ownerKey` NOT IN ('fraction-meaning', 'fraction-equivalence', 'fraction-addition') AND JSON_SEARCH(`document`, 'one', `ProblemSetVersion`.`id`) IS NOT NULL);
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'diagnostic', `id` FROM `DiagnosticVersion` WHERE `diagnosticKey` = 'starting-point';
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'enrollment', `id` FROM `Enrollment` WHERE `lessonVersionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'lesson');
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'assignment', `id` FROM `Assignment` WHERE `sourceLessonVersionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'lesson')
  OR `problemSetVersionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'set');
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'recipient', `id` FROM `AssignmentRecipient` WHERE `assignmentId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'assignment')
  OR `sourceEnrollmentId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'enrollment');
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'submission', `id` FROM `Submission` WHERE `recipientId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'recipient');
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'item', `id` FROM `AssignmentItem` WHERE `assignmentId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'assignment');
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'attempt', `id` FROM `Attempt` WHERE `enrollmentId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'enrollment')
  OR `submissionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'submission')
  OR `assignmentItemId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'item');
DELETE FROM `AssessmentRevision` WHERE `attemptId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'attempt');
DELETE FROM `SubmissionItem` WHERE `submissionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'submission')
  OR `selectedAttemptId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'attempt')
  OR `assignmentItemId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'item');
DELETE FROM `Attempt` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'attempt');
DELETE FROM `Submission` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'submission');
DELETE FROM `AssignmentRecipient` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'recipient');
DELETE FROM `AssignmentItem` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'item');
DELETE FROM `Assignment` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'assignment');
DELETE FROM `HintUse` WHERE (`contextKind` = 'lesson' AND `contextId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'enrollment')) OR (`contextKind` = 'assignment' AND `contextId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'recipient'));
DELETE FROM `Enrollment` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'enrollment');
DELETE FROM `DiagnosticRun` WHERE `version` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'diagnostic');
DELETE FROM `RecommendationHistory` WHERE CAST(`snapshot` AS CHAR) REGEXP 'fraction-meaning|fraction-equivalence|fraction-addition';
UPDATE `User` SET `preferredLessonKey` = NULL WHERE `preferredLessonKey` IN ('fraction-meaning', 'fraction-equivalence', 'fraction-addition');
DELETE FROM `ContentDraft` WHERE (`ownerKind` = 'lesson' AND `ownerKey` IN ('fraction-meaning', 'fraction-equivalence', 'fraction-addition')) OR (`ownerKind` = 'problem_set' AND `ownerKey` IN ('fraction-meaning:practice', 'fraction-meaning:check', 'fraction-meaning:review', 'fraction-equivalence:practice', 'fraction-equivalence:check', 'fraction-equivalence:review', 'fraction-addition:practice', 'fraction-addition:check', 'fraction-addition:review', 'starting-point'));
DELETE FROM `ContentBlock` WHERE (`ownerKind` = 'section' AND `ownerVersionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'lesson')) OR (`ownerKind` = 'problem' AND `ownerVersionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'set'));
DELETE FROM `LessonSection` WHERE `lessonVersionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'lesson');
DELETE FROM `PublishedProblem` WHERE `ownerKind` = 'problem_set' AND `ownerVersionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'set');
DELETE FROM `LessonVersion` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'lesson');
DELETE FROM `DiagnosticVersion` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'diagnostic');
DELETE FROM `ProblemSetVersion` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'set');
-- Only retire the old topic-sized concepts when nobody else still references them.
-- Atomic definitions (fraction/numerator/denominator/...) retain their identities and scopes.
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'concept', `key` FROM `Concept` WHERE `key` IN ('fraction.meaning', 'fraction.equivalence', 'fraction.addition')
  AND NOT EXISTS (SELECT 1 FROM `PublishedProblem` WHERE JSON_CONTAINS(`conceptKeys`, JSON_QUOTE(`Concept`.`key`)))
  AND NOT EXISTS (SELECT 1 FROM `LessonVersion` WHERE JSON_SEARCH(`metadata`, 'one', `Concept`.`key`) IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM `ContentDraft` WHERE JSON_SEARCH(`document`, 'one', `Concept`.`key`) IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM `ContentBlock` WHERE JSON_SEARCH(`payload`, 'one', `Concept`.`key`) IS NOT NULL);
INSERT INTO `curriculum_reset_targets` (`kind`, `id`) SELECT 'definition', `id` FROM `ConceptDefinition` WHERE `conceptKey` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'concept');
DELETE FROM `ContentBlock` WHERE `ownerKind` = 'definition' AND `ownerVersionId` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'definition');
DELETE FROM `ConceptDefinition` WHERE `id` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'definition');
DELETE FROM `Concept` WHERE `key` IN (SELECT `id` FROM `curriculum_reset_targets` WHERE `kind` = 'concept');
COMMIT;
DROP TABLE `curriculum_reset_targets`;
