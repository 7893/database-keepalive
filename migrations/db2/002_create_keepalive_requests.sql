-- Apply once after 001 (or after importing the legacy Supabase log).
-- Separate keys preserve all eight fields of the imported historical records.
CREATE TABLE DB2_KEEPALIVE_REQUESTS (
    REQUEST_ID VARCHAR(36) NOT NULL PRIMARY KEY,
    LOG_ID BIGINT NOT NULL UNIQUE,
    FOREIGN KEY (LOG_ID) REFERENCES DB2_KEEPALIVE_LOGS (ID) ON DELETE CASCADE
);
