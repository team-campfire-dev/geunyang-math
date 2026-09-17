-- The context of an explanation is optional; existing definitions remain readable.
ALTER TABLE `ConceptDefinition` ADD COLUMN `usageNote` VARCHAR(500) NULL;
