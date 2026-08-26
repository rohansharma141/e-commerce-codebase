-- Which category listings a webhook affects.
--
-- The storefront caches a category page under its own tag, so it needs to know
-- which categories a product change touches in order to drop those pages and
-- leave the rest warm. Only the api can answer that, and only at the moment of
-- the change: on an edit that moves a product between categories, the category
-- it LEFT is the one still listing it, and once the search document has been
-- rewritten nothing downstream can discover what that was.
--
-- Nullable rather than defaulted to '{}' on purpose. NULL means "this row was
-- written by an api that did not know about categories", which a consumer must
-- treat as "assume everything changed"; an empty array means "this api looked,
-- and the product is in no category". Collapsing the two would turn a
-- deploy-skew window into silently stale pages.
ALTER TABLE audit.webhook_outbox
  ADD COLUMN IF NOT EXISTS categories text[];
