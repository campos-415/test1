-- Row Level Security lockdown, per role and per table.
--
-- The first version of this file closed the real hole: the anon key ships
-- inside the JavaScript of the public website, so before it, every dog,
-- owner, payment and phone number was readable by anyone who opened dev
-- tools. That part has not changed and is still the most important thing
-- here.
--
-- What it did not do was distinguish between the people who sign in. One
-- policy said any authenticated account may do anything to any table, so
-- the front desk, the lobby iPad and the owner had identical power. This
-- version replaces that single policy with a matrix: five roles, and per
-- table per command, which of them the database will accept.
--
-- The fifth is the client. Staff roles answer WHAT an account may do and the
-- answer is the same for every row; the client role also has to answer WHICH
-- ROWS, and the answer is one household. That is why the customer half of
-- the matrix holds owner_id rather than a capability: isolation is a foreign
-- key comparison, not a permission level.
--
-- It is deliberately NOT built on the phone number. See the long note at the
-- top of customer-accounts-migration.sql: the phone column is a string whose
-- format varies, the app already strips non-digits before comparing it, and
-- a policy resting on it fails closed at best and collides two households at
-- worst. owner_id is a real key and this file compares nothing else.
--
-- The anon key can still do exactly four things, all of which the public
-- pages genuinely need:
--
--   read  settings        (prices and branding, shown on the website)
--   read  site_photos     (the website images, when that table exists)
--   write enrollments     (somebody submitting the enrollment form)
--   write boarding_requests (somebody requesting dates)
--
-- RUN ORDER. This is the LAST of five files and the only one that can lock
-- somebody out, because it is the one that stops trusting authenticated:
--
--   1. security-roles-migration.sql   creates the roles and assigns them
--   2. security-audit-migration.sql
--   3. security-exports-migration.sql
--   4. customer-accounts-migration.sql  owner_id, and who a client is
--   5. rls-lockdown.sql               this file
--
-- Running this before step 1 locks every account out of every table, since
-- there would be no roles for the policies to find. The block refuses to
-- start if the roles table is missing or has no owner_admin in it, and
-- likewise if step 4 has not run, since the customer half of the matrix
-- references a column and a function that would not exist yet.
--
-- The whole rewrite is one DO block, which is one statement, which is one
-- transaction: the old policies and the new ones are swapped atomically.
-- There is no instant at which a table has had its old policy dropped and
-- not yet got its new one, and if any part fails the database is left
-- exactly as it was.
--
-- Reverse with security-rollback.sql.
--
-- Tables that do not exist are skipped rather than fatal. The first version
-- named every table directly, so a database that had not run one of the
-- optional migrations failed on the first missing name and rolled the whole
-- thing back - leaving the database wide open while appearing to have been
-- secured. Optional tables really are optional: site_photos and reviews
-- only exist once their migrations are run.
--
-- Safe to run more than once.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

