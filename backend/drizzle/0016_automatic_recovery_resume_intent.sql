ALTER TABLE automatic_recovery_lifecycle ADD COLUMN resume_sequence INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(resume_sequence) = 'integer' AND resume_sequence BETWEEN 0 AND 9007199254740991);
--> statement-breakpoint
CREATE TRIGGER automatic_recovery_resume_sequence_monotonic BEFORE UPDATE OF resume_sequence ON automatic_recovery_lifecycle
WHEN NEW.resume_sequence < OLD.resume_sequence
BEGIN SELECT RAISE(ABORT,'recovery Resume sequence cannot decrease'); END;
