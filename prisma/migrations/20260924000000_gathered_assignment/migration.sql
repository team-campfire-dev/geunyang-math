-- An assignment used to be one problem set version, picked from and ordered. A set gathered for one
-- learner is not: its questions are chosen across the catalogue by what they were built to catch,
-- so it names no set, and saying that out loud is what these two columns becoming nullable means.
ALTER TABLE `Assignment` MODIFY `problemSetId` VARCHAR(191) NULL;
ALTER TABLE `Assignment` MODIFY `problemSetVersionId` VARCHAR(191) NULL;
