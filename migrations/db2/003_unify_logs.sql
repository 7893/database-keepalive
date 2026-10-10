-- Existing two-table installations only, using a migration administrator.
-- Phase 1: pause scheduled/manual writers and export both tables before changing them.
-- Add REQUEST_ID to the log table; this leaves the old writer usable until deployment.
ALTER TABLE DB2_KEEPALIVE_LOGS ADD COLUMN REQUEST_ID VARCHAR(36);
UPDATE DB2_KEEPALIVE_LOGS L
  SET REQUEST_ID = (SELECT R.REQUEST_ID FROM DB2_KEEPALIVE_REQUESTS R WHERE R.LOG_ID = L.ID)
  WHERE EXISTS (SELECT 1 FROM DB2_KEEPALIVE_REQUESTS R WHERE R.LOG_ID = L.ID);
CREATE UNIQUE INDEX DB2_KEEPALIVE_REQUEST_ID
  ON DB2_KEEPALIVE_LOGS (REQUEST_ID) EXCLUDE NULL KEYS;
COMMIT;
-- Must be zero. Do not continue if the request mapping differs.
SELECT COUNT(*) AS MISMATCHES FROM DB2_KEEPALIVE_REQUESTS R
  LEFT JOIN DB2_KEEPALIVE_LOGS L ON L.ID = R.LOG_ID
  WHERE L.ID IS NULL OR L.REQUEST_ID IS NULL OR L.REQUEST_ID <> R.REQUEST_ID;

-- Phase 2: ONLY after deploying and verifying the new single-table writer.
-- Recheck all request mappings and preserved log IDs/times/statuses before continuing.
DROP TABLE DB2_KEEPALIVE_REQUESTS;
ALTER TABLE DB2_KEEPALIVE_LOGS
  DROP COLUMN COLO
  DROP COLUMN COUNTRY
  DROP COLUMN CITY
  DROP COLUMN REGION
  DROP COLUMN IP;
CALL SYSPROC.ADMIN_CMD('REORG TABLE DB2_KEEPALIVE_LOGS');
