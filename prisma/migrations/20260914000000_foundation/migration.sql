-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(80) NOT NULL,
    `goal` VARCHAR(40) NOT NULL DEFAULT 'foundation-recovery',
    `dailyMinutes` INTEGER NOT NULL DEFAULT 10,
    `timezone` VARCHAR(80) NOT NULL DEFAULT 'Asia/Seoul',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Scope` (
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `ownerUserId` VARCHAR(191) NULL,

    UNIQUE INDEX `Scope_ownerUserId_key`(`ownerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClassVersion` (
    `id` VARCHAR(191) NOT NULL,
    `classKey` VARCHAR(100) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL,
    `document` JSON NOT NULL,
    `contentHash` VARCHAR(64) NOT NULL,
    `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClassVersion_classKey_idx`(`classKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Enrollment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `scopeId` VARCHAR(191) NOT NULL,
    `classVersionId` VARCHAR(191) NOT NULL,
    `completedSectionIds` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Enrollment_userId_classVersionId_key`(`userId`, `classVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Assignment` (
    `id` VARCHAR(191) NOT NULL,
    `ownerScopeId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `issuerType` VARCHAR(20) NOT NULL DEFAULT 'system',
    `sourceClassVersionId` VARCHAR(191) NULL,
    `policySnapshot` JSON NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssignmentItem` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `problemVersionId` VARCHAR(191) NOT NULL,
    `problemSnapshot` JSON NOT NULL,
    `position` INTEGER NOT NULL,

    UNIQUE INDEX `AssignmentItem_assignmentId_position_key`(`assignmentId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssignmentRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `learnerUserId` VARCHAR(191) NOT NULL,
    `sourceEnrollmentId` VARCHAR(191) NULL,
    `recommendedAt` DATETIME(3) NOT NULL,
    `dueAt` DATETIME(3) NULL,
    `assignmentPolicy` VARCHAR(20) NOT NULL DEFAULT 'adaptive',
    `status` VARCHAR(20) NOT NULL DEFAULT 'assigned',

    UNIQUE INDEX `AssignmentRecipient_sourceEnrollmentId_key`(`sourceEnrollmentId`),
    UNIQUE INDEX `AssignmentRecipient_assignmentId_learnerUserId_key`(`assignmentId`, `learnerUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Submission` (
    `id` VARCHAR(191) NOT NULL,
    `recipientId` VARCHAR(191) NOT NULL,
    `submissionIndex` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `finalizedAt` DATETIME(3) NULL,
    `requestId` VARCHAR(100) NULL,

    UNIQUE INDEX `Submission_recipientId_submissionIndex_key`(`recipientId`, `submissionIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attempt` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `scopeId` VARCHAR(191) NOT NULL,
    `enrollmentId` VARCHAR(191) NULL,
    `submissionId` VARCHAR(191) NULL,
    `assignmentItemId` VARCHAR(191) NULL,
    `problemVersionId` VARCHAR(191) NOT NULL,
    `answer` VARCHAR(128) NOT NULL,
    `result` JSON NOT NULL,
    `hintUsed` BOOLEAN NOT NULL DEFAULT false,
    `requestId` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Attempt_userId_createdAt_idx`(`userId`, `createdAt`),
    UNIQUE INDEX `Attempt_userId_requestId_key`(`userId`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubmissionItem` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `assignmentItemId` VARCHAR(191) NOT NULL,
    `selectedAttemptId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `SubmissionItem_submissionId_assignmentItemId_key`(`submissionId`, `assignmentItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HintUse` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `contextKind` VARCHAR(20) NOT NULL,
    `contextId` VARCHAR(191) NOT NULL,
    `problemVersionId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `HintUse_userId_contextKind_contextId_problemVersionId_key`(`userId`, `contextKind`, `contextId`, `problemVersionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssessmentRevision` (
    `id` VARCHAR(191) NOT NULL,
    `attemptId` VARCHAR(191) NOT NULL,
    `correctedResult` JSON NOT NULL,
    `reason` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Scope` ADD CONSTRAINT `Scope_ownerUserId_fkey` FOREIGN KEY (`ownerUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Enrollment` ADD CONSTRAINT `Enrollment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Enrollment` ADD CONSTRAINT `Enrollment_scopeId_fkey` FOREIGN KEY (`scopeId`) REFERENCES `Scope`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Enrollment` ADD CONSTRAINT `Enrollment_classVersionId_fkey` FOREIGN KEY (`classVersionId`) REFERENCES `ClassVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Assignment` ADD CONSTRAINT `Assignment_ownerScopeId_fkey` FOREIGN KEY (`ownerScopeId`) REFERENCES `Scope`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentItem` ADD CONSTRAINT `AssignmentItem_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `Assignment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentRecipient` ADD CONSTRAINT `AssignmentRecipient_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `Assignment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentRecipient` ADD CONSTRAINT `AssignmentRecipient_learnerUserId_fkey` FOREIGN KEY (`learnerUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssignmentRecipient` ADD CONSTRAINT `AssignmentRecipient_sourceEnrollmentId_fkey` FOREIGN KEY (`sourceEnrollmentId`) REFERENCES `Enrollment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Submission` ADD CONSTRAINT `Submission_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `AssignmentRecipient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attempt` ADD CONSTRAINT `Attempt_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attempt` ADD CONSTRAINT `Attempt_scopeId_fkey` FOREIGN KEY (`scopeId`) REFERENCES `Scope`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attempt` ADD CONSTRAINT `Attempt_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `Enrollment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attempt` ADD CONSTRAINT `Attempt_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attempt` ADD CONSTRAINT `Attempt_assignmentItemId_fkey` FOREIGN KEY (`assignmentItemId`) REFERENCES `AssignmentItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionItem` ADD CONSTRAINT `SubmissionItem_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `Submission`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionItem` ADD CONSTRAINT `SubmissionItem_assignmentItemId_fkey` FOREIGN KEY (`assignmentItemId`) REFERENCES `AssignmentItem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubmissionItem` ADD CONSTRAINT `SubmissionItem_selectedAttemptId_fkey` FOREIGN KEY (`selectedAttemptId`) REFERENCES `Attempt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HintUse` ADD CONSTRAINT `HintUse_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssessmentRevision` ADD CONSTRAINT `AssessmentRevision_attemptId_fkey` FOREIGN KEY (`attemptId`) REFERENCES `Attempt`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

