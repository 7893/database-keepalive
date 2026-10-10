-- Apply to each ADB schema before releasing request-ID-aware writers.
-- Historical rows remain unchanged. Oracle unique indexes allow multiple NULLs.
BEGIN
  EXECUTE IMMEDIATE 'ALTER TABLE keepalive_log ADD request_id VARCHAR2(36)';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -1430 THEN RAISE; END IF;
END;
/
BEGIN
  EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX keepalive_request_id ON keepalive_log(request_id)';
EXCEPTION WHEN OTHERS THEN
  IF SQLCODE != -955 THEN RAISE; END IF;
END;
/
