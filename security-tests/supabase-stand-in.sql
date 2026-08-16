-- A stand-in for the parts of Supabase the migrations lean on, so the real
-- migration files can be run and tested locally without touching the live
-- database. Only the shapes matter: the columns the migrations and policies
-- actually reference.

create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  last_sign_in_at timestamptz
);

create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'unverified',
  factor_type text not null default 'totp'
);

-- The same definitions Supabase ships.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  -- nullif before the cast, the way Supabase does it: with no session the
  -- setting is an empty string, and an empty string is not valid json.
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create role anon;
create role authenticated;
-- The key that bypasses RLS entirely. Used by the server-only routes, and
-- granted to by customer-accounts-migration.sql.
create role service_role;

-- The application tables are NOT defined here.
--
-- They used to be: sixteen hand-written approximations carrying "the columns
-- the policies and audit triggers touch". They drifted, which is the only
-- thing a second copy of a schema ever does -- owners grew a notes column in
-- 00-base-schema.sql, customer-accounts-migration.sql went looking for it
-- here, and this whole suite stopped running. Nobody noticed, because a test
-- that fails at step one still exits before it can contradict anybody.
--
-- The runner loads 00-base-schema.sql immediately after this file instead, so
-- the policies are proved against the schema the business actually has.

-- What Supabase grants by default. RLS filters on top of these; without
-- them every policy below is moot because the table privilege is missing.
--
-- These run in the RUNNER after the schema files, not here: "all tables in
-- schema public" only covers the tables that exist when it is executed, and
-- at this point none of them do. See grantsFile in policy-matrix.test.mjs.
