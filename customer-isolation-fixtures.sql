-- Two throwaway households, so the isolation test has something to test.
--
-- customer-isolation-test.sql proves that one client cannot reach another
-- client records. To do that it needs two households that each already have a
-- dog, a package, a stay and a visit - and a database for a daycare that has
-- not opened yet has none of those, so the test stops with:
--
--   Need two unclaimed households that each have a dog, a package, a stay and
--   a visit. This database does not have them.
--
-- That is the test refusing to pass vacuously rather than a fault. An
-- isolation test against empty tables proves nothing: every probe would come
-- back with no rows whether the policies worked or not.
--
-- So this file creates the two households the test needs. They are obviously
-- fake - the 555 numbers cannot dial anybody and the names say what they are -
-- and every row is tagged so they can all be removed in one go afterwards.
--
-- WHEN TO RUN: after rls-lockdown.sql, immediately before
-- customer-isolation-test.sql. Safe to run more than once.
--
-- AFTERWARDS: remove them. The statement is in docs/NEW-DATABASE.md, and it
-- keys on the same tag this file writes.
--
-- Not needed on a database that already has real clients in it. Two genuine
-- households will satisfy the test on their own.
--
-- No apostrophe or quote character appears in any comment here, for the
-- Supabase SQL editor reason noted in the other migrations.

do $fixtures$
declare
  tag text := 'isolation-check-household';
  i int;
  ph text;
  o_id uuid;
  d_id uuid;
begin
  if to_regclass('public.owners') is null then
    raise exception 'No owners table. Run the migrations in docs/NEW-DATABASE.md first.';
  end if;

  for i in 1 .. 2 loop
    ph := '55501' || lpad(i::text, 2, '0');

    -- Unclaimed on purpose. The test binds each household to a fixture auth
    -- account itself and puts it back afterwards, and it skips any household
    -- that a real client has already claimed.
    insert into public.owners (phone, owner_name, email, notes)
    values (
      ph,
      'Isolation Check ' || i,
      'isolation-check-' || i || '@example.invalid',
      tag
    )
    on conflict (phone) do nothing;

    select o.id into o_id from public.owners o where o.phone = ph;

    select d.id into d_id
    from public.dogs d
    where d.owner_id = o_id and d.notes = tag
    order by d.id
    limit 1;

    if d_id is null then
      insert into public.dogs (phone, dog_name, last_name, breed, owner_id, notes)
      values (ph, 'Checkdog' || i, 'Isolation', 'Test Breed', o_id, tag)
      returning id into d_id;
    end if;

    if not exists (
      select 1 from public.packages p where p.owner_id = o_id and p.client_name = tag
    ) then
      insert into public.packages
        (client_name, dog_name, phone, total_days, days_used, kind, price, owner_id)
      values (tag, 'Checkdog' || i, ph, 10, 2, 'daycare', 600, o_id);
    end if;

    if not exists (
      select 1 from public.boardings b where b.owner_id = o_id and b.notes = tag
    ) then
      insert into public.boardings
        (dog_name, last_name, phone, dog_id, start_date, end_date, notes, owner_id)
      values (
        'Checkdog' || i, 'Isolation', ph, d_id,
        current_date, current_date + 2, tag, o_id
      );
    end if;

    if not exists (
      select 1 from public.signins s where s.owner_id = o_id and s.staff_note = tag
    ) then
      insert into public.signins
        (dog_name, last_name, phone, dog_id, action, service_type, price, staff_note, owner_id)
      values (
        'Checkdog' || i, 'Isolation', ph, d_id,
        'drop_off', 'daycare', 45, tag, o_id
      );
    end if;

    -- The test reaches for a vaccination record on household B. Without one
    -- that probe has nothing to aim at.
    if not exists (
      select 1 from public.vaccinations v where v.dog_id = d_id
    ) then
      insert into public.vaccinations (dog_id, vaccine, given_on, expires_on)
      values (d_id, 'rabies', current_date - 30, current_date + 335);
    end if;
  end loop;

  raise notice 'Two check households are in place. Run customer-isolation-test.sql now, then remove them with the statement in docs/NEW-DATABASE.md.';
end
$fixtures$;
