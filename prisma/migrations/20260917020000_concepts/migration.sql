-- Skill and the glossary term become one thing: a concept (docs/glossary.md). A concept is global
-- and says whether a question may assess it; what a scope calls it and how it explains it is a
-- definition row, kept per scope, never frozen. Definitions have no versions any more — a definition
-- decides nothing, so there is no past to recover — and the latest version of each term becomes the
-- one definition of its concept in its scope.
--
-- The three skills become assessable concepts. Each term becomes a concept of its own, not
-- assessable, named without the `term.` prefix the keys carried (`term.denominator` → `denominator`).
-- Whether `약분` and `동치분수와 약분` are one concept is a judgement this migration does not make.

CREATE TABLE `Concept` (
  `key`        VARCHAR(100) NOT NULL,
  `label`      VARCHAR(191) NOT NULL,
  `assessable` BOOLEAN NOT NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ConceptDefinition` (
  `id`         VARCHAR(191) NOT NULL,
  `conceptKey` VARCHAR(100) NOT NULL,
  `scopeKind`  VARCHAR(20) NOT NULL,
  `scopeKey`   VARCHAR(100) NOT NULL DEFAULT '',
  `label`      VARCHAR(191) NULL,
  `summary`    VARCHAR(500) NULL,
  `updatedAt`  DATETIME(3) NOT NULL,
  UNIQUE INDEX `ConceptDefinition_conceptKey_scopeKind_scopeKey_key` (`conceptKey`, `scopeKind`, `scopeKey`),
  INDEX `ConceptDefinition_scopeKind_scopeKey_idx` (`scopeKind`, `scopeKey`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ConceptDefinition` ADD CONSTRAINT `ConceptDefinition_conceptKey_fkey`
  FOREIGN KEY (`conceptKey`) REFERENCES `Concept`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `Concept` (`key`, `label`, `assessable`)
SELECT `key`, `label`, TRUE FROM `Skill`;

-- One concept per term key, named by the latest version anyone published of it.
INSERT INTO `Concept` (`key`, `label`, `assessable`)
SELECT REGEXP_REPLACE(`version`.`termKey`, '^term\\.', ''), `version`.`label`, FALSE
FROM `TermVersion` AS `version`
JOIN (SELECT `termKey`, MAX(`publishedAt`) AS `publishedAt` FROM `TermVersion` GROUP BY `termKey`) AS `latest`
  ON `latest`.`termKey` = `version`.`termKey` AND `latest`.`publishedAt` = `version`.`publishedAt`
WHERE REGEXP_REPLACE(`version`.`termKey`, '^term\\.', '') NOT IN (SELECT `key` FROM `Skill`)
GROUP BY `version`.`termKey`, `version`.`label`;

-- The latest version in each scope is the definition. It keeps the version's id, so the blocks that
-- already hang off that id need only a new owner kind; a label equal to the concept's own is left
-- null, which reads as "the concept's name".
INSERT INTO `ConceptDefinition` (`id`, `conceptKey`, `scopeKind`, `scopeKey`, `label`, `summary`, `updatedAt`)
SELECT `version`.`id`, REGEXP_REPLACE(`version`.`termKey`, '^term\\.', ''), `version`.`scopeKind`, `version`.`scopeKey`,
  IF(`version`.`label` = `concept`.`label`, NULL, `version`.`label`), `version`.`summary`, `version`.`publishedAt`
FROM `TermVersion` AS `version`
JOIN (SELECT `termKey`, `scopeKind`, `scopeKey`, MAX(`publishedAt`) AS `publishedAt` FROM `TermVersion`
      GROUP BY `termKey`, `scopeKind`, `scopeKey`) AS `latest`
  ON `latest`.`termKey` = `version`.`termKey` AND `latest`.`scopeKind` = `version`.`scopeKind`
  AND `latest`.`scopeKey` = `version`.`scopeKey` AND `latest`.`publishedAt` = `version`.`publishedAt`
JOIN `Concept` AS `concept` ON `concept`.`key` = REGEXP_REPLACE(`version`.`termKey`, '^term\\.', '');

UPDATE `ContentBlock` SET `ownerKind` = 'definition'
WHERE `ownerKind` = 'term' AND `ownerVersionId` IN (SELECT `id` FROM `ConceptDefinition`);
-- Older versions of a definition have nothing to belong to.
DELETE FROM `ContentBlock` WHERE `ownerKind` = 'term';

DROP TABLE `TermVersion`;
DROP TABLE `Skill`;

-- What a question assesses, and what a lesson teaches and presumes, are concepts now.
ALTER TABLE `PublishedProblem` RENAME COLUMN `skillKeys` TO `conceptKeys`;
UPDATE `LessonVersion`
SET `metadata` = CAST(REPLACE(REPLACE(CAST(`metadata` AS CHAR CHARACTER SET utf8mb4),
  '"prerequisiteSkillKeys": ', '"prerequisiteConceptKeys": '), '"skillKeys": ', '"conceptKeys": ') AS JSON);

-- A paragraph's links name a concept and the scope whose definition explains it. The form moves to
-- core.rich_text@3: `terms[].termKey` becomes `definitions[].conceptKey`, and the keys lose the
-- prefix. MySQL prints JSON with a space after the colon, so the text form is replaced and cast back.
UPDATE `ContentBlock`
SET `typeVersion` = 3,
    `payload` = CAST(REPLACE(REPLACE(REPLACE(CAST(`payload` AS CHAR CHARACTER SET utf8mb4),
      '"termKey": "term.', '"conceptKey": "'), '"termKey": "', '"conceptKey": "'), '"terms": ', '"definitions": ') AS JSON)
WHERE `kind` = 'core.rich_text' AND `typeVersion` = 2;

-- Drafts are unpublished work in the old form; they are not carried over.
DELETE FROM `ContentDraft`;
