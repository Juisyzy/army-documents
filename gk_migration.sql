-- Выполнить в Supabase SQL Editor до загрузки новой версии сайта.
-- Добавляет ГК РО как отдельный доступ, не меняя действующие faction/role пользователей.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gk_access boolean NOT NULL DEFAULT false;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (gk_access) ON public.profiles TO authenticated;

-- Расширяем только CHECK-ограничения faction у документов и счётчиков.
DO $$
DECLARE r record; tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['orders','order_counters','order_history','order_drafts'] LOOP
  IF to_regclass('public.'||tab) IS NOT NULL THEN
   FOR r IN
    SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    WHERE c.conrelid=to_regclass('public.'||tab) AND c.contype='c'
      AND pg_get_constraintdef(c.oid) ILIKE '%faction%'
      AND pg_get_constraintdef(c.oid) LIKE '%army%'
      AND pg_get_constraintdef(c.oid) LIKE '%commandant%'
   LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',tab,r.conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (faction IN (''army'',''commandant'',''gk''))',tab,r.conname);
   END LOOP;
  END IF;
 END LOOP;
END $$;

INSERT INTO public.order_counters(faction,next_number) VALUES ('gk',1) ON CONFLICT (faction) DO NOTHING;

-- Доступ к черновикам ГК: только автор, которому разрешена ГК.
CREATE POLICY gk_drafts_insert ON public.order_drafts FOR INSERT TO authenticated
WITH CHECK (
 faction='gk' AND user_id=(SELECT auth.uid())
 AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND (p.gk_access OR p.role='admin'))
);
CREATE POLICY gk_drafts_update ON public.order_drafts FOR UPDATE TO authenticated
USING (faction='gk' AND user_id=(SELECT auth.uid()))
WITH CHECK (
 faction='gk' AND user_id=(SELECT auth.uid())
 AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND (p.gk_access OR p.role='admin'))
);

-- Для ГК отдельное резервирование, чтобы не переписывать действующий reserve_order.
CREATE OR REPLACE FUNCTION public.reserve_gk_order(p_faction text,p_title text,p_document_date date)
RETURNS TABLE(id uuid,number integer,image_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE u public.profiles%ROWTYPE; n integer; oid uuid; path text;
BEGIN
 SELECT * INTO u FROM public.profiles WHERE profiles.id=(SELECT auth.uid());
 IF u.id IS NULL OR p_faction IS DISTINCT FROM 'gk'
    OR NOT (u.role='admin' OR u.gk_access) THEN
   RAISE EXCEPTION 'Нет доступа к ГК РО';
 END IF;
 IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 250 OR p_document_date IS NULL THEN
   RAISE EXCEPTION 'Неверные данные документа';
 END IF;
 UPDATE public.order_counters SET next_number=next_number+1
 WHERE faction='gk' RETURNING next_number-1 INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'Счётчик ГК РО не настроен'; END IF;
 oid:=gen_random_uuid();
 path:='gk/'||oid::text||'.png';
 INSERT INTO public.orders(id,faction,number,title,document_date,author_id,author_name,image_path)
 VALUES(oid,'gk',n,trim(p_title),p_document_date,u.id,u.username,path);
 RETURN QUERY SELECT oid,n,path;
END $$;
REVOKE ALL ON FUNCTION public.reserve_gk_order(text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_gk_order(text,text,date) TO authenticated;
COMMIT;

-- После миграции администратор включает галочку «Доступ к ГК РО» у нужных пользователей.