do $lockdown$
declare
  -- ---------------------------------------------------------------
  -- The matrix. One row per table, staff on the left and the client on
  -- the right:
  --
  --   table name, select, insert, update, delete,
  --               client select, client insert, client update, client delete
  --
  -- Staff cells are a capability - who may do this at all:
  --
  --   OA   owner or admin, MFA satisfied
  --   M    manager or above, MFA satisfied
  --   E    employee or above
  --   EK   employee or above, or the lobby kiosk
  --   ANY  any account with a role at all
  --   -    nobody through the API
  --
  -- Client cells are a row test - which rows, if any:
  --
  --   OWN  rows whose owner_id is the household this account claimed
  --   PUB  any signed-in account at all, claimed or not. Only for the three
  --        tables a signed-out visitor can already read through the anon
  --        policies below, so this grants nothing new - it repairs
  --        something. Note it is NOT is_customer: an account that has signed
  --        up and not yet claimed its household must still be able to read
  --        settings, because SettingsProvider fetches them in the browser
  --        with the session attached, and without them the business name,
  --        the accent colour and the phone number fall back to the shipped
  --        defaults. The screen that would break is the claim page, which is
  --        the first thing a new client ever sees. Anything stricter here
  --        than the anon policy means a signed-in person clearing a higher
  --        bar than a stranger, which is backwards
  --   V    nothing directly. The client reads this table through the
  --        matching my_* view in customer-accounts-migration.sql, which
  --        names its columns
  --   F    nothing directly. The client writes this table through the
  --        named function in the same file, which names its columns
  --   -    nothing
  --
  -- Why V exists, because it is the one thing here that is not obvious.
  -- A policy can say which ROWS. It cannot say which COLUMNS, and half
  -- these tables carry a field staff write for each other: signins has
  -- staff_note and meet_greet_note, dogs and owners and boardings each have
  -- notes, payments has note. A select policy on signins would therefore let
  -- a client ask the REST API for select=* and read every handover note ever
  -- written about their dog. Not selecting the column in the app is not a
  -- control - the app is theirs, the API is public, and the token is in
  -- their browser.
  --
  -- So a client never selects from a base table. Each read goes through a
  -- view that lists its columns, the view filters on the same
  -- customer_owner_id these cells use, and the base table refuses them. V
  -- means exactly that, and it is written here rather than only in the other
  -- file so that this matrix is still the whole answer.
  --
  -- Read it as the answer to why each cell is what it is:
  --
  --   Money is manager work. Selling a package, editing a payment and
  --   every bulk export sit at M or above. An employee and the kiosk can
  --   still SEE a balance and take a payment at pick-up, because telling a
  --   client what they owe and then taking it is the front desk job.
  --
  --   Deleting is manager work. Employees correct today - a meal marked
  --   given by mistake, a package day taken in error - and do not remove
  --   dogs, owners, reservations, documents or vaccination records.
  --   Deleting a PAYMENT is owner work: it is the one deletion that
  --   destroys a money trail rather than a record of care.
  --
  --   The kiosk gets the narrowest set that still lets it work: find a
  --   dog by phone, sign in and out, spend a package day, take a payment.
  --   It cannot read the owners table at all, so an unattended screen in a
  --   public lobby holds no addresses, emails or emergency contacts.
  --
  --   Settings is the business itself - prices, branding, the Square IDs,
  --   the email templates clients receive - so it is owner only.
  --
  -- staff_roles and audit_log are deliberately absent: both need policies
  -- that a per-command cell cannot express, and both are handled below.
  -- ---------------------------------------------------------------
  matrix text[][] := array[
    --  table                select insert update delete   client: sel  ins  upd  del
    array['dogs',              'EK',  'E',   'E',   'M',           'V', '-', '-', '-'],
    -- F on update, and this cell was an update policy until the isolation
    -- test proved the policy did nothing. Postgres applies SELECT policies
    -- to the rows an UPDATE reads, and update().eq(id) reads; a client has
    -- no select policy here, so the statement matched no rows, reported
    -- success and changed nothing. A control that fails silently is worse
    -- than one that is absent, so the write went to update_my_household,
    -- which names the twelve contact columns it will set. phone is not one
    -- of them: it is the key the households were rebuilt on.
    array['owners',            'E',   'E',   'E',   'M',           'V', '-', 'F', '-'],
    array['signins',           'EK',  'EK',  'E',   'M',           'V', '-', '-', '-'],
    array['boardings',         'EK',  'E',   'E',   'M',           'V', '-', '-', '-'],
    -- Selling is employee work. A client asks for a ten-day block at the
    -- counter and the person at the counter is who sells it; needing a
    -- manager for a routine transaction means either the sale does not
    -- happen or the manager password gets shared, and the second is worse
    -- than the thing this was guarding against. It also matched nothing
    -- else: an employee could already take a payment, which is the same
    -- act. Every sale is written to the audit log with who made it, which
    -- is the control that actually catches misuse — blocking the till does
    -- not. Deleting one stays with a manager.
    array['packages',          'EK',  'E',   'EK',  'M',           'V', '-', '-', '-'],
    array['package_uses',      'EK',  'EK',  'EK',  'E',           'V', '-', '-', '-'],
    array['payments',          'EK',  'EK',  'M',   'OA',          'V', '-', '-', '-'],
    array['vaccinations',      'E',   'E',   'E',   'M',           'V', '-', '-', '-'],
    -- Not the care logs. A client seeing whether their dog was fed and
    -- walked would be a good feature and is not this one: these rows carry
    -- the initials of whoever did it, they are written and corrected all day
    -- long, and nothing was asked for here. Left shut rather than half open.
    array['meal_logs',         'E',   'E',   'E',   'E',           '-', '-', '-', '-'],
    array['walk_logs',         'E',   'E',   'E',   'E',           '-', '-', '-', '-'],
    -- Insert, so a client can upload a replacement vaccination record. The
    -- fill_owner_id trigger derives owner_id on this table from the DOG
    -- rather than from the session, so a record uploaded against a dog in
    -- another household arrives stamped with that household and this cell
    -- refuses it. Update and delete stay with staff: a record is replaced by
    -- adding the new one, and the history of what was on file when is worth
    -- more than a tidy list.
    array['dog_docs',          'E',   'E',   'E',   'M',           'V', 'OWN', '-', '-'],
    -- Insert is EK, not E, and the reason is easy to get wrong: the
    -- enrollment and boarding forms are filled in on the lobby iPad as well
    -- as on the website, and that iPad is signed in as the kiosk. Its
    -- requests arrive as authenticated, so the anon policy never applies to
    -- them. Leaving these at E would have left the public website working
    -- and broken signup on the kiosk - the failure nobody tests for.
    -- A client adding a second dog. It goes into the SAME pending queue the
    -- public form feeds, because that is what it is: a new dog nobody here
    -- has met, needing a meet & greet like any other. The household is
    -- already known, so the trigger stamps the phone from the session rather
    -- than reading it off the form, and OWN then checks it.
    --
    -- Select stays with staff. The queue holds other households applications
    -- and a client has no business reading it; what they submitted comes
    -- back to them through my_dogs once staff approve it.
    array['enrollments',       'E',   'EK',  'E',   'M',           '-', 'OWN', '-', '-'],
    -- The one place a client writes something that reaches staff. It goes
    -- into the SAME pending queue the public form feeds - the portal offers
    -- no way to book, only to ask - and the trigger stamps owner_id and the
    -- phone from the session, so a request cannot arrive claiming to come
    -- from a household it did not.
    array['boarding_requests', 'E',   'EK',  'E',   'M',           'V', 'OWN', '-', '-'],
    -- PUB on these three: a signed-out visitor can already read all of them
    -- through the anon policies below, so this is not a grant, it is the
    -- repair of one. Without it the marketing site, the prices and the
    -- branding would render for everybody EXCEPT a signed-in client, who is
    -- authenticated and holds no staff role.
    --
    -- The isolation test caught the narrower version of this, where the cell
    -- was is_customer rather than any signed-in account: a person who had
    -- just set their password but not yet finished claiming got the shipped
    -- defaults instead of the business name and colours, on the claim page,
    -- which is the first screen a new client ever sees.
    array['settings',          'ANY', 'OA',  'OA',  'OA',          'PUB', '-', '-', '-'],
    array['site_photos',       'ANY', 'M',   'M',   'M',           'PUB', '-', '-', '-'],
    array['reviews',           'ANY', 'M',   'M',   'M',           'PUB', '-', '-', '-'],
    -- A leftover from importing vaccination records. Nothing in the
    -- application reads or writes it and no previous migration named it, so
    -- whatever policy it has was never chosen - it was simply never
    -- considered. It is empty today, so nothing is exposed, but a table that
    -- holds customer vaccination data whenever it is in use should not be
    -- outside the matrix. Manager and above, matching the real vaccinations
    -- table minus the employee access that only the care screens need.
    --
    -- Importing through the SQL editor or with the secret key is unaffected:
    -- both bypass RLS. If it is genuinely finished with, drop it.
    array['vaccinations_staging', 'M', 'M',  'M',   'M',           '-', '-', '-', '-']
  ];

  -- Readable by the public website without signing in.
  public_read text[] := array['settings', 'site_photos', 'reviews'];
  -- Writable by the public: form submissions, insert only.
  public_insert text[] := array['enrollments', 'boarding_requests'];

  -- Every policy this script has ever created, dropped before it writes,
  -- so a re-run replaces rather than duplicates and so the blanket policy
  -- from the previous version goes.
  old_names text[] := array[
    'allow all', 'staff full access', 'public read', 'public submit',
    'staff select', 'staff insert', 'staff update', 'staff delete',
    'customer select', 'customer insert', 'customer update', 'customer delete',
    'own role', 'manage roles', 'harden own account', 'read audit log'
  ];

  cmds text[] := array['select', 'insert', 'update', 'delete'];

  t text;
  cmd text;
  cell text;
  expr text;
  policy_name text;
  name text;
  i int;
  c int;
  skipped text[] := '{}';
  owners int;
