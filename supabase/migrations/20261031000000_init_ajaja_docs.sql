-- ==============================================================================
-- Ajaja Document Editor - Production SQL Migration (Final Hardened Edition)
-- Architecture Review Adjustments:
-- 1. Explicit Column-Level INSERT Grants on documents (title, content, owner_id)
-- 2. Email normalization & pre-index duplicate sanitization check
-- 3. Strict auth email synchronization (raises exception on NULL/empty emails)
-- 4. Idempotent backfill from auth.users to public.profiles
-- 5. Schema-qualified enum existence check (n.nspname = 'public')
-- 6. Trigger execution restricted from public, anon, authenticated
-- ==============================================================================

-- 1. Enable required extensions
create extension if not exists "uuid-ossp";

-- 2. Private Schema Configuration
-- Rationale: Helper routines live in schema `private`, kept out of PostgREST exposed schemas.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

-- 3. Document Role Enum (Scoped strictly to public schema)
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'document_role'
      and n.nspname = 'public'
  ) then
    create type public.document_role as enum ('viewer', 'editor');
  end if;
end
$$;

-- 4. Application Tables

-- Table A: Profiles
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text,
  created_at timestamptz default now() not null
);

-- Pre-index duplicate check / deduplication safeguard for existing profiles
do $$
begin
  if exists (
    select lower(trim(email))
    from public.profiles
    group by lower(trim(email))
    having count(*) > 1
  ) then
    raise exception 'Cannot create unique index: Duplicate normalized emails detected in public.profiles'
      using errcode = '23505';
  end if;
end;
$$;

-- Ensure case-insensitive unique email index on profiles
create unique index if not exists uq_profiles_email_lower on public.profiles (lower(trim(email)));

