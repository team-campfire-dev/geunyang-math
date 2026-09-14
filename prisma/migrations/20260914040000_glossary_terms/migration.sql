-- Glossary terms are published content with their own immutable versions, so a definition can be
-- reworded without republishing every class that links to it. Terms arrive through content:import.

CREATE TABLE `TermVersion` (
  `id` VARCHAR(191) NOT NULL,
  `termKey` VARCHAR(100) NOT NULL,
  `skillKey` VARCHAR(100) NOT NULL,
  `label` VARCHAR(191) NOT NULL,
  `summary` VARCHAR(500) NOT NULL,
  `document` JSON NOT NULL,
  `contentHash` VARCHAR(64) NOT NULL,
  `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `TermVersion_termKey_publishedAt_idx`(`termKey`, `publishedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TermVersion` ADD CONSTRAINT `TermVersion_skillKey_fkey` FOREIGN KEY (`skillKey`) REFERENCES `Skill`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;
