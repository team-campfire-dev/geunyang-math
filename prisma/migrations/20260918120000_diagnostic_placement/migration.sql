-- What a placement settled, frozen as it was decided. A run started before this column existed has
-- none, and reads as a placement that settled nothing rather than one to be worked out again from a
-- graph that has since changed.
ALTER TABLE `DiagnosticRun` ADD COLUMN `placement` JSON NULL;
