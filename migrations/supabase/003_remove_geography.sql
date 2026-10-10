-- Existing installations only; deploy the reduced-schema writer first.
-- Permanently removes geographic values, preserving every check-in row.
ALTER TABLE public.my_keepalive_logs
  DROP COLUMN IF EXISTS colo,
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS ip;
NOTIFY pgrst, 'reload schema';
