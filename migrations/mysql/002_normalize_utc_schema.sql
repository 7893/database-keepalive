-- Upgrade the existing table; historical ping_time values are already UTC.
ALTER TABLE keepalive.keepalive_logs
  MODIFY COLUMN ping_time DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)) AFTER id,
  MODIFY COLUMN status VARCHAR(16) NOT NULL AFTER ping_time,
  MODIFY COLUMN request_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER status;
