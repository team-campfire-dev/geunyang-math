-- Sections and content blocks get rows of their own, filled from the documents that already hold
-- them. Nothing reads these yet: this migration only makes the two representations exist side by
-- side so `content:verify` can prove they agree before any read moves over.

CREATE TABLE `ClassSection` (
  `classVersionId` VARCHAR(191) NOT NULL,
  `sectionId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(20) NOT NULL,
  `title` VARCHAR(500) NOT NULL,
  `order` INTEGER NOT NULL,
  INDEX `ClassSection_classVersionId_order_idx` (`classVersionId`, `order`),
  PRIMARY KEY (`classVersionId`, `sectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ContentBlock` (
  `ownerKind` VARCHAR(20) NOT NULL,
  `ownerVersionId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `slot` VARCHAR(20) NOT NULL,
  `order` INTEGER NOT NULL,
  `blockId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(100) NOT NULL,
  `typeVersion` INTEGER NOT NULL,
  `required` BOOLEAN NOT NULL,
  `payload` JSON NOT NULL,
  -- NULL means the document has no `fallback` key. Restoring it as null would change the hash.
  `fallback` TEXT NULL,
  INDEX `ContentBlock_ownerVersionId_idx` (`ownerVersionId`),
  INDEX `ContentBlock_kind_typeVersion_idx` (`kind`, `typeVersion`),
  PRIMARY KEY (`ownerKind`, `ownerVersionId`, `ownerId`, `slot`, `order`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `ClassSection` (`classVersionId`, `sectionId`, `role`, `title`, `order`)
SELECT `version`.`id`, `section`.`sectionId`, `section`.`role`, `section`.`title`, `section`.`ordinality` - 1
FROM `ClassVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$.sections[*]' COLUMNS (
  `ordinality` FOR ORDINALITY,
  `sectionId` VARCHAR(191) PATH '$.sectionId',
  `role` VARCHAR(20) PATH '$.role',
  `title` VARCHAR(500) PATH '$.title'
)) AS `section`;

-- A section keeps its blocks in one list; a question keeps three, and each is its own slot. An
-- empty list still yields one row of nulls from NESTED PATH, which is what the blockId test drops.
INSERT INTO `ContentBlock` (`ownerKind`, `ownerVersionId`, `ownerId`, `slot`, `order`, `blockId`, `kind`, `typeVersion`, `required`, `payload`, `fallback`)
SELECT 'section', `version`.`id`, `block`.`sectionId`, 'body', `block`.`ordinality` - 1,
  `block`.`blockId`, `block`.`kind`, `block`.`typeVersion`, `block`.`required`, `block`.`payload`, `block`.`fallback`
FROM `ClassVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$.sections[*]' COLUMNS (
  `sectionId` VARCHAR(191) PATH '$.sectionId',
  NESTED PATH '$.contentBlocks[*]' COLUMNS (
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

INSERT INTO `ContentBlock` (`ownerKind`, `ownerVersionId`, `ownerId`, `slot`, `order`, `blockId`, `kind`, `typeVersion`, `required`, `payload`, `fallback`)
SELECT 'problem', `version`.`id`, `block`.`problemVersionId`, 'prompt', `block`.`ordinality` - 1,
  `block`.`blockId`, `block`.`kind`, `block`.`typeVersion`, `block`.`required`, `block`.`payload`, `block`.`fallback`
FROM `ClassVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$.problems[*]' COLUMNS (
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

INSERT INTO `ContentBlock` (`ownerKind`, `ownerVersionId`, `ownerId`, `slot`, `order`, `blockId`, `kind`, `typeVersion`, `required`, `payload`, `fallback`)
SELECT 'problem', `version`.`id`, `block`.`problemVersionId`, 'hint', `block`.`ordinality` - 1,
  `block`.`blockId`, `block`.`kind`, `block`.`typeVersion`, `block`.`required`, `block`.`payload`, `block`.`fallback`
FROM `ClassVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$.problems[*]' COLUMNS (
  `problemVersionId` VARCHAR(191) PATH '$.problemVersionId',
  NESTED PATH '$.hints[*]' COLUMNS (
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

INSERT INTO `ContentBlock` (`ownerKind`, `ownerVersionId`, `ownerId`, `slot`, `order`, `blockId`, `kind`, `typeVersion`, `required`, `payload`, `fallback`)
SELECT 'problem', `version`.`id`, `block`.`problemVersionId`, 'solution', `block`.`ordinality` - 1,
  `block`.`blockId`, `block`.`kind`, `block`.`typeVersion`, `block`.`required`, `block`.`payload`, `block`.`fallback`
FROM `ClassVersion` AS `version`,
JSON_TABLE(`version`.`document`, '$.problems[*]' COLUMNS (
  `problemVersionId` VARCHAR(191) PATH '$.problemVersionId',
  NESTED PATH '$.solution[*]' COLUMNS (
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
