-- Existing installations only; deploy the reduced-schema writer first.
-- Verify all five columns exist. Run once in each configured ADB schema.
-- Permanently removes geographic values, preserving every check-in row.
ALTER TABLE keepalive_log DROP (colo, country, city, region, ip);
