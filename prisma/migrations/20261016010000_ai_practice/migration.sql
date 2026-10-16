-- An AI practice set reads a learner's record over a scope and writes questions for what it finds,
-- after the request that asked for it has returned. One statement, so a migration stopped halfway
-- leaves the table as it was.
ALTER TABLE `GeneratedProblemSet`
    MODIFY `misconception` VARCHAR(60) NULL,
    ADD COLUMN `scope` VARCHAR(120) NULL,
    ADD COLUMN `plan` JSON NULL,
    ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'done';
