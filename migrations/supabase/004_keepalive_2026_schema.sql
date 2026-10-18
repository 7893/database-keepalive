-- Apply after 001 (and 002 for legacy installations) and 003.
-- Stage the Worker with schema = "keepalive_2026" before the coordinated cutover.
-- Add keepalive_2026 to the Data API's exposed schemas; retain other applications' schemas.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE SCHEMA IF NOT EXISTS keepalive_2026 AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA keepalive_2026 FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA keepalive_2026 TO service_role;

DO $migration$
BEGIN
  IF to_regclass('public.my_keepalive_logs') IS NOT NULL THEN
    IF to_regclass('keepalive_2026.my_keepalive_logs') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public and keepalive_2026 contain my_keepalive_logs';
    END IF;
    ALTER TABLE public.my_keepalive_logs SET SCHEMA keepalive_2026;
  END IF;
  IF to_regclass('keepalive_2026.my_keepalive_logs') IS NULL THEN
    RAISE EXCEPTION 'Initialize the keepalive log table before applying migration 004';
  END IF;
  IF to_regclass('public.keepalive_summary') IS NOT NULL THEN
    IF to_regclass('keepalive_2026.keepalive_summary') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public and keepalive_2026 contain keepalive_summary';
    END IF;
    ALTER TABLE public.keepalive_summary SET SCHEMA keepalive_2026;
  END IF;
  IF to_regprocedure('public.prune_keepalive_logs(integer,integer)') IS NOT NULL THEN
    IF to_regprocedure('keepalive_2026.prune_keepalive_logs(integer,integer)') IS NOT NULL THEN
      RAISE EXCEPTION 'Both schemas contain prune_keepalive_logs';
    END IF;
    ALTER FUNCTION public.prune_keepalive_logs(integer, integer) SET SCHEMA keepalive_2026;
  END IF;
END;
$migration$;

ALTER TABLE keepalive_2026.my_keepalive_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read" ON keepalive_2026.my_keepalive_logs;
DROP POLICY IF EXISTS keepalive_no_client_access ON keepalive_2026.my_keepalive_logs;
CREATE POLICY keepalive_no_client_access ON keepalive_2026.my_keepalive_logs
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE keepalive_2026.my_keepalive_logs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE keepalive_2026.my_keepalive_logs TO service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA keepalive_2026 FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA keepalive_2026 TO service_role;

-- Preserve the optional historical summary, while closing direct client access.
DO $migration$
BEGIN
  IF to_regclass('keepalive_2026.keepalive_summary') IS NOT NULL THEN
    ALTER TABLE keepalive_2026.keepalive_summary ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Allow public read" ON keepalive_2026.keepalive_summary;
    DROP POLICY IF EXISTS "Allow service role all" ON keepalive_2026.keepalive_summary;
    DROP POLICY IF EXISTS keepalive_no_client_access ON keepalive_2026.keepalive_summary;
    CREATE POLICY keepalive_no_client_access ON keepalive_2026.keepalive_summary
      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
    REVOKE ALL ON TABLE keepalive_2026.keepalive_summary FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE keepalive_2026.keepalive_summary TO service_role;
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION keepalive_2026.prune_keepalive_logs(max_age_days integer DEFAULT NULL, max_rows integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (max_age_days IS NULL) = (max_rows IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one retention rule';
  END IF;
  IF max_age_days IS NOT NULL AND (max_age_days < 3 OR max_age_days > 36500) THEN
    RAISE EXCEPTION 'Invalid max_age_days';
  END IF;
  IF max_rows IS NOT NULL AND max_rows < 12 THEN
    RAISE EXCEPTION 'Invalid max_rows';
  END IF;
  IF max_age_days IS NOT NULL THEN
    DELETE FROM keepalive_2026.my_keepalive_logs
    WHERE ping_time < (statement_timestamp() AT TIME ZONE 'UTC') - make_interval(days => max_age_days)
      AND ping_time < (statement_timestamp() AT TIME ZONE 'UTC') - interval '15 minutes';
  ELSE
    DELETE FROM keepalive_2026.my_keepalive_logs
    WHERE id IN (
      SELECT id FROM (
        SELECT id, row_number() OVER (ORDER BY ping_time DESC, id DESC) AS rn
        FROM keepalive_2026.my_keepalive_logs
      ) AS ranked WHERE rn > max_rows
    ) AND ping_time < (statement_timestamp() AT TIME ZONE 'UTC') - interval '15 minutes';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION keepalive_2026.prune_keepalive_logs(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION keepalive_2026.prune_keepalive_logs(integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
