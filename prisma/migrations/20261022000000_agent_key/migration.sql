-- The codes an account gives an AI to write lessons through, the chat apps that ask to connect, and
-- the connections made with a code. Three new tables, each created with its keys in one statement
-- after dropping what a stopped run may have left — deepest first — so it can run again from the top.
DROP TABLE IF EXISTS `AgentGrant`;
DROP TABLE IF EXISTS `AgentClient`;
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

CREATE TABLE `AgentClient` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(500) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `redirectUris` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AgentClient_clientId_key`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AgentGrant` (
    `id` VARCHAR(191) NOT NULL,
    `keyId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(500) NOT NULL,
    `codeHash` VARCHAR(64) NULL,
    `codeChallenge` VARCHAR(128) NULL,
    `redirectUri` TEXT NULL,
    `codeExpiresAt` DATETIME(3) NULL,
    `accessHash` VARCHAR(64) NULL,
    `accessExpiresAt` DATETIME(3) NULL,
    `refreshHash` VARCHAR(64) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AgentGrant_codeHash_key`(`codeHash`),
    UNIQUE INDEX `AgentGrant_accessHash_key`(`accessHash`),
    UNIQUE INDEX `AgentGrant_refreshHash_key`(`refreshHash`),
    INDEX `AgentGrant_keyId_idx`(`keyId`),
    INDEX `AgentGrant_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `AgentGrant_keyId_fkey` FOREIGN KEY (`keyId`) REFERENCES `AgentKey`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `AgentGrant_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `AgentClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
