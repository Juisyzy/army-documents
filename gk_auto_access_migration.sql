-- Автоматическая выдача доступа к ГК РО при регистрации в подразделении ГК РО.
-- Запустить в Supabase SQL Editor после gk_migration.sql и gk_registration_migration.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.mark_gk_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE requested text;
BEGIN
  SELECT raw_user_meta_data->>'requested_faction' INTO requested
  FROM auth.users WHERE id = NEW.id;
  IF requested = 'gk' THEN
    NEW.requested_gk := true;
    NEW.faction := 'gk';
    NEW.gk_access := true;
  END IF;
  RETURN NEW;
END $$;
-- Выдаём доступ уже зарегистрированным пользователям ГК РО.
-- Обновление только флага доступа, без изменения ролей и подразделений.
UPDATE public.profiles SET gk_access = true
WHERE faction = 'gk' AND gk_access IS DISTINCT FROM true;
COMMIT;
