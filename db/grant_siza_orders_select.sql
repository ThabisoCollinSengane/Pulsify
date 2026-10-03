-- Organizer dashboard (🤖 Orders tab) reads Lumi orders with the user's own session.
-- RLS policy siza_orders_organizer_read already limits rows to the organizer's own
-- events; without this table-level grant Postgres refuses ("permission denied for
-- table siza_orders") before RLS is evaluated.
GRANT SELECT ON public.siza_orders TO authenticated;
