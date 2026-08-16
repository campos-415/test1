-- Undoes rename-clients-to-dogs.sql, for going back to a pre-rename build.
-- Run this only if you need to redeploy the old code.
--
-- No apostrophe, quote or dollar-quoted block appears anywhere in this file,
-- for the Supabase SQL editor reason explained in the forward migration.

alter table dogs rename to clients;

alter table dog_docs rename to client_docs;

alter table signins rename column dog_id to client_id;

alter table boardings rename column dog_id to client_id;

alter table vaccinations rename column dog_id to client_id;

alter table payments rename column dog_id to client_id;

alter table package_uses rename column dog_id to client_id;

alter table client_docs rename column dog_id to client_id;

alter index if exists vaccinations_dog_vaccine_key rename to vaccinations_client_vaccine_key;

alter index if exists dog_docs_dog_idx rename to client_docs_client_idx;
