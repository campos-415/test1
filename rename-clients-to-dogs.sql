-- Rename: the table called clients has always held one row per DOG, not one
-- per client. Same for every client_id foreign key pointing at it.
--
-- THIS IS A COORDINATED CHANGE. Run this SQL and deploy the matching code
-- together, ideally while closed. There is deliberately no compatibility
-- shim: a view could fake the old clients table, but nothing can fake the
-- old client_id columns on signins and boardings while they are renamed, so
-- a half-working shim would only hide the breakage.
--
-- Rollback lives in rollback-dogs-to-clients.sql.
--
-- Every column renamed below was confirmed present before this was written.
-- No apostrophe, quote or dollar-quoted block appears anywhere in this file:
-- the Supabase SQL editor splits statements on semicolons with a scanner
-- that understands none of those, and would mangle the script.

alter table clients rename to dogs;

alter table client_docs rename to dog_docs;

alter table signins rename column client_id to dog_id;

alter table boardings rename column client_id to dog_id;

alter table vaccinations rename column client_id to dog_id;

alter table payments rename column client_id to dog_id;

alter table package_uses rename column client_id to dog_id;

alter table dog_docs rename column client_id to dog_id;

alter index if exists vaccinations_client_vaccine_key rename to vaccinations_dog_vaccine_key;

alter index if exists client_docs_client_idx rename to dog_docs_dog_idx;

-- Verify. Expect six rows, all dog_id, and nothing named client_id.
select table_name, column_name
from information_schema.columns
where column_name in (select 'dog_id' union select 'client_id')
order by column_name, table_name;