-- Table B: Documents
create table if not exists public.documents (
  id uuid default gen_random_uuid() primary key,
  title text not null default 'Untitled Document',
  content jsonb default '{"type": "doc", "content": []}'::jsonb not null,
  owner_id uuid references public.profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Table C: Document Collaborators
create table if not exists public.document_collaborators (
  id uuid default gen_random_uuid() primary key,
  document_id uuid references public.documents(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role public.document_role not null default 'viewer',
  created_at timestamptz default now() not null,
  constraint uq_document_collaborator unique (document_id, user_id)
);

-- Performance Indexes
create index if not exists idx_documents_owner on public.documents(owner_id);
create index if not exists idx_collaborators_doc on public.document_collaborators(document_id);
create index if not exists idx_collaborators_user on public.document_collaborators(user_id);

-- 5. Updated_at Trigger Function
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.handle_updated_at() from public, anon, authenticated;

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
  before update on public.documents
  for each row execute procedure public.handle_updated_at();

-- 6. Immutable Document Fields Trigger (id, owner_id, created_at)
create or replace function public.prevent_document_immutable_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'Document ID cannot be changed' using errcode = '42501';
  end if;

  if new.owner_id <> old.owner_id then
    raise exception 'Document ownership cannot be changed' using errcode = '42501';
  end if;

  if new.created_at <> old.created_at then
    raise exception 'Document creation timestamp cannot be changed' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_document_immutable_changes() from public, anon, authenticated;

drop trigger if exists check_document_immutability on public.documents;
create trigger check_document_immutability
  before update on public.documents
  for each row execute procedure public.prevent_document_immutable_changes();

-- 7. Auth User Synchronization Trigger (Insert & Email Update)
-- Requirement 11: Fail fast if an auth user has null or empty email because the application requires email accounts.
create or replace function public.handle_auth_user_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  norm_email text;
  display_name text;
begin
  if new.email is null or trim(new.email) = '' then
    raise exception 'User email cannot be null or empty' using errcode = '23502';
  end if;

  norm_email := lower(trim(new.email));
  display_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(norm_email, '@', 1));

  if tg_op = 'INSERT' then
    insert into public.profiles (id, email, full_name)
    values (new.id, norm_email, display_name)
    on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.email is distinct from old.email or
       (new.raw_user_meta_data->>'full_name') is distinct from (old.raw_user_meta_data->>'full_name') then
      insert into public.profiles (id, email, full_name)
      values (new.id, norm_email, display_name)
      on conflict (id) do update
      set email = excluded.email,
          full_name = coalesce(new.raw_user_meta_data->>'full_name', public.profiles.full_name);
    end if;
    return new;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_auth_user_sync() from public, anon, authenticated;
grant execute on function public.handle_auth_user_sync() to service_role;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_sync on auth.users;
create trigger on_auth_user_sync
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.handle_auth_user_sync();

-- 8. Idempotent Backfill for Existing auth.users
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    -- Check normalized email duplicates in auth.users before backfill
    if exists (
      select lower(trim(email))
      from auth.users
      where email is not null and trim(email) <> ''
      group by lower(trim(email))
      having count(*) > 1
    ) then
      raise exception 'Cannot backfill: Duplicate normalized emails detected in auth.users'
        using errcode = '23505';
    end if;

    insert into public.profiles (id, email, full_name)
    select
      u.id,
      lower(trim(u.email)),
      coalesce(u.raw_user_meta_data->>'full_name', split_part(lower(trim(u.email)), '@', 1))
    from auth.users u
    where u.email is not null
      and trim(u.email) <> ''
    on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  end if;
end;
$$;

-- 9. Parameterless Private Authorization Helpers
create or replace function private.can_access_document(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
    where d.id = doc_id and d.owner_id = (select auth.uid())
    union all
    select 1 from public.document_collaborators c
    where c.document_id = doc_id and c.user_id = (select auth.uid())
  );
$$;

create or replace function private.can_edit_document(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
    where d.id = doc_id and d.owner_id = (select auth.uid())
    union all
    select 1 from public.document_collaborators c
    where c.document_id = doc_id and c.user_id = (select auth.uid()) and c.role = 'editor'
  );
$$;

create or replace function private.is_document_owner(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
    where d.id = doc_id and d.owner_id = (select auth.uid())
  );
$$;

-- Helper execution grants
revoke all on function private.can_access_document(uuid) from public, anon, authenticated;
revoke all on function private.can_edit_document(uuid) from public, anon, authenticated;
revoke all on function private.is_document_owner(uuid) from public, anon, authenticated;
grant execute on function private.can_access_document(uuid) to authenticated, service_role;
grant execute on function private.can_edit_document(uuid) to authenticated, service_role;
grant execute on function private.is_document_owner(uuid) to authenticated, service_role;

-- 10. Row Level Security Activation
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_collaborators enable row level security;

-- 11. Explicit Table & Column-Level Grants (Least-Privilege Enforcement)
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.documents from public, anon, authenticated;
revoke all on table public.document_collaborators from public, anon, authenticated;

-- Service role access
grant all on table public.profiles to service_role;
grant all on table public.documents to service_role;
grant all on table public.document_collaborators to service_role;

-- Profiles: Authenticated users can SELECT and UPDATE(full_name)
grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

-- Documents: Authenticated users can SELECT, DELETE; INSERT only on (title, content, owner_id); UPDATE only on (title, content)
grant select, delete on table public.documents to authenticated;
grant insert (title, content, owner_id) on table public.documents to authenticated;
grant update (title, content) on table public.documents to authenticated;

-- Document Collaborators: SELECT only for authenticated (mutations via RPCs only)
grant select on table public.document_collaborators to authenticated;

-- 12. RLS Policies: Profiles
drop policy if exists "Users can read relevant profiles" on public.profiles;
create policy "Users can read relevant profiles"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid()) or
    exists (
      select 1 from public.document_collaborators dc
      join public.documents d on d.id = dc.document_id
      where (d.owner_id = (select auth.uid()) and dc.user_id = public.profiles.id)
         or (dc.user_id = (select auth.uid()) and d.owner_id = public.profiles.id)
    )
  );

