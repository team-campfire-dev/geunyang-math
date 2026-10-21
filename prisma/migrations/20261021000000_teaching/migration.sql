-- Who may see a course, who teaches a learner, and which courses are set for them.
--
-- Several statements, so it is written to run again from the top after stopping anywhere: the three
-- new tables are dropped first if a stopped run left them, each is created with its keys in one
-- statement, and the one change to an existing table comes last, alone.
DROP TABLE IF EXISTS `AssignedCourse`;
DROP TABLE IF EXISTS `TeachingInvite`;
DROP TABLE IF EXISTS `TeachingLink`;

-- A person today and a model later: only a person has an account on the teaching side.
CREATE TABLE `TeachingLink` (
    `id` VARCHAR(191) NOT NULL,
    `learnerUserId` VARCHAR(191) NOT NULL,
    `teacherKind` VARCHAR(20) NOT NULL,
    `teacherUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `TeachingLink_teacherUserId_idx`(`teacherUserId`),
    UNIQUE INDEX `TeachingLink_learnerUserId_teacherKind_teacherUserId_key`(`learnerUserId`, `teacherKind`, `teacherUserId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `TeachingLink_learnerUserId_fkey` FOREIGN KEY (`learnerUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `TeachingLink_teacherUserId_fkey` FOREIGN KEY (`teacherUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TeachingInvite` (
    `code` VARCHAR(20) NOT NULL,
    `teacherUserId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `TeachingInvite_teacherUserId_key`(`teacherUserId`),
    PRIMARY KEY (`code`),
    CONSTRAINT `TeachingInvite_teacherUserId_fkey` FOREIGN KEY (`teacherUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Set through a link, a course goes with the link; set by an operator, it has none.
CREATE TABLE `AssignedCourse` (
    `id` VARCHAR(191) NOT NULL,
    `learnerUserId` VARCHAR(191) NOT NULL,
    `courseKey` VARCHAR(100) NOT NULL,
    `linkId` VARCHAR(191) NULL,
    `assignedByUserId` VARCHAR(191) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `AssignedCourse_linkId_idx`(`linkId`),
    UNIQUE INDEX `AssignedCourse_learnerUserId_courseKey_key`(`learnerUserId`, `courseKey`),
    PRIMARY KEY (`id`),
    CONSTRAINT `AssignedCourse_learnerUserId_fkey` FOREIGN KEY (`learnerUserId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `AssignedCourse_courseKey_fkey` FOREIGN KEY (`courseKey`) REFERENCES `Course`(`key`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `AssignedCourse_linkId_fkey` FOREIGN KEY (`linkId`) REFERENCES `TeachingLink`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `AssignedCourse_assignedByUserId_fkey` FOREIGN KEY (`assignedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every course there is stays open to everybody until an operator says otherwise.
ALTER TABLE `Course` ADD COLUMN `visibility` VARCHAR(20) NOT NULL DEFAULT 'public';
