-- A course now says which line of study it belongs to. Everything installed so far is the school
-- mathematics line, which is what the default records; a course on another line names it in its
-- own bundle. Additive and one statement, so a failed run leaves nothing behind to undo.
ALTER TABLE `Course` ADD COLUMN `track` VARCHAR(40) NOT NULL DEFAULT 'math';
