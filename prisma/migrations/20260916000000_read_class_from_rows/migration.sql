-- The last of the class document that had nowhere else to live: what a class says about itself, and
-- what a question is apart from its blocks. With these the rows answer every read, and `document`
-- stays written only so a rollback still finds what it expects.
-- Columns arrive nullable, take their values from the documents, and only then become required.

ALTER TABLE `ClassVersion` ADD COLUMN `metadata` JSON NULL;

UPDATE `ClassVersion`
SET `metadata` = JSON_OBJECT('public', `document` -> '$.public',
  'homeworkProblemIds', `document` -> '$.homeworkProblemIds');

ALTER TABLE `ClassVersion` MODIFY COLUMN `metadata` JSON NOT NULL;

ALTER TABLE `PublishedProblem`
  ADD COLUMN `order` INTEGER NULL,
  ADD COLUMN `skillKeys` JSON NULL,
  ADD COLUMN `responseSpec` JSON NULL,
  ADD COLUMN `gradingSpec` JSON NULL,
  ADD COLUMN `hintAvailable` BOOLEAN NULL;

-- Everything but the position comes from the question itself.
UPDATE `PublishedProblem`
SET `skillKeys` = `document` -> '$.skillKeys',
    `responseSpec` = `document` -> '$.responseSpec',
    `gradingSpec` = `document` -> '$.gradingSpec',
    `hintAvailable` = JSON_EXTRACT(`document`, '$.hintAvailable') = CAST('true' AS JSON);

-- The position is the owning version's, so it comes from the document that keeps the list.
UPDATE `PublishedProblem` AS `indexed`
JOIN (
  -- A name read out of JSON carries the server's own collation, and comparing it with a stored one
  -- is refused as a mix. The join needs both sides in the collation the tables use.
  SELECT `version`.`id` AS `ownerVersionId`, `problem`.`ordinality` - 1 AS `position`,
    CONVERT(`problem`.`problemVersionId` USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `problemVersionId`
  FROM `ClassVersion` AS `version`,
  JSON_TABLE(`version`.`document`, '$.problems[*]' COLUMNS (
    `ordinality` FOR ORDINALITY,
    `problemVersionId` VARCHAR(191) PATH '$.problemVersionId'
  )) AS `problem`
) AS `source`
  ON `indexed`.`ownerVersionId` = `source`.`ownerVersionId` AND `indexed`.`problemVersionId` = `source`.`problemVersionId`
SET `indexed`.`order` = `source`.`position`
WHERE `indexed`.`ownerKind` = 'class';

UPDATE `PublishedProblem` AS `indexed`
JOIN (
  -- A name read out of JSON carries the server's own collation, and comparing it with a stored one
  -- is refused as a mix. The join needs both sides in the collation the tables use.
  SELECT `version`.`id` AS `ownerVersionId`, `problem`.`ordinality` - 1 AS `position`,
    CONVERT(`problem`.`problemVersionId` USING utf8mb4) COLLATE utf8mb4_unicode_ci AS `problemVersionId`
  FROM `DiagnosticVersion` AS `version`,
  JSON_TABLE(`version`.`document`, '$[*]' COLUMNS (
    `ordinality` FOR ORDINALITY,
    `problemVersionId` VARCHAR(191) PATH '$.problemVersionId'
  )) AS `problem`
) AS `source`
  ON `indexed`.`ownerVersionId` = `source`.`ownerVersionId` AND `indexed`.`problemVersionId` = `source`.`problemVersionId`
SET `indexed`.`order` = `source`.`position`
WHERE `indexed`.`ownerKind` = 'diagnostic';

ALTER TABLE `PublishedProblem`
  MODIFY COLUMN `order` INTEGER NOT NULL,
  MODIFY COLUMN `skillKeys` JSON NOT NULL,
  MODIFY COLUMN `responseSpec` JSON NOT NULL,
  MODIFY COLUMN `gradingSpec` JSON NOT NULL,
  MODIFY COLUMN `hintAvailable` BOOLEAN NOT NULL;

CREATE INDEX `PublishedProblem_ownerKind_ownerVersionId_order_idx` ON `PublishedProblem`(`ownerKind`, `ownerVersionId`, `order`);
