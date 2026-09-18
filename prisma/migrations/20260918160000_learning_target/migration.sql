-- What someone came to learn, in place of why. The three goals (daily-math, foundation-recovery,
-- algebra-ready) were written when the service was for adults relearning the basics; a course a
-- learner names is what bounds a placement and gives a recommendation somewhere to go.
--
-- `goal` is left in place. Nothing reads it any more, but one of the three accounts on the
-- deployment had chosen something other than the default, and there is no course to map that to.
-- Dropping it is a separate decision, and additive here means the running app survives the window
-- between this migration and the new container.
ALTER TABLE `User` ADD COLUMN `targetCourseKey` VARCHAR(100) NULL;
