-- Upgrade the legacy TIMESTAMP table whose values are already UTC.
-- Verify historical timezone first. Oracle DDL commits implicitly; back up first.
UPDATE keepalive_log
SET request_id = LOWER(REGEXP_REPLACE(RAWTOHEX(SYS_GUID()),
  '^(.{8})(.{4})(.{4})(.{4})(.{12})$', '\1-\2-\3-\4-\5'))
WHERE request_id IS NULL;
COMMIT;
ALTER TABLE keepalive_log MODIFY (
  ping_time TIMESTAMP(6) DEFAULT SYS_EXTRACT_UTC(SYSTIMESTAMP) NOT NULL,
  status VARCHAR2(16 CHAR) NOT NULL,
  request_id VARCHAR2(36 CHAR) NOT NULL
);
CREATE INDEX keepalive_log_ping_time_idx ON keepalive_log (ping_time DESC, id DESC);
