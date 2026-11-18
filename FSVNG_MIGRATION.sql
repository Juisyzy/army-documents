-- ФСВНГ: выполнить в Supabase SQL Editor один раз, до публикации сайта.
-- Не удаляет пользователей, приказы и черновики.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS fsvng_access boolean NOT NULL DEFAULT false;

-- Добавляем значение fsvng в CHECK ограничения, сохраняя остальные существующие значения.
DO $$
DECLARE t text; r record; def text;
BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','orders','order_counters','order_drafts','order_history'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
  FOR r IN SELECT conname,pg_get_constraintdef(oid) AS definition
           FROM pg_constraint WHERE conrelid=to_regclass('public.'||t) AND contype='c'
           AND pg_get_constraintdef(oid) ~* 'faction.*(army|commandant)' LOOP
    def := replace(r.definition, '''gk''', '''gk'',''fsvng''');
    IF def = r.definition THEN
      def := replace(def, '''commandant''', '''commandant'',''fsvng''');
    END IF;
    IF def <> r.definition THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I',t,r.conname);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s',t,r.conname,def);
    END IF;
  END LOOP;
 END LOOP;
END $$;

-- Сохраняем действующий create_profile и добавляем обработчик регистрации ФСВНГ.
-- Клиент передаёт временный faction=army для совместимости со старым триггером,
-- а этот BEFORE INSERT триггер назначает выбранную ФСВНГ и право доступа.
CREATE OR REPLACE FUNCTION public.mark_fsvng_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE requested text;
BEGIN
 SELECT raw_user_meta_data->>'requested_faction' INTO requested
 FROM auth.users WHERE id=NEW.id;
 IF requested='fsvng' THEN
   NEW.faction:='fsvng';
   NEW.fsvng_access:=true;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mark_fsvng_registration_on_profile ON public.profiles;
CREATE TRIGGER mark_fsvng_registration_on_profile
BEFORE INSERT ON public.profiles FOR EACH ROW
EXECUTE FUNCTION public.mark_fsvng_registration();

INSERT INTO public.order_counters(faction,next_number)
VALUES ('fsvng',1) ON CONFLICT(faction) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reserve_fsvng_order(p_faction text,p_title text,p_document_date date)
RETURNS TABLE(id uuid,number integer,image_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u public.profiles%ROWTYPE; n integer; oid uuid; path text;
BEGIN
 SELECT * INTO u FROM public.profiles WHERE profiles.id=(SELECT auth.uid());
 IF u.id IS NULL OR p_faction IS DISTINCT FROM 'fsvng'
   OR NOT (u.role='admin' OR u.fsvng_access OR u.faction='fsvng') THEN
   RAISE EXCEPTION 'Нет доступа к ФСВНГ';
 END IF;
 IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 250 OR p_document_date IS NULL THEN
   RAISE EXCEPTION 'Неверные данные документа';
 END IF;
 UPDATE public.order_counters SET next_number=next_number+1
 WHERE faction='fsvng' RETURNING next_number-1 INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'Не настроен счётчик ФСВНГ'; END IF;
 oid:=gen_random_uuid(); path:='fsvng/'||oid::text||'.png';
 INSERT INTO public.orders(id,faction,number,title,document_date,author_id,author_name,image_path)
 VALUES(oid,'fsvng',n,trim(p_title),p_document_date,u.id,u.username,path);
 RETURN QUERY SELECT oid,n,path;
END $$;
REVOKE ALL ON FUNCTION public.reserve_fsvng_order(text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reserve_fsvng_order(text,text,date) TO authenticated;

-- Для черновиков действующая политика drafts_insert_own уже допускает faction профиля.
-- Для дополнительного доступа ФСВНГ добавляем отдельную ограниченную политику.
DO $$ BEGIN
 IF to_regclass('public.order_drafts') IS NOT NULL THEN
  EXECUTE 'DROP POLICY IF EXISTS fsvng_drafts_insert ON public.order_drafts';
  EXECUTE 'CREATE POLICY fsvng_drafts_insert ON public.order_drafts FOR INSERT TO authenticated WITH CHECK (faction=''fsvng'' AND user_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND (p.fsvng_access OR p.role=''admin'')))';
  EXECUTE 'DROP POLICY IF EXISTS fsvng_drafts_update ON public.order_drafts';
  EXECUTE 'CREATE POLICY fsvng_drafts_update ON public.order_drafts FOR UPDATE TO authenticated USING (faction=''fsvng'' AND user_id=(SELECT auth.uid())) WITH CHECK (faction=''fsvng'' AND user_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND (p.fsvng_access OR p.role=''admin'')))';
 END IF;
END $$;
COMMIT;
