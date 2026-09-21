-- A wrong answer used to be one fact — wrong. This is where a question says what its own wrong
-- answers mean, so that what a learner keeps doing can be counted rather than guessed at.
-- Nullable: almost no question has any, and one written before this had none.
ALTER TABLE `PublishedProblem` ADD COLUMN `misreadings` JSON NULL;
