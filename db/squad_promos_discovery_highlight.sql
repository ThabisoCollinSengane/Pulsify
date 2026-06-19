-- Squad deals → Discovery feed integration
-- (see pulsefy_squads_discovery_integration master plan)
--
-- Squad deals live in `squad_promos` (NOT the unrelated `promotions` ad table that
-- the original brief referenced). The discovery-highlight flag therefore lives here.
-- An admin toggles `highlight_in_discovery` on an already-approved deal to surface it
-- in the public Discover feed ("Squad Deals" section). Default false keeps primary
-- discovery clean — deals only appear once an admin explicitly features them.

ALTER TABLE public.squad_promos
  ADD COLUMN IF NOT EXISTS highlight_in_discovery BOOLEAN DEFAULT false;
