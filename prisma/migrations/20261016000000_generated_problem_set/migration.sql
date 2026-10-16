-- Questions a model writes for one learner, when the catalogue has too few built to catch the mistake
-- they keep making. The questions themselves are PublishedProblem rows of kind 'generated'; this is
-- who they were written for, why, and how many passed the checks. One statement, foreign key and
-- all, so a migration stopped halfway leaves nothing behind to trip over on the next run.
CREATE TABLE `GeneratedProblemSet` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `misconception` VARCHAR(60) NOT NULL,
    `courseKey` VARCHAR(100) NULL,
    `model` VARCHAR(60) NOT NULL,
    `requested` INTEGER NOT NULL,
    `kept` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `GeneratedProblemSet_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `GeneratedProblemSet_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
