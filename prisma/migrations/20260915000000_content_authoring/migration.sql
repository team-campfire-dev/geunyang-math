-- Content authoring: who may write content, and the working copies they write. Published versions
-- remain immutable; a draft is copied into a new ClassVersion at publish time and never replaces one.

CREATE TABLE `ContentAuthor` (
  `userId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(20) NOT NULL,
  `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`),
  CONSTRAINT `ContentAuthor_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ContentDraft` (
  `id` VARCHAR(191) NOT NULL,
  `classKey` VARCHAR(100) NOT NULL,
  `versionId` VARCHAR(191) NOT NULL,
  `baseVersionId` VARCHAR(191) NULL,
  `title` VARCHAR(191) NOT NULL,
  `document` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `authorId` VARCHAR(191) NOT NULL,
  `publishedVersionId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `ContentDraft_classKey_idx` (`classKey`),
  INDEX `ContentDraft_authorId_updatedAt_idx` (`authorId`, `updatedAt`),
  CONSTRAINT `ContentDraft_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
