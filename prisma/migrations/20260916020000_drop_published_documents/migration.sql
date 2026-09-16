-- The published documents go. Two releases have served every class, diagnostic and definition from
-- the rows, and every deploy in between compared the two and found them identical, so the copy has
-- nothing left to say. Drafts keep their own document: a working copy is not a published version.
--
-- This is the step that cannot be undone by redeploying: an older image reads these columns.

ALTER TABLE `ClassVersion` DROP COLUMN `document`;
ALTER TABLE `DiagnosticVersion` DROP COLUMN `document`;
ALTER TABLE `TermVersion` DROP COLUMN `document`;
ALTER TABLE `PublishedProblem` DROP COLUMN `document`;
