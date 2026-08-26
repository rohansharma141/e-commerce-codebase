-- Dead-letter tracking for the webhook outbox.
--
-- The worker gives up after a fixed number of attempts and marks the row
-- delivered so it stops being retried, preserving the reason in last_error.
-- That is honest bookkeeping but it is a one-way door: a storefront that was
-- down for longer than the backoff window leaves rows nothing will ever
-- re-drive, and the only recovery is someone noticing and writing UPDATE by
-- hand.
--
-- Two explicit columns rather than inferring state from last_error:
--
--   exhausted  distinguishes "gave up" from "delivered successfully". Both
--              set delivered_at, because both mean "not pending" — but only
--              one of them is a failure, and a sweep must not re-queue rows
--              that actually arrived. Matching on a message prefix would
--              work until someone edits the message.
--
--   requeues   bounds the recovery. A sweep that re-queued unconditionally
--              would spin forever against a storefront that is gone for good.
--              After the cap the row stays exhausted, which is what a dead
--              letter is supposed to be.
ALTER TABLE audit.webhook_outbox
  ADD COLUMN IF NOT EXISTS exhausted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requeues  integer NOT NULL DEFAULT 0;

-- Existing rows that were given up on before this column existed. The prefix
-- is the one markExhausted has always written; this is the only place that
-- match is acceptable, because it runs once against historical data rather
-- than on every sweep.
UPDATE audit.webhook_outbox
   SET exhausted = true
 WHERE delivered_at IS NOT NULL
   AND last_error LIKE 'gave up after retries:%';

CREATE INDEX IF NOT EXISTS webhook_outbox_exhausted_idx
  ON audit.webhook_outbox (requeues)
  WHERE exhausted;
