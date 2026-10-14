-- Upgrade the legacy timestamptz/UUID table; back up before running once.
BEGIN;
ALTER TABLE public.my_keepalive_logs
  ALTER COLUMN id TYPE bigint,
  ALTER COLUMN ping_time DROP DEFAULT,
  ALTER COLUMN ping_time TYPE timestamp(6) without time zone USING ping_time AT TIME ZONE 'UTC',
  ALTER COLUMN ping_time SET DEFAULT (now() AT TIME ZONE 'UTC'),
  ALTER COLUMN ping_time SET NOT NULL,
  ALTER COLUMN status TYPE varchar(16),
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN request_id TYPE varchar(36) USING request_id::text;
ALTER SEQUENCE public.my_keepalive_logs_id_seq AS bigint;
UPDATE public.my_keepalive_logs SET request_id = gen_random_uuid()::text WHERE request_id IS NULL;
ALTER TABLE public.my_keepalive_logs ALTER COLUMN request_id SET NOT NULL;
DROP INDEX IF EXISTS public.my_keepalive_logs_ping_time_idx;
CREATE INDEX my_keepalive_logs_ping_time_idx ON public.my_keepalive_logs (ping_time DESC, id DESC);
NOTIFY pgrst, 'reload schema';
COMMIT;
