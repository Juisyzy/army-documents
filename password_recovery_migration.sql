-- Запустить в Supabase SQL Editor. Таблица доступна только серверной функции.
CREATE TABLE IF NOT EXISTS public.password_recovery_requests (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  code_hash text,
  expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  fulfilled_at timestamptz
);
ALTER TABLE public.password_recovery_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_recovery_requests FROM PUBLIC, anon, authenticated;
