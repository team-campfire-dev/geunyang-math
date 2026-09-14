-- Records which reviewed bundle files a deployment already published, so an unchanged file is
-- skipped instead of re-read on every release. Publishing itself stays immutable and idempotent.

CREATE TABLE `AppliedContentBundle` (
  `name` VARCHAR(191) NOT NULL,
  `checksum` VARCHAR(64) NOT NULL,
  `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
