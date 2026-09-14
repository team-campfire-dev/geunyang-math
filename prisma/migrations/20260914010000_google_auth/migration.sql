-- Existing sessions remain development-only. No destructive schema operations.
ALTER TABLE `Session` ADD COLUMN `authMethod` VARCHAR(20) NOT NULL DEFAULT 'development';

CREATE TABLE `GoogleIdentity` (
    `subject` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `GoogleIdentity_userId_key` (`userId`),
    PRIMARY KEY (`subject`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OAuthAttempt` (
    `stateHash` VARCHAR(64) NOT NULL,
    `browserHash` VARCHAR(64) NOT NULL,
    `codeVerifier` VARCHAR(128) NOT NULL,
    `nonce` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `OAuthAttempt_expiresAt_idx` (`expiresAt`),
    INDEX `OAuthAttempt_browserHash_idx` (`browserHash`),
    PRIMARY KEY (`stateHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `GoogleIdentity` ADD CONSTRAINT `GoogleIdentity_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
