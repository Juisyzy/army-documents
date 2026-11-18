-- Дополнение к предыдущей миграции ГК РО. Выполнить один раз в Supabase SQL Editor.
-- Регистрация в ГК РО не выдаёт права на публикацию автоматически.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS requested_gk boolean NOT NULL DEFAULT false;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%faction%' AND pg_get_constraintdef(oid) LIKE '%army%' LOOP
  EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I',r.conname);
  EXECUTE format('ALTER TABLE public.profiles ADD CONSTRAINT %I CHECK (faction IN (''army'',''commandant'',''gk''))',r.conname);
 END LOOP;
END $$;
-- Обрабатываем выбор ГК в метаданных регистрации до вставки профиля.
-- Действующий триггер create_profile() остаётся без изменений.
CREATE OR REPLACE FUNCTION public.mark_gk_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE requested text;
BEGIN
  SELECT raw_user_meta_data->>'requested_faction' INTO requested
  FROM auth.users WHERE id = NEW.id;
  IF requested = 'gk' THEN
    NEW.requested_gk := true;
    NEW.faction := 'gk';
    -- Право gk_access по умолчанию false, выдаёт только администратор.
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mark_gk_registration_on_profile ON public.profiles;
CREATE TRIGGER mark_gk_registration_on_profile BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.mark_gk_registration();
COMMIT;
