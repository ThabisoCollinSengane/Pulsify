-- RLS attack + flow suite. Impersonates real accounts (anon / user / organizer / business)
-- and runs each test in a subtransaction that is ALWAYS rolled back; the whole block then
-- raises RESULTS:<json> so nothing it does is ever committed.
--   expect 'allow' → pass when the statement affects/returns ≥1 row
--   expect 'deny'  → pass when it errors or affects/returns 0 rows
--   'sql ;; check' → the check runs as the table owner afterwards (for rows the actor can't read back)
-- Run it with the Supabase SQL editor (or MCP execute_sql) and read the error message.
DO $do$
DECLARE
  u1  uuid := '28c4b174-9016-4adf-afd8-5f2058ac96f1';  -- plain user
  u2  uuid := '9be28c5e-b09c-403e-94e4-ca603b046efa';  -- plain user (victim)
  org uuid := '6bf325dd-656c-44af-9cfb-093b780ff572';  -- organizer (trusted submitter)
  org2 uuid := '3fdbaa30-40bb-424a-a276-bb748b4c3811'; -- organizer
  biz uuid;                                            -- business owner (owns a businesses row)
  s jsonb := '{}';
  adm uuid; sq uuid; ev_un text; mi record;
  t record; k text; q text; n int; err text; ok boolean; res jsonb := '[]'; fails int := 0; total int := 0;
BEGIN
  SELECT owner_id INTO biz FROM businesses b JOIN profiles p ON p.id = b.owner_id WHERE p.role = 'business' LIMIT 1;
  SELECT id INTO adm FROM profiles WHERE role = 'admin' LIMIT 1;
  -- Fixtures (created as postgres, rolled back with everything else): a private squad owned
  -- by u2, a booking on org's event, an unapproved event of org's.
  INSERT INTO squads(name, creator_id, is_public) VALUES ('RLS test squad', u2, false) RETURNING id INTO sq;
  INSERT INTO squad_members(squad_id, user_id, role) VALUES (sq, u2, 'admin');
  INSERT INTO squad_messages(squad_id, user_id, body) VALUES (sq, u2, 'members only');
  INSERT INTO squad_invites(squad_id, inviter_id, invitee_id, status) VALUES (sq, u2, org, 'pending');
  INSERT INTO bookings(booking_ref, event_id, user_id, buyer_name, buyer_email, status)
    SELECT 'RLS-TEST', id, u2, 'Test Buyer', 'buyer@test.invalid', 'confirmed' FROM events WHERE organiser_id = org LIMIT 1;
  INSERT INTO events(id, name, date_local, organiser_id, is_active, approved)
    VALUES ('rls-test-' || gen_random_uuid(), 'RLS pending event', '2030-01-01', org, true, false) RETURNING id INTO ev_un;
  INSERT INTO menu_items(business_id, name, price)
    SELECT id, 'RLS test item', 45 FROM businesses WHERE owner_id = biz LIMIT 1
    RETURNING id::text AS id, price INTO mi;
  s := jsonb_build_object(
    'u1', u1, 'u2', u2, 'org', org, 'org2', org2, 'biz', biz, 'adm', adm, 'sq', sq, 'ev_un', ev_un,
    'mi_id', mi.id, 'mi_price', mi.price,
    'biz_id',   (SELECT id::text FROM businesses WHERE owner_id = biz LIMIT 1),
    'post2',    (SELECT id::text FROM posts WHERE user_id <> u1 LIMIT 1),
    'cmt2',     (SELECT id::text FROM comments WHERE user_id <> u1 LIMIT 1),
    'ev_org',   (SELECT id FROM events WHERE organiser_id = org LIMIT 1),
    'promo_biz',(SELECT id::text FROM squad_promos WHERE owner_id = biz LIMIT 1),
    'deal_other',(SELECT id::text FROM deals WHERE business_id <> u1::text LIMIT 1)
  );

  FOR t IN SELECT * FROM (VALUES
    -- ── anonymous visitor ────────────────────────────────────────────
    ('A01 anon reads profile emails',            'anon','deny',  $q$select count(*) from profiles where email is not null$q$),
    ('A02 anon reads profile phones/dob',        'anon','deny',  $q$select count(*) from profiles where phone is not null or dob is not null$q$),
    ('A03 anon reads bank account numbers',      'anon','deny',  $q$select count(*) from profiles where paystack_account_number is not null$q$),
    ('A04 anon reads KYC doc urls',              'anon','deny',  $q$select count(*) from profiles where id_doc_url is not null or face_scan_url is not null$q$),
    ('A05 anon reads public profile basics',     'anon','allow', $q$select count(*) from profiles where display_name is not null$q$),
    ('A06 anon reads bookings',                  'anon','deny',  $q$select count(*) from bookings$q$),
    ('A07 anon reads notifications',             'anon','deny',  $q$select count(*) from notifications$q$),
    ('A08 anon reads squad messages',            'anon','deny',  $q$select count(*) from squad_messages$q$),
    ('A09 anon places a pickup order',           'anon','allow', $q$with x as (insert into pickup_orders(order_ref,business_id,customer_name,items,total,status) values ('T-'||gen_random_uuid(),'{biz_id}','Test','[]',10,'pending') returning 1) select count(*) from x$q$),
    ('A10 anon order pre-marked ready',          'anon','deny',  $q$with x as (insert into pickup_orders(order_ref,business_id,customer_name,items,total,status) values ('RLS-A10','{biz_id}','Test','[]',10,'ready') returning 1) select count(*) from x ;; select count(*) from pickup_orders where order_ref='RLS-A10' and status='ready'$q$),
    ('A11 anon reads events feed',               'anon','allow', $q$select count(*) from events where is_active$q$),
    ('A12 anon can TRUNCATE-able tables',        'anon','deny',  $q$select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon' and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')$q$),
    -- ── plain user: privilege escalation ─────────────────────────────
    ('U01 user makes self admin',                'u1','deny',    $q$with x as (update profiles set role='admin' where id='{u1}' returning 1) select count(*) from x$q$),
    ('U02 user self-verifies',                   'u1','deny',    $q$with x as (update profiles set is_verified=true, verif_status='approved' where id='{u1}' returning 1) select count(*) from x$q$),
    ('U03 user grants self premium',             'u1','deny',    $q$with x as (update profiles set subscription_type='premium' where id='{u1}' returning 1) select count(*) from x$q$),
    ('U04 user can TRUNCATE tables',             'u1','deny',    $q$select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')$q$),
    ('U05 user edits own bio',                   'u1','allow',   $q$with x as (update profiles set bio=coalesce(bio,'')||'' where id='{u1}' returning 1) select count(*) from x$q$),
    ('U06 user edits someone else''s profile',   'u1','deny',    $q$with x as (update profiles set bio='hacked' where id='{u2}' returning 1) select count(*) from x$q$),
    ('U07 user reads other users'' emails',      'u1','deny',    $q$select count(*) from profiles where id<>'{u1}' and email is not null$q$),
    ('U08 user becomes organizer at signup',     'u1','allow',   $q$with x as (update profiles set role='organizer' where id='{u1}' returning 1) select count(*) from x$q$),
    ('U09 own full profile via my_profile()',    'u1','allow',   $q$select count(*) from my_profile()$q$),
    -- ── social flows: follow / like / comment / repost / save ────────
    ('F01 follow someone',                       'u1','allow',   $q$with x as (insert into follows(follower_id,following_id) values ('{u1}','{org}') on conflict do nothing returning 1) select count(*)+(select count(*) from follows where follower_id='{u1}' and following_id='{org}') from x$q$),
    ('F02 follow on behalf of someone else',     'u1','deny',    $q$with x as (insert into follows(follower_id,following_id) values ('{u2}','{u1}') returning 1) select count(*) from x$q$),
    ('F03 unfollow on behalf of someone else',   'u1','deny',    $q$with x as (delete from follows where follower_id='{u2}' returning 1) select count(*) from x$q$),
    ('F04 like a post',                          'u1','allow',   $q$with x as (insert into reactions(user_id,entity_type,entity_id,type) values ('{u1}','post','{post2}','like') on conflict do nothing returning 1) select count(*)+(select count(*) from reactions where user_id='{u1}' and entity_id='{post2}') from x$q$),
    ('F05 like as someone else',                 'u1','deny',    $q$with x as (insert into reactions(user_id,entity_type,entity_id,type) values ('{u2}','post','{post2}','like') returning 1) select count(*) from x$q$),
    ('F06 set someone''s post like_count',       'u1','deny',    $q$with x as (update posts set like_count=9999 where id='{post2}' returning 1) select count(*) from x$q$),
    ('F07 comment on a post',                    'u1','allow',   $q$with x as (insert into comments(user_id,entity_type,entity_id,body) values ('{u1}','post','{post2}','nice') returning 1) select count(*) from x$q$),
    ('F08 comment as someone else',              'u1','deny',    $q$with x as (insert into comments(user_id,entity_type,entity_id,body) values ('{u2}','post','{post2}','spoof') returning 1) select count(*) from x$q$),
    ('F09 delete someone else''s comment',       'u1','deny',    $q$with x as (delete from comments where id='{cmt2}' returning 1) select count(*) from x$q$),
    ('F10 edit someone else''s comment',         'u1','deny',    $q$with x as (update comments set body='edited' where id='{cmt2}' returning 1) select count(*) from x$q$),
    ('F11 repost a post',                        'u1','allow',   $q$with x as (insert into reposts(user_id,post_id) values ('{u1}','{post2}') returning 1) select count(*) from x$q$),
    ('F12 repost as someone else',               'u1','deny',    $q$with x as (insert into reposts(user_id,post_id) values ('{u2}','{post2}') returning 1) select count(*) from x$q$),
    ('F13 post_reposts as self',                 'u1','allow',   $q$with x as (insert into post_reposts(user_id,post_id) values ('{u1}','{post2}') on conflict do nothing returning 1) select count(*)+(select count(*) from post_reposts where user_id='{u1}' and post_id='{post2}') from x$q$),
    ('F14 delete someone else''s repost',        'u1','deny',    $q$with x as (delete from reposts where user_id<>'{u1}' returning 1) select count(*) from x$q$),
    ('F15 save an event',                        'u1','allow',   $q$with x as (insert into saved_items(user_id,entity_type,entity_id) values ('{u1}','event','{ev_org}') on conflict do nothing returning 1) select count(*)+(select count(*) from saved_items where user_id='{u1}' and entity_id='{ev_org}') from x$q$),
    ('F16 read someone else''s saved items',     'u1','deny',    $q$select count(*) from saved_items where user_id<>'{u1}'$q$),
    ('F17 edit someone else''s post',            'u1','deny',    $q$with x as (update posts set caption='hacked' where id='{post2}' returning 1) select count(*) from x$q$),
    ('F18 post as someone else',                 'u1','deny',    $q$with x as (insert into posts(user_id,caption) values ('{u2}','spoof') returning 1) select count(*) from x$q$),
    -- ── notifications ────────────────────────────────────────────────
    ('N01 notify a user (as self)',              'u1','allow',   $q$with x as (insert into notifications(user_id,type,from_user_id,message) values ('{u2}','follow','{u1}','followed you') returning 1) select count(*) from x$q$),
    ('N02 notify a user spoofing the sender',    'u1','deny',    $q$with x as (insert into notifications(user_id,type,from_user_id,message) values ('{u2}','follow','{org}','spoofed') returning 1) select count(*) from x$q$),
    ('N03 anonymous-sender notification to other','u1','deny',   $q$with x as (insert into notifications(user_id,type,message) values ('{u2}','system','Your account is locked, click here') returning 1) select count(*) from x$q$),
    ('N04 read someone else''s notifications',   'u1','deny',    $q$select count(*) from notifications where user_id<>'{u1}'$q$),
    ('N05 mark own notifications read',          'u2','allow',   $q$with x as (update notifications set read=true where user_id='{u2}' returning 1) select count(*) from x$q$),
    ('N06 spoofed display name is replaced',     'u1','deny',    $q$with x as (insert into notifications(user_id,type,from_user_id,from_display_name,message) values ('{u2}','follow','{u1}','Pulsify Support','hi') returning 1) select count(*) from x ;; select count(*) from notifications where from_user_id='{u1}' and from_display_name='Pulsify Support'$q$),
    -- ── squads ───────────────────────────────────────────────────────
    ('S01 join a private squad uninvited',       'u1','deny',    $q$with x as (insert into squad_members(squad_id,user_id) values ('{sq}','{u1}') returning 1) select count(*) from x$q$),
    ('S02 read a private squad''s messages',     'u1','deny',    $q$select count(*) from squad_messages where squad_id='{sq}'$q$),
    ('S03 post in a squad you''re not in',       'u1','deny',    $q$with x as (insert into squad_messages(squad_id,user_id,body) values ('{sq}','{u1}','hi') returning 1) select count(*) from x$q$),
    ('S04 invite people to a squad you''re not in','u1','deny',  $q$with x as (insert into squad_invites(squad_id,inviter_id,invitee_id) values ('{sq}','{u1}','{u2}') returning 1) select count(*) from x$q$),
    ('S06 member reads own squad messages',      'u2','allow',   $q$select count(*) from squad_messages where squad_id='{sq}'$q$),
    ('S07 member posts in own squad',            'u2','allow',   $q$with x as (insert into squad_messages(squad_id,user_id,body) values ('{sq}','{u2}','hey') returning 1) select count(*) from x$q$),
    ('S08 member invites a friend',              'u2','allow',   $q$with x as (insert into squad_invites(squad_id,inviter_id,invitee_id) values ('{sq}','{u2}','{u1}') returning 1) select count(*) from x$q$),
    ('S09 invited person joins the squad',      'org','allow',  $q$with x as (insert into squad_members(squad_id,user_id) values ('{sq}','{org}') returning 1) select count(*) from x$q$),
    ('S05 accept someone else''s invite',        'u1','deny',    $q$with x as (update squad_invites set status='accepted' where invitee_id<>'{u1}' returning 1) select count(*) from x$q$),
    -- ── events, tickets, money ───────────────────────────────────────
    ('E01 user creates pre-approved event',      'u1','deny',    $q$with x as (insert into events(id,name,date_local,organiser_id,is_active,approved) values ('t-'||gen_random_uuid(),'Spam','2030-01-01','{u1}',true,true) returning approved) select count(*) from x where approved$q$),
    ('E02 organizer self-approves own event',    'org','deny',   $q$with x as (update events set approved=true where organiser_id='{org}' and approved is not true returning 1) select count(*) from x$q$),
    ('E03 edit someone else''s event',           'u1','deny',    $q$with x as (update events set name='hacked' where id='{ev_org}' returning 1) select count(*) from x$q$),
    ('E04 add ticket tier to someone''s event',  'u1','deny',    $q$with x as (insert into ticket_tiers(event_id,name,price,sort_order) values ('{ev_org}','Free',0,0) returning 1) select count(*) from x$q$),
    ('E16 organizer approves own pending event', 'org','deny',   $q$with x as (update events set approved=true where id='{ev_un}' returning 1) select count(*) from x$q$),
    ('E17 organizer lowers own commission',      'org','deny',   $q$with x as (update events set commission_rate=0 where id='{ev_org}' returning 1) select count(*) from x$q$),
    ('E18 user self-escalates to organizer→admin','org','deny',  $q$with x as (update profiles set role='admin' where id='{org}' returning 1) select count(*) from x$q$),
    ('E19 organizer creates event (pending)',    'org','allow',  $q$with x as (insert into events(id,name,date_local,organiser_id,is_active,approved) values ('rls-e19','New','2030-01-01','{org}',true,true) returning 1) select count(*) from x ;; select count(*) from events where id='rls-e19' and approved = false$q$),
    ('E05 organizer edits own event',            'org','allow',  $q$with x as (update events set description=coalesce(description,'') where id='{ev_org}' returning 1) select count(*) from x$q$),
    ('E06 organizer adds own ticket tier',       'org','allow',  $q$with x as (insert into ticket_tiers(event_id,name,price,sort_order) values ('{ev_org}','Test',100,9) returning 1) select count(*) from x$q$),
    ('E07 organizer sees own event bookings',    'org','allow',  $q$select count(*) from bookings where event_id in (select id from events where organiser_id='{org}')$q$),
    ('E08 organizer sees other events'' bookings','org','deny',  $q$select count(*) from bookings where event_id not in (select id from events where organiser_id='{org}')$q$),
    ('E09 user reads other people''s bookings',  'u1','deny',    $q$select count(*) from bookings where user_id is distinct from '{u1}'$q$),
    ('E10 user forges a confirmed booking',      'u1','deny',    $q$with x as (insert into bookings(booking_ref,event_id,user_id,buyer_name,buyer_email,status) values ('X','{ev_org}','{u1}','x','x@x','confirmed') returning 1) select count(*) from x$q$),
    ('E11 organizer reads own Lumi orders',      'org','allow',  $q$select count(*)+1 from siza_orders where event_id in (select id from events where organiser_id='{org}')$q$),
    ('E12 user reads Lumi orders',               'u1','deny',    $q$select count(*) from siza_orders$q$),
    ('E13 user reads payments',                  'u1','deny',    $q$select count(*) from payments where user_id is distinct from '{u1}'$q$),
    ('E14 user creates a promotion (paid boost)','u1','deny',    $q$with x as (insert into promotions(title,owner_id,is_active) values ('Boost','{u1}',true) returning 1) select count(*) from x$q$),
    ('E15 organizer activates own promotion free','org2','deny', $q$with x as (insert into promotions(title,owner_id,owner_role,is_active) values ('RLS-E15','{org2}','organizer',true) returning 1) select count(*) from x ;; select count(*) from promotions where title='RLS-E15' and is_active$q$),
    -- ── business ─────────────────────────────────────────────────────
    ('B01 business sees own pickup orders',      'biz','allow',  $q$select count(*)+1 from pickup_orders where business_id='{biz_id}'$q$),
    ('B02 user reads pickup orders',             'u1','deny',    $q$select count(*) from pickup_orders$q$),
    ('B03 user changes an order''s status',      'u1','deny',    $q$with x as (update pickup_orders set status='cancelled' returning 1) select count(*) from x$q$),
    ('B04 business self-approves squad promo',   'biz','deny',   $q$with x as (update squad_promos set approved=true where id='{promo_biz}' and approved is not true returning 1) select count(*) from x$q$),
    ('B05 business inserts pre-approved promo',  'biz','deny',   $q$with x as (insert into squad_promos(title,venue_name,owner_id,approved,is_active) values ('X','Y','{biz}',true,true) returning approved) select count(*) from x where approved$q$),
    ('B06 business creates a deal',              'biz','allow',  $q$with x as (insert into deals(business_id,title) values ('{biz}','Test deal') returning 1) select count(*) from x$q$),
    ('B07 delete someone else''s deal',          'u1','deny',    $q$with x as (delete from deals where id='{deal_other}' returning 1) select count(*) from x$q$),
    ('B08 plain user publishes a deal',          'u1','deny',    $q$with x as (insert into deals(business_id,title,is_active) values ('{u1}','Fake deal',true) returning 1) select count(*) from x$q$),
    ('B10 order total re-priced from menu',      'anon','allow', $q$with x as (insert into pickup_orders(order_ref,business_id,customer_name,items,total) values ('RLS-B10','{biz_id}','Test',jsonb_build_array(jsonb_build_object('id','{mi_id}','qty',2)),1) returning 1) select count(*) from x ;; select count(*) from pickup_orders where order_ref='RLS-B10' and total = 2*{mi_price}$q$),
    ('B11 signed-in order linked to customer',   'u1','allow',   $q$with x as (insert into pickup_orders(order_ref,business_id,customer_name,items,total) values ('RLS-B11','{biz_id}','Test','[]',0) returning 1) select count(*) from x ;; select count(*) from pickup_orders where order_ref='RLS-B11' and user_id='{u1}'$q$),
    ('B12 business deletes own deal',            'biz','allow',  $q$with d as (insert into deals(business_id,title) values ('{biz}','tmp') returning id), x as (delete from deals where id in (select id from d) returning 1) select count(*) from d$q$),
    ('B13 admin edits a business listing',       'adm','allow',  $q$with x as (update businesses set frontline_rank=frontline_rank where id::text='{biz_id}' returning 1) select count(*) from x$q$),
    ('B09 user edits a business listing',        'u1','deny',    $q$with x as (update businesses set name='hacked' where id::text='{biz_id}' returning 1) select count(*) from x$q$),
    -- ── reports / misc ───────────────────────────────────────────────
    ('R01 report an event as self',              'u1','allow',   $q$with x as (insert into event_reports(event_id,reporter_id,reason) values ('{ev_org}','{u1}','other') returning 1) select count(*) from x$q$),
    ('R02 report an event as someone else',      'u1','deny',    $q$with x as (insert into event_reports(event_id,reporter_id,reason) values ('{ev_org}','{u2}','other') returning 1) select count(*) from x$q$),
    ('R03 location request as someone else',     'u1','deny',    $q$with x as (insert into location_requests(entity_type,entity_id,user_id,lat,lon) values ('business','{biz_id}','{u2}',-29.8,31.0) returning 1) select count(*) from x$q$),
    ('R04 read admin activity log',              'u1','deny',    $q$select count(*) from admin_activity_log$q$),
    ('R05 read scraped leads',                   'u1','deny',    $q$select count(*) from scraped_leads$q$),
    ('R06 read KYC documents',                   'u1','deny',    $q$select count(*) from kyc_documents where user_id<>'{u1}'$q$),
    ('R07 anyone deletes files in uploads bucket','anon','deny', $q$select count(*) from pg_policies where schemaname='storage' and cmd='DELETE' and qual not like '%auth.uid()%'$q$)
  ) v(name, who, expect, sql) LOOP
    q := t.sql;
    FOR k IN SELECT jsonb_object_keys(s) LOOP
      q := replace(q, '{' || k || '}', coalesce(s ->> k, '00000000-0000-0000-0000-000000000000'));
    END LOOP;
    n := NULL; err := NULL; total := total + 1;
    BEGIN
      PERFORM set_config('request.jwt.claims',
        CASE WHEN t.who = 'anon' THEN '{"role":"anon"}'
             ELSE json_build_object('sub', s ->> t.who, 'role', 'authenticated')::text END, true);
      PERFORM set_config('request.jwt.claim.sub', CASE WHEN t.who = 'anon' THEN '' ELSE s ->> t.who END, true);
      PERFORM set_config('request.jwt.claim.role', CASE WHEN t.who = 'anon' THEN 'anon' ELSE 'authenticated' END, true);
      EXECUTE 'SET LOCAL ROLE ' || CASE WHEN t.who = 'anon' THEN 'anon' ELSE 'authenticated' END;
      EXECUTE split_part(q, ';;', 1) INTO n;
      IF position(';;' IN q) > 0 THEN
        EXECUTE 'RESET ROLE';
        EXECUTE split_part(q, ';;', 2) INTO n;
      END IF;
      RAISE EXCEPTION 'ROLLBACK_OK';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'ROLLBACK_OK' THEN err := SQLERRM; n := NULL; END IF;
    END;
    ok := CASE WHEN t.expect = 'allow' THEN coalesce(n, 0) > 0 ELSE coalesce(n, 0) = 0 END;
    IF NOT ok THEN
      fails := fails + 1;
      res := res || jsonb_build_object('t', t.name, 'n', n, 'err', left(err, 160));
    END IF;
  END LOOP;
  RAISE EXCEPTION 'RESULTS %/% failed %', fails, total, res;
END
$do$;