begin
  -- -----------------------------------------------------------------
  -- Refuse to run out of order. Without roles, every policy below
  -- evaluates false for everybody and the business loses its own app.
  -- -----------------------------------------------------------------
  if to_regclass('public.staff_roles') is null then
    raise exception 'staff_roles does not exist. Run security-roles-migration.sql first, or this would lock every account out.';
  end if;

  execute 'select count(*) from public.staff_roles where role = ''owner_admin''' into owners;
  if owners = 0 then
    raise exception 'No owner_admin exists in staff_roles. Assign one first, or this would lock every account out.';
  end if;

  if to_regclass('public.audit_log') is null then
    raise exception 'audit_log does not exist. Run security-audit-migration.sql first.';
  end if;

  -- The client half of the matrix compares owner_id against a function.
  -- Neither exists until step 4, and writing these policies without them
  -- would fail on the first client cell and roll the whole rewrite back -
  -- leaving the database on whatever policies it had, which after a first
  -- run means the blanket one.
  if to_regprocedure('public.customer_owner_id()') is null then
    raise exception 'customer_owner_id does not exist. Run customer-accounts-migration.sql first: the client policies below have nothing to compare against without it.';
  end if;

  -- -----------------------------------------------------------------
  -- The matrix.
  -- -----------------------------------------------------------------
  for i in 1 .. array_length(matrix, 1) loop
    t := matrix[i][1];

    if to_regclass('public.' || t) is null then
      skipped := skipped || t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    foreach name in array old_names loop
      execute format('drop policy if exists %I on public.%I', name, t);
    end loop;

    -- Eight cells: four staff, then four client. Both halves become a
    -- policy the same way and only the expression differs, so the writing
    -- of it stays in one place rather than being said twice.
    --
    -- The two halves are separate policies on purpose, not one combined
    -- expression. Postgres ORs the permissive policies on a table together,
    -- which is exactly the semantics wanted here: an employee passes the
    -- staff policy and fails the client one, a client the reverse, and
    -- neither is ever asked to satisfy both.
    for c in 1 .. 8 loop
      cmd := cmds[((c - 1) % 4) + 1];
      cell := matrix[i][c + 1];

      if c <= 4 then
        policy_name := 'staff ' || cmd;
        -- Wrapped in a select so Postgres evaluates the role lookup once per
        -- statement instead of once per row. On a 20,000 row sign-in history
        -- that is the difference between a report that loads and one that
        -- times out.
        expr := case cell
          when 'OA'  then '(select public.is_owner_admin())'
          when 'M'   then '(select public.at_least_manager())'
          when 'E'   then '(select public.at_least_employee())'
          when 'EK'  then '(select public.at_least_employee() or public.is_kiosk())'
          when 'ANY' then '(select public.has_staff_role())'
          when '-'   then null
          else null
        end;
        if expr is null and cell <> '-' then
          raise exception 'Unknown staff cell % for %.%', cell, t, cmd;
        end if;
      else
        policy_name := 'customer ' || cmd;
        -- Same select wrapper, and it matters more here: without it
        -- customer_owner_id would be called once per row of a household
        -- history rather than once for the statement.
        expr := case cell
          when 'OWN'  then 'owner_id = (select public.customer_owner_id())'
          -- Not a bare true, so the "anything left open" check below does
          -- not have to make an exception for it.
          when 'PUB'  then '(select auth.uid() is not null)'
          -- Through the named view or function instead. No policy, on
          -- purpose, and not the same as a cell nobody has thought about.
          when 'V'    then null
          when 'F'    then null
          when '-'    then null
          else null
        end;
        if expr is null and cell not in ('-', 'V', 'F') then
          raise exception 'Unknown client cell % for %.%', cell, t, cmd;
        end if;
      end if;

      if expr is null then
        continue;
      end if;

      -- insert takes with check, delete and select take using, update
      -- needs both: using decides which rows may be touched, with check
      -- decides what they may be turned into. Leaving with check off an
      -- update policy lets a caller edit a row into a state they could not
      -- have created.
      if cmd = 'insert' then
        execute format(
          'create policy %I on public.%I for insert to authenticated with check (%s)',
          policy_name, t, expr
        );
      elsif cmd = 'update' then
        execute format(
          'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
          policy_name, t, expr, expr
        );
      else
        execute format(
          'create policy %I on public.%I for %s to authenticated using (%s)',
          policy_name, t, cmd, expr
        );
      end if;
    end loop;

    -- The narrow public grants.
    if t = any(public_read) then
      execute format('create policy "public read" on public.%I for select to anon using (true)', t);
    end if;

    if t = any(public_insert) then
      -- Insert only: a visitor can submit a form but cannot read back what
      -- anyone else submitted, which would expose every applicant name,
      -- phone and address.
      --
      -- One trap worth knowing about, because it looks like a policy bug
      -- and is not. Insert only means the insert must not ask for the row
      -- back: Postgres treats a RETURNING clause as a read, and with no
      -- select policy for anon the whole statement is refused. The
      -- enrollment and boarding forms therefore insert without calling
      -- select, and adding one later would break public submissions while
      -- every staff path kept working.
      execute format('create policy "public submit" on public.%I for insert to anon with check (true)', t);
    end if;
  end loop;

  -- The same trap, and it now catches a second case worth naming here
  -- because it is the one somebody will hit. A client has no select policy
  -- on any base table - the V cells - so a client insert into dog_docs or
  -- boarding_requests, and a client update of their own owners row, must
  -- also not ask for the row back. supabase-js does that only when select
  -- is chained onto the call, so the portal never chains it, and reads the
  -- my_* view afterwards instead.

  -- -----------------------------------------------------------------
  -- staff_roles. The permission boundary, so it gets written out by hand.
  --
  -- Everyone reads their own row: the app has to know what it is allowed
  -- to offer, and it must be able to find that out before MFA, or an owner
  -- could never be told they need to enter a code. Managers read the whole
  -- list so the audit log can show who is who. Only an owner writes.
  --
  -- The one exception is hardening: an account may update its own row, and
  -- the staff_roles_guard trigger allows exactly one change through that
  -- door - turning require_mfa on. It cannot change a role, cannot touch
  -- anybody else, and cannot turn its own MFA requirement off again.
  -- -----------------------------------------------------------------
  execute 'alter table public.staff_roles enable row level security';

  foreach name in array old_names loop
    execute format('drop policy if exists %I on public.staff_roles', name);
  end loop;

  execute 'create policy "own role" on public.staff_roles
    for select to authenticated
    using (user_id = (select auth.uid()) or (select public.at_least_manager()))';

  execute 'create policy "manage roles" on public.staff_roles
    for all to authenticated
    using ((select public.is_owner_admin()))
    with check ((select public.is_owner_admin()))';

  execute 'create policy "harden own account" on public.staff_roles
    for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()))';

  -- -----------------------------------------------------------------
  -- audit_log. Readable by managers and owners, and writable by nobody
  -- through the API: the only ways in are audit_write and the triggers,
  -- which run as the table owner. An employee therefore cannot forge an
  -- entry, cannot edit one, and cannot delete one - and neither can the
  -- secret key, because append-only is a trigger rather than a policy.
  -- -----------------------------------------------------------------
  execute 'alter table public.audit_log enable row level security';

  foreach name in array old_names loop
    execute format('drop policy if exists %I on public.audit_log', name);
  end loop;

  execute 'create policy "read audit log" on public.audit_log
    for select to authenticated
    using ((select public.at_least_manager()))';

  if array_length(skipped, 1) is not null then
    raise notice 'Skipped tables that do not exist: %', array_to_string(skipped, ', ');
  end if;
  raise notice 'Per-role policies in place across % tables.', array_length(matrix, 1) - coalesce(array_length(skipped, 1), 0);