drop policy if exists "Users can update own profile name only" on public.profiles;
create policy "Users can update own profile name only"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 13. RLS Policies: Documents
drop policy if exists "Documents select policy" on public.documents;
create policy "Documents select policy"
  on public.documents for select
  to authenticated
  using (
    owner_id = (select auth.uid()) or
    private.can_access_document(id)
  );

drop policy if exists "Documents insert policy" on public.documents;
create policy "Documents insert policy"
  on public.documents for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
  );

drop policy if exists "Documents update policy" on public.documents;
create policy "Documents update policy"
  on public.documents for update
  to authenticated
  using (
    owner_id = (select auth.uid()) or
    private.can_edit_document(id)
  )
  with check (
    owner_id = (select auth.uid()) or
    private.can_edit_document(id)
  );

drop policy if exists "Documents delete policy" on public.documents;
create policy "Documents delete policy"
  on public.documents for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
  );

-- 14. RLS Policies: Document Collaborators
drop policy if exists "Collaborators select policy" on public.document_collaborators;
create policy "Collaborators select policy"
  on public.document_collaborators for select
  to authenticated
  using (
    user_id = (select auth.uid()) or
    private.is_document_owner(document_id)
  );

-- 15. Owner-Authorized RPC: share_document
create or replace function public.share_document(
  target_document_id uuid,
  recipient_email text,
  assigned_role public.document_role default 'viewer'
)
returns table (
  collaborator_id uuid,
  document_id uuid,
  user_id uuid,
  role public.document_role,
  email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
  target_user_id uuid;
  normalized_email text;
  result_row public.document_collaborators%rowtype;
begin
  caller_id := (select auth.uid());
  if caller_id is null then
    raise exception 'Unauthorized: Authentication required' using errcode = '42501';
  end if;

  if recipient_email is null or trim(recipient_email) = '' then
    raise exception 'Recipient email cannot be empty' using errcode = '22023';
  end if;

  normalized_email := lower(trim(recipient_email));

  -- Verify document exists and caller is owner
  if not exists (
    select 1 from public.documents d
    where d.id = target_document_id and d.owner_id = caller_id
  ) then
    raise exception 'Forbidden: Only document owners can manage sharing' using errcode = '42501';
  end if;

  if assigned_role not in ('viewer', 'editor') then
    raise exception 'Invalid role. Role must be viewer or editor' using errcode = '22023';
  end if;

  select p.id into target_user_id
  from public.profiles p
  where lower(trim(p.email)) = normalized_email;

  if target_user_id is null then
    raise exception 'User not found. Recipient must have an account.' using errcode = 'P0002';
  end if;

  if target_user_id = caller_id then
    raise exception 'Cannot share document with yourself' using errcode = '22000';
  end if;

  insert into public.document_collaborators (document_id, user_id, role)
  values (target_document_id, target_user_id, assigned_role)
  on conflict (document_id, user_id)
  do update set role = excluded.role
  returning * into result_row;

  return query
  select
    result_row.id,
    result_row.document_id,
    result_row.user_id,
    result_row.role,
    normalized_email;
end;
$$;

revoke all on function public.share_document(uuid, text, public.document_role) from public, anon;
grant execute on function public.share_document(uuid, text, public.document_role) to authenticated, service_role;

-- 16. Owner-Authorized RPC: remove_collaborator
create or replace function public.remove_collaborator(
  target_document_id uuid,
  collaborator_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  caller_id := (select auth.uid());
  if caller_id is null then
    raise exception 'Unauthorized: Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.documents d
    where d.id = target_document_id and d.owner_id = caller_id
  ) then
    raise exception 'Forbidden: Only document owners can remove collaborators' using errcode = '42501';
  end if;

  delete from public.document_collaborators
  where document_id = target_document_id and user_id = collaborator_user_id;

  return true;
end;
$$;

revoke all on function public.remove_collaborator(uuid, uuid) from public, anon;
grant execute on function public.remove_collaborator(uuid, uuid) to authenticated, service_role;
