-- What each model call an account caused cost. One new table, created with its keys in one
-- statement after dropping what a stopped run may have left, so it can run again from the top.
DROP TABLE IF EXISTS `ModelUsage`;

CREATE TABLE `ModelUsage` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `feature` VARCHAR(30) NOT NULL,
    `step` VARCHAR(20) NOT NULL,
    `model` VARCHAR(60) NOT NULL,
    `inputTokens` INTEGER NOT NULL,
    `outputTokens` INTEGER NOT NULL,
    `cacheReadTokens` INTEGER NOT NULL,
    `cacheWriteTokens` INTEGER NOT NULL,
    `costMicros` INTEGER NOT NULL,
    `setId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `ModelUsage_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `ModelUsage_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ModelUsage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
