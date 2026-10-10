-- New installations: request IDs live in the log table.
-- Historical rows may have NULL request IDs; all current writers provide one.
ALTER TABLE DB2_KEEPALIVE_LOGS ADD COLUMN REQUEST_ID VARCHAR(36);
CREATE UNIQUE INDEX DB2_KEEPALIVE_REQUEST_ID
  ON DB2_KEEPALIVE_LOGS (REQUEST_ID) EXCLUDE NULL KEYS;
