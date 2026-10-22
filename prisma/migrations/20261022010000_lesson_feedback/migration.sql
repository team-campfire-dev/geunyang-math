-- Feedback a reader leaves on a place in a lesson, and whether a lesson takes it.
--
-- Two statements, written to run again from the top after stopping anywhere: the new table is dropped
-- first if a stopped run left it, and the one change to an existing table comes last, alone.
DROP TABLE IF EXISTS `LessonFeedback`;

CREATE TABLE `LessonFeedback` (
    `id` VARCHAR(191) NOT NULL,
    `authorUserId` VARCHAR(191) NOT NULL,
    `lessonKey` VARCHAR(100) NOT NULL,
    `lessonVersionId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `blockId` VARCHAR(191) NULL,
    `problemVersionId` VARCHAR(191) NULL,
    `quote` TEXT NULL,
    `reason` VARCHAR(20) NULL,
    `body` TEXT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'open',
    `resolvedByUserId` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `LessonFeedback_lessonKey_createdAt_idx`(`lessonKey`, `createdAt`),
    INDEX `LessonFeedback_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `LessonFeedback_authorUserId_createdAt_idx`(`authorUserId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `LessonFeedback_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `LessonFeedback_lessonKey_fkey` FOREIGN KEY (`lessonKey`) REFERENCES `Lesson`(`key`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `LessonFeedback_resolvedByUserId_fkey` FOREIGN KEY (`resolvedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every lesson takes feedback until somebody turns it off.
ALTER TABLE `Lesson` ADD COLUMN `feedbackOpen` BOOLEAN NOT NULL DEFAULT true;
