-- Where a course sits in the catalogue. Until now this followed the order the courses happened to be
-- installed in, which differs between a database seeded today and one that grew over weeks — and the
-- catalogue's order is what a learner who has chosen nothing is recommended by. Existing rows keep
-- their place: 0 for everyone leaves the installed order deciding, exactly as before, until a bundle
-- says otherwise.
ALTER TABLE `Course` ADD COLUMN `order` INT NOT NULL DEFAULT 0;
