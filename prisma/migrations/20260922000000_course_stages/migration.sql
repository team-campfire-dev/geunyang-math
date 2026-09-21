-- One line of study became four, and the two school ones carry a year.
-- `math` was the whole school line; most of what it held is middle school, and the seed that runs
-- right after this sets each course's own track and stage.
ALTER TABLE `Course` ADD COLUMN `stage` VARCHAR(40) NULL;
ALTER TABLE `Course` ALTER COLUMN `track` SET DEFAULT 'middle';
UPDATE `Course` SET `track` = 'middle' WHERE `track` = 'math';
