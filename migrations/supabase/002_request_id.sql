-- Additive migration: historical rows keep NULL request IDs.
ALTER TABLE public.my_keepalive_logs ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS my_keepalive_request_id
  ON public.my_keepalive_logs (request_id);
NOTIFY pgrst, 'reload schema';
