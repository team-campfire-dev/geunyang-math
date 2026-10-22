-- The codes an account gives an AI to write lessons through. One new table, created with its keys in
-- one statement after dropping what a stopped run may have left, so it can run again from the top.
DROP TABLE IF EXISTS `AgentKey`;

CREATE TABLE `AgentKey` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `hint` VARCHAR(16) NOT NULL,
    `mayPublish` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AgentKey_tokenHash_key`(`tokenHash`),
    INDEX `AgentKey_userId_idx`(`userId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `AgentKey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