end
$lockdown$;

-- ---------------------------------------------------------------------
-- Check 1. Every policy now in force, and who it is for. Expect anon to
-- appear only on settings/site_photos/reviews (select) and
-- enrollments/boarding_requests (insert), and expect no policy anywhere
-- whose expression is a bare true for authenticated.
-- ---------------------------------------------------------------------
select
  tablename,
  policyname,
  roles,
  cmd,
  coalesce(qual, with_check) as expression
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- ---------------------------------------------------------------------
-- Check 2. Anything left open. This should return no rows: a policy that
-- grants authenticated a bare true is the thing this file exists to
-- remove, and one that reappears has been added by hand somewhere.
-- ---------------------------------------------------------------------
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and 'authenticated' = any (roles)
  and (coalesce(qual, 'true') = 'true' and coalesce(with_check, 'true') = 'true');

-- ---------------------------------------------------------------------
-- Check 3. Every table the app owns has RLS actually enabled. Also no
-- rows expected.
-- ---------------------------------------------------------------------
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
order by c.relname;

-- ---------------------------------------------------------------------
-- Check 4. Every client policy, and the row test it applies. Read this as
-- the answer to the requirement that customers cannot reach each other:
-- every expression here must mention customer_owner_id, because that is
-- the only thing that narrows a statement to one household. A client
-- policy that does not is a client policy that leaks.
-- ---------------------------------------------------------------------
select
  tablename,
  policyname,
  cmd,
  coalesce(qual, with_check) as row_test,
  coalesce(qual, with_check) like '%customer_owner_id%'
    or coalesce(qual, with_check) like '%is_customer%' as scoped
from pg_policies
where schemaname = 'public'
  and policyname like 'customer %'
order by tablename, cmd;

-- ---------------------------------------------------------------------
-- Check 5. The views a client reads through must not be reachable by a
-- signed-out visitor, and must be reachable by a signed-in one. Expect one
-- row per my_ view, anon false and authenticated true throughout.
-- ---------------------------------------------------------------------
select
  c.relname as view_name,
  has_table_privilege('anon', c.oid, 'select') as anon_can_read,
  has_table_privilege('authenticated', c.oid, 'select') as authenticated_can_read
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname like 'my\_%'
order by c.relname;
