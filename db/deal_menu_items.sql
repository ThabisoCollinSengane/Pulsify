-- Links squad deals to specific menu items so users can see what's included.
ALTER TABLE public.squad_promos ADD COLUMN IF NOT EXISTS linked_menu_item_ids UUID[] DEFAULT '{}';
