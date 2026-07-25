-- ============================================================
-- Mock Matrix Hub — Attempt History (Cloudflare D1)
-- Every reattempt is its own row (At_no = 1, 2, 3...), so every
-- attempt counts toward rank/toppers/total_attempts — matches
-- the old Firebase attempt_history behaviour. This table is now
-- the single source of truth for rank AND toppers (quiz_results
-- on Firebase is no longer used).
-- Run once per account/exam shard:
--   npx wrangler d1 execute <DB_NAME> --remote --file=./schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS attempts (
  quiz_id         TEXT NOT NULL,
  email_key       TEXT NOT NULL,   -- holds username, not an actual email
  At_no           INTEGER NOT NULL,   -- attempt number per user per quiz: 1, 2, 3...
  score           REAL NOT NULL,
  correct         INTEGER NOT NULL DEFAULT 0,
  wrong           INTEGER NOT NULL DEFAULT 0,
  time_taken      INTEGER NOT NULL,   -- total session seconds (authoritative)
  response_stream TEXT NOT NULL,      -- "ans:qtime|ans:qtime|..." (no :Y marked flag)
  sections        TEXT NOT NULL,      -- JSON: {"REASONING":{"score":32,"correct":15,"wrong":3,"timeTaken":620}}
  PRIMARY KEY (quiz_id, email_key, At_no)
) WITHOUT ROWID;

-- Speeds up rank/toppers: within a quiz_id, rows are already
-- ordered best-score-first / fastest-time-first.
CREATE INDEX IF NOT EXISTS idx_rank
  ON attempts (quiz_id, score DESC, time_taken ASC);

-- Running total-attempts counter per quiz — avoids scanning
-- every row just to answer "how many attempts has this quiz had".
CREATE TABLE IF NOT EXISTS quiz_stats (
  quiz_id        TEXT PRIMARY KEY,
  total_attempts INTEGER NOT NULL DEFAULT 0
);

-- Every submit is now a new row (new At_no), so this fires on
-- every attempt, including reattempts — total_attempts grows
-- with each reattempt, as intended.
CREATE TRIGGER IF NOT EXISTS trg_attempt_count_up
AFTER INSERT ON attempts
BEGIN
  INSERT INTO quiz_stats (quiz_id, total_attempts)
  VALUES (NEW.quiz_id, 1)
  ON CONFLICT(quiz_id) DO UPDATE SET total_attempts = total_attempts + 1;
END;

-- Only fires if a row is ever actually DELETEd (no purge planned
-- today, but kept for future-safety — harmless if unused).
CREATE TRIGGER IF NOT EXISTS trg_attempt_count_down
AFTER DELETE ON attempts
BEGIN
  UPDATE quiz_stats
  SET total_attempts = total_attempts - 1
  WHERE quiz_id = OLD.quiz_id;
END;

