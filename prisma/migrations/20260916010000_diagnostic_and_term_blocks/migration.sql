-- The blocks that were left behind: a diagnostic question's prompt, and the body of a term's
-- definition. With these every block a published version holds is a row, and `document` is a copy
-- of what the rows already say everywhere rather than only for classes.

INSERT INTO `ContentBlock` (`ownerKind`, `ownerVersionId`, `ownerId`, `slot`, `order`, `blockId`, `kind`, `typeVersion`, `required`, `payload`, `fallback`)
SELECT 'problem', `version`.`id`, `block`.`problemVersionId`, 'prompt', `block`.`ordinality` - 1,
  `block`.`blockId`, `block`.`kind`, `block`.`typeVersion`, `block`.`required`, `block`.`payload`, `block`.`fallback`
FROM `DiagnosticVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$[*]' COLUMNS (
  `problemVersionId` VARCHAR(191) PATH '$.problemVersionId',
  NESTED PATH '$.promptContent[*]' COLUMNS (
    `ordinality` FOR ORDINALITY,
    `blockId` VARCHAR(191) PATH '$.blockId',
    `kind` VARCHAR(100) PATH '$.kind',
    `typeVersion` INTEGER PATH '$.typeVersion',
    `required` BOOLEAN PATH '$.required',
    `payload` JSON PATH '$.payload',
    `fallback` TEXT PATH '$.fallback'
  )
)) AS `block`
WHERE `block`.`blockId` IS NOT NULL;

-- A definition is one list of blocks, so the version owns them directly.
INSERT INTO `ContentBlock` (`ownerKind`, `ownerVersionId`, `ownerId`, `slot`, `order`, `blockId`, `kind`, `typeVersion`, `required`, `payload`, `fallback`)
SELECT 'term', `version`.`id`, `version`.`id`, 'body', `block`.`ordinality` - 1,
  `block`.`blockId`, `block`.`kind`, `block`.`typeVersion`, `block`.`required`, `block`.`payload`, `block`.`fallback`
FROM `TermVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$[*]' COLUMNS (
  `ordinality` FOR ORDINALITY,
  `blockId` VARCHAR(191) PATH '$.blockId',
  `kind` VARCHAR(100) PATH '$.kind',
  `typeVersion` INTEGER PATH '$.typeVersion',
  `required` BOOLEAN PATH '$.required',
  `payload` JSON PATH '$.payload',
  `fallback` TEXT PATH '$.fallback'
)) AS `block`
WHERE `block`.`blockId` IS NOT NULL;
