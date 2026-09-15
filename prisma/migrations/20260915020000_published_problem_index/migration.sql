-- Published questions gain a lookup by name. Saving a draft has to know whether a question it holds
-- already belongs to a published version, which until now meant reading every published document.
-- The class and diagnostic documents stay the record; this table repeats what they already hold, so
-- it is rebuilt from them, never edited on its own.

CREATE TABLE `PublishedProblem` (
  `ownerKind` VARCHAR(20) NOT NULL,
  `ownerVersionId` VARCHAR(191) NOT NULL,
  `problemVersionId` VARCHAR(191) NOT NULL,
  `document` JSON NOT NULL,
  INDEX `PublishedProblem_problemVersionId_idx` (`problemVersionId`),
  PRIMARY KEY (`ownerKind`, `ownerVersionId`, `problemVersionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A class keeps its questions under `problems`; a diagnostic document is the question list itself.
INSERT INTO `PublishedProblem` (`ownerKind`, `ownerVersionId`, `problemVersionId`, `document`)
SELECT 'class', `version`.`id`, `problem`.`problemVersionId`, `problem`.`document`
FROM `ClassVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$.problems[*]' COLUMNS (
  `problemVersionId` VARCHAR(191) PATH '$.problemVersionId',
  `document` JSON PATH '$'
)) AS `problem`;

INSERT INTO `PublishedProblem` (`ownerKind`, `ownerVersionId`, `problemVersionId`, `document`)
SELECT 'diagnostic', `version`.`id`, `problem`.`problemVersionId`, `problem`.`document`
FROM `DiagnosticVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$[*]' COLUMNS (
  `problemVersionId` VARCHAR(191) PATH '$.problemVersionId',
  `document` JSON PATH '$'
)) AS `problem`;
