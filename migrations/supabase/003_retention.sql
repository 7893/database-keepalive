-- Optional: apply before enabling retention. Does not delete any records itself.
-- SECURITY INVOKER and explicit grants keep this RPC unavailable to public users.
CREATE OR REPLACE FUNCTION public.prune_keepalive_logs(max_age_days integer DEFAULT NULL, max_rows integer DEFAULT NULL)
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
    DELETE FROM public.my_keepalive_logs
    WHERE ping_time < (statement_timestamp() AT TIME ZONE 'UTC') - make_interval(days => max_age_days)
      AND ping_time < (statement_timestamp() AT TIME ZONE 'UTC') - interval '15 minutes';
  ELSE
    DELETE FROM public.my_keepalive_logs
    WHERE id IN (
      SELECT id FROM (
        SELECT id, row_number() OVER (ORDER BY ping_time DESC, id DESC) AS rn
        FROM public.my_keepalive_logs
      ) AS ranked WHERE rn > max_rows
    ) AND ping_time < (statement_timestamp() AT TIME ZONE 'UTC') - interval '15 minutes';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_keepalive_logs(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_keepalive_logs(integer, integer) TO service_role;
GRANT DELETE ON public.my_keepalive_logs TO service_role;
NOTIFY pgrst, 'reload schema';
