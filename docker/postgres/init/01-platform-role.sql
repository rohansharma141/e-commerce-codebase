-- Bootstrap a non-superuser `platform` role + `platform` database.
--
-- The official postgres image creates POSTGRES_USER as a SUPERUSER, and
-- superusers bypass row-level security regardless of FORCE RLS. We need a
-- normal role so the catalog tables' RLS policies actually apply to the api's
-- connections. So docker-compose runs the image with POSTGRES_USER=postgres
-- (the default superuser), and this initdb script creates the real app role.

CREATE ROLE platform WITH LOGIN PASSWORD 'platform' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE platform OWNER platform;

-- The catalog module creates its own schema at boot (see catalog migrations).
-- Granting CREATE on the database lets the platform role create schemas it owns.
GRANT ALL ON DATABASE platform TO platform;
