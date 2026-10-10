-- Apply once after initializing DB2_KEEPALIVE_LOGS.
-- Separate request IDs keep the log schema unchanged and prevent duplicate writes.
CREATE TABLE DB2_KEEPALIVE_REQUESTS (
    REQUEST_ID VARCHAR(36) NOT NULL PRIMARY KEY,
    LOG_ID BIGINT NOT NULL UNIQUE,
    FOREIGN KEY (LOG_ID) REFERENCES DB2_KEEPALIVE_LOGS (ID) ON DELETE CASCADE
);
