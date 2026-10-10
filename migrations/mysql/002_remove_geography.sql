-- Existing installations only; deploy the reduced-schema writer first.
-- Verify all five columns exist and adapt the database name if necessary.
-- Permanently removes geographic values, preserving every check-in row.
ALTER TABLE keepalive.keepalive_logs
  DROP COLUMN colo,
  DROP COLUMN country,
  DROP COLUMN city,
  DROP COLUMN region,
  DROP COLUMN ip;
