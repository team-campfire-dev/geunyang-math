-- When a learner came and what they came in, and when each step of a lesson was finished.
--
-- Two statements, written to run again from the top after stopping anywhere: the new table is dropped
-- first if a stopped run left it, and the one change to an existing table comes last, alone.
DROP TABLE IF EXISTS `LearnerVisit`;

CREATE TABLE `LearnerVisit` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sessionId` VARCHAR(191) NULL,
    `kind` VARCHAR(20) NOT NULL,
    `device` VARCHAR(20) NOT NULL,
    `os` VARCHAR(20) NOT NULL,
    `browser` VARCHAR(20) NOT NULL,
    `inApp` VARCHAR(20) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `LearnerVisit_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `LearnerVisit_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A step finished before this has no time, and says so by being absent.
ALTER TABLE `Enrollment` ADD COLUMN `sectionTimes` JSON NULL;
