-- Выполнить один раз в Supabase SQL Editor. Не меняет пароли, аккаунты или RLS.
-- Заполняет имя автора для существующих приказов.
UPDATE public.orders AS o
SET author_name = trim(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')))
FROM public.profiles AS p
WHERE o.author_id = p.id
  AND nullif(btrim(p.first_name), '') IS NOT NULL
  AND nullif(btrim(p.last_name), '') IS NOT NULL
  AND o.author_name IS DISTINCT FROM trim(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')));

-- Для новых приказов, созданных RPC, имя записывается сразу при вставке.
CREATE OR REPLACE FUNCTION public.set_order_author_display_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_name text;
BEGIN
  SELECT trim(concat_ws(' ', nullif(btrim(first_name), ''), nullif(btrim(last_name), '')))
    INTO v_name FROM public.profiles WHERE id = NEW.author_id;
  IF nullif(v_name, '') IS NOT NULL THEN NEW.author_name := v_name; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS set_order_author_display_name_before_insert ON public.orders;
CREATE TRIGGER set_order_author_display_name_before_insert
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.set_order_author_display_name();
