-- Website images move from database rows into a storage bucket.
--
-- The bucket itself is already created. This grants the permissions, which
-- cannot be set through the API.
--
-- Why only the website images: they are public by nature, there are about a
-- dozen, they change rarely, and everyone who visits the site loads them. Held
-- as base64 in a row they came back through the database API on every page
-- view, uncached, because the app sends no-store on database reads. As files
-- in a public bucket a visitor fetches them once and their browser keeps them.
--
-- Dog photos, signed waivers and vaccination records deliberately stay where
-- they are. Those are customer data, and in a public bucket the URL would be
-- the only thing between a stranger and paperwork that is not theirs.
--
-- No apostrophe, quote or dollar-quoted block appears in any comment here,
-- for the Supabase SQL editor reason noted in the other migrations.

-- Anyone may look at the website images. That is what a website is.
drop policy if exists "site photos are public" on storage.objects;
create policy "site photos are public" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'site-photos');

-- Only a signed-in account may add, replace or remove one.
drop policy if exists "staff manage site photos" on storage.objects;
create policy "staff manage site photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-photos');

drop policy if exists "staff replace site photos" on storage.objects;
create policy "staff replace site photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-photos')
  with check (bucket_id = 'site-photos');

drop policy if exists "staff remove site photos" on storage.objects;
create policy "staff remove site photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-photos');

-- ---------------------------------------------------------------------
-- Check. Expect the four policies above against the site-photos bucket.
-- ---------------------------------------------------------------------
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
