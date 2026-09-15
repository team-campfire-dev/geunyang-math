-- Terms gain the scope that keeps them. Everything published so far is the operator's shared
-- dictionary, so existing rows take the defaults and no content has to be republished.
ALTER TABLE `TermVersion`
  ADD COLUMN `scopeKind` VARCHAR(20) NOT NULL DEFAULT 'global',
  ADD COLUMN `scopeKey` VARCHAR(100) NOT NULL DEFAULT '';

CREATE INDEX `TermVersion_scopeKind_scopeKey_termKey_idx` ON `TermVersion`(`scopeKind`, `scopeKey`, `termKey`);
