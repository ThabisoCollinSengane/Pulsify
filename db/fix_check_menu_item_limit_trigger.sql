-- fix_check_menu_item_limit_trigger.sql
-- The trigger referenced businesses.user_id which doesn't exist (column is owner_id).
-- This caused every INSERT into menu_items to fail with "column user_id does not exist".

CREATE OR REPLACE FUNCTION public.check_menu_item_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  item_count INT;
  sub_type TEXT;
BEGIN
  SELECT subscription_type INTO sub_type
  FROM profiles
  WHERE id = (SELECT owner_id FROM businesses WHERE id = NEW.business_id LIMIT 1);

  IF sub_type IS NULL OR sub_type = 'free' THEN
    SELECT COUNT(*) INTO item_count
    FROM menu_items
    WHERE business_id = NEW.business_id;

    IF item_count >= 10 THEN
      RAISE EXCEPTION 'Free plan limit: 10 menu items. Upgrade to Premium for unlimited items.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
