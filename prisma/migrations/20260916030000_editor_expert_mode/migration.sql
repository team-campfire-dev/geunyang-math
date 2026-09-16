-- The editor hides the names the system uses — block and version identifiers, the compatibility
-- switches — from the people who write lessons, and shows them to whoever is also operating the
-- service. Which of the two someone is, is a setting on their account, so it follows them between
-- browsers. Off by default: the screen a new account opens is the one written for teachers.
ALTER TABLE `User`
  ADD COLUMN `editorExpertMode` BOOLEAN NOT NULL DEFAULT false;
