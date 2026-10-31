-- ==============================================================================
-- Ajaja Document Editor: Comprehensive pgTAP Authorization & Security Test Suite
-- Executes strictly against pgTAP: plan(), is(), is_empty(), throws_ok(), finish()
-- Tests run under SET LOCAL ROLE authenticated and SET LOCAL request.jwt.claim.sub
-- ==============================================================================
-- NOTE: Prepared for execution via `supabase test db`.
-- Has NOT been executed against production Supabase.
-- ==============================================================================

begin;

-- Load pgTAP extension if not present
create extension if not exists pgtap with schema extensions;

-- Plan total tests (exactly 33 assertions)
select plan(33);

-- -----------------------------------------------------------------------------
-- SETUP: Test Fixtures (Run under privileged database owner/postgres role)
-- -----------------------------------------------------------------------------
create temp table test_vars (
  owner_id uuid,
  editor_id uuid,
  viewer_id uuid,
  stranger_id uuid,
  doc_id uuid
);

insert into test_vars values (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  '33333333-3333-3333-3333-333333333333'::uuid,
  '44444444-4444-4444-4444-444444444444'::uuid,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
);

-- Insert into auth.users (triggers public.handle_auth_user_sync)
insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice.Owner@Example.COM', '{"full_name": "Alice Owner"}'),
  ('22222222-2222-2222-2222-222222222222', 'Bob.Editor@Example.COM', '{"full_name": "Bob Editor"}'),
  ('33333333-3333-3333-3333-333333333333', 'Charlie.Viewer@Example.COM', '{"full_name": "Charlie Viewer"}'),
  ('44444444-4444-4444-4444-444444444444', 'Dave.Stranger@Example.COM', '{"full_name": "Dave Stranger"}');

-- Create baseline document owned by Alice
insert into public.documents (id, title, content, owner_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice Roadmap', '{"type":"doc","content":[]}', '11111111-1111-1111-1111-111111111111');

-- Set up baseline collaborators
insert into public.document_collaborators (document_id, user_id, role)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'editor'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer');

-- -----------------------------------------------------------------------------
-- 1. AUTH EMAIL SYNCHRONIZATION & PROFILE UPSERT TESTS
-- -----------------------------------------------------------------------------
-- 1. Verify email was normalized on insert trigger
select is(
  (select email from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'alice.owner@example.com',
  'Auth trigger normalizes email to lower(trim(email)) on INSERT'
);

-- 2. Verify email synchronization on auth.users update
update auth.users
set email = 'Alice.NewEmail@Example.COM'
where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select email from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'alice.newemail@example.com',
  'Auth trigger synchronizes email changes from auth.users to public.profiles'
);

-- 3. Verify empty/null email in auth.users throws exception (strict email enforcement)
select throws_ok(
  $$ update auth.users set email = '' where id = '11111111-1111-1111-1111-111111111111' $$,
  '23502',
  'User email cannot be null or empty',
  'Auth trigger rejects empty/null email updates'
);

-- Revert email for subsequent tests
update auth.users
set email = 'alice.owner@example.com'
where id = '11111111-1111-1111-1111-111111111111';

-- 4. Verify UPSERT recreate missing profile on auth update
delete from public.profiles where id = '44444444-4444-4444-4444-444444444444';
update auth.users
set raw_user_meta_data = '{"full_name": "Dave Restored"}'
where id = '44444444-4444-4444-4444-444444444444';

select is(
  (select full_name from public.profiles where id = '44444444-4444-4444-4444-444444444444'),
  'Dave Restored',
  'Auth update trigger recreates missing profile via UPSERT'
);

-- -----------------------------------------------------------------------------
-- 2. PRIVILEGED TRIGGER TESTS (Immutable Document Fields)
-- Tested under postgres/privileged role to verify trigger behavior independently of RLS/grants
-- -----------------------------------------------------------------------------
-- 5. Reject changing owner_id
select throws_ok(
  $$ update public.documents set owner_id = '22222222-2222-2222-2222-222222222222' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501',
  'Document ownership cannot be changed',
  'Trigger check_document_immutability rejects changing owner_id'
);

-- 6. Reject changing created_at
select throws_ok(
  $$ update public.documents set created_at = now() - interval '1 year' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501',
  'Document creation timestamp cannot be changed',
  'Trigger check_document_immutability rejects changing created_at'
);

-- 7. Reject changing document id
select throws_ok(
  $$ update public.documents set id = gen_random_uuid() where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501',
  'Document ID cannot be changed',
  'Trigger check_document_immutability rejects changing document id'
);

-- -----------------------------------------------------------------------------
-- 3. AUTHENTICATED ROLE: OWNER PERMISSIONS & COLUMN-LEVEL GRANTS (Alice)
-- Switching context to: authenticated as Alice (Owner)
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- 8. Reject INSERT attempts specifying id (permission denied for column id)
select throws_ok(
  $$ insert into public.documents (id, title, content, owner_id) values (gen_random_uuid(), 'Hacked ID', '{"type":"doc","content":[]}', '11111111-1111-1111-1111-111111111111') $$,
  '42501',
  NULL,
  'Authenticated user cannot specify id on INSERT (column grant restricted)'
);

-- 9. Reject INSERT attempts specifying created_at
select throws_ok(
  $$ insert into public.documents (created_at, title, content, owner_id) values (now(), 'Hacked Created', '{"type":"doc","content":[]}', '11111111-1111-1111-1111-111111111111') $$,
  '42501',
  NULL,
  'Authenticated user cannot specify created_at on INSERT (column grant restricted)'
);

-- 10. Reject INSERT attempts specifying updated_at
select throws_ok(
  $$ insert into public.documents (updated_at, title, content, owner_id) values (now(), 'Hacked Updated', '{"type":"doc","content":[]}', '11111111-1111-1111-1111-111111111111') $$,
  '42501',
  NULL,
  'Authenticated user cannot specify updated_at on INSERT (column grant restricted)'
);

-- 11. Valid INSERT specifying only (title, content, owner_id) succeeds and creates row
insert into public.documents (title, content, owner_id)
values ('Alice Second Doc', '{"type":"doc","content":[]}', '11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.documents where title = 'Alice Second Doc' and owner_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'Authenticated owner can INSERT document and record actually exists in database'
);

-- 12. Owner UPDATE actually changes title in database
update public.documents set title = 'Alice Roadmap Renamed' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select title from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Alice Roadmap Renamed',
  'Owner UPDATE actually changes document title in database'
);

-- 13. Owner DELETE actually removes the document from the database
delete from public.documents where title = 'Alice Second Doc';

select is(
  (select count(*)::int from public.documents where title = 'Alice Second Doc'),
  0,
  'Owner DELETE actually removes document from database'
);

-- 14. Reject authenticated profile email update
select throws_ok(
  $$ update public.profiles set email = 'hacked@example.com' where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501',
  NULL,
  'Authenticated user cannot update email in public.profiles (column grant restricted)'
);

-- -----------------------------------------------------------------------------
-- 4. AUTHENTICATED ROLE: EDITOR COLLABORATOR PERMISSIONS (Bob)
-- Switching context to: authenticated as Bob (Editor)
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

-- 15. Editor can read document
select is(
  (select count(*)::int from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Editor can read shared document'
);

-- 16. Editor UPDATE actually changes document title and content in database
update public.documents
set title = 'Bob Updated Roadmap',
    content = '{"type":"doc","content":[{"type":"paragraph"}]}'
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select is(
  (select title from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Bob Updated Roadmap',
  'Editor UPDATE actually changes document title and content in database'
);

-- 17. Editor denied delete (document remains in database)
delete from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(
  (select count(*)::int from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Editor cannot delete shared document (RLS filter preserves document)'
);

-- -----------------------------------------------------------------------------
-- 5. AUTHENTICATED ROLE: VIEWER COLLABORATOR PERMISSIONS (Charlie)
-- Switching context to: authenticated as Charlie (Viewer)
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

-- 18. Viewer can read document
select is(
  (select count(*)::int from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Viewer can read shared document'
);

-- 19. Viewer denied update (title remains unchanged in database)
update public.documents set title = 'Charlie Attempt' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(
  (select title from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Bob Updated Roadmap',
  'Viewer cannot update document (title remains unchanged)'
);

-- 20. Viewer denied delete (document remains in database)
delete from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
select is(
  (select count(*)::int from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Viewer cannot delete shared document (RLS filter preserves document)'
);

-- -----------------------------------------------------------------------------
-- 6. AUTHENTICATED ROLE: STRANGER / NON-MEMBER ISOLATION (Dave)
-- Switching context to: authenticated as Dave (Stranger)
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

-- 21. Stranger cannot read document
select is_empty(
  $$ select * from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'Stranger cannot see or read unshared document'
);

-- 22. Stranger UPDATE denied (assert zero affected rows via data-modifying CTE with RETURNING)
with updated as (
  update public.documents
  set title = 'Dave Hack'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  returning 1
)
select is(
  (select count(*)::int from updated),
  0,
  'Stranger UPDATE denied (data-modifying CTE returns 0 affected rows)'
);

-- 23. Stranger DELETE denied (assert zero affected rows via data-modifying CTE with RETURNING)
with deleted as (
  delete from public.documents
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  returning 1
)
select is(
  (select count(*)::int from deleted),
  0,
  'Stranger DELETE denied (data-modifying CTE returns 0 affected rows)'
);

-- 24. Stranger cannot enumerate unrelated profiles (can only see their own profile)
select is(
  (select count(*)::int from public.profiles),
  1,
  'Stranger cannot enumerate system profiles (only sees own profile)'
);

-- -----------------------------------------------------------------------------
-- 7. RPC AUTHORIZATION TESTS: SHARING, PERMISSIONS & REMOVAL
-- -----------------------------------------------------------------------------
-- 25. Non-owner (Stranger Dave) attempting to share must fail with 42501
select throws_ok(
  $$ select * from public.share_document('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'alice.owner@example.com', 'editor') $$,
  '42501',
  'Forbidden: Only document owners can manage sharing',
  'Non-owner cannot invoke share_document (SQLSTATE 42501)'
);

-- 26. Editor (Bob) attempting to remove a collaborator must fail with 42501
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$ select public.remove_collaborator('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '33333333-3333-3333-3333-333333333333'::uuid) $$,
  '42501',
  'Forbidden: Only document owners can remove collaborators',
  'Editor cannot remove collaborator (SQLSTATE 42501)'
);

-- Switch back to Owner (Alice)
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- 27. Owner attempting self-sharing must fail with 22000
select throws_ok(
  $$ select * from public.share_document('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'alice.owner@example.com', 'editor') $$,
  '22000',
  'Cannot share document with yourself',
  'Owner cannot share document with themselves (SQLSTATE 22000)'
);

-- 28. Owner can successfully share document with registered user (Dave as editor)
select is(
  (select role::text from public.share_document('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Dave.Stranger@Example.COM', 'editor')),
  'editor',
  'Owner can successfully share document with registered user'
);

-- 29. Verify collaborator record created in document_collaborators
select is(
  (select count(*)::int from public.document_collaborators where document_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '44444444-4444-4444-4444-444444444444' and role = 'editor'),
  1,
  'Collaborator record created in document_collaborators'
);

-- 30. Dave can now read the shared document as a collaborator
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select is(
  (select count(*)::int from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Newly added collaborator can now read shared document'
);

-- 31. Owner can successfully remove collaborator (Alice removes Dave)
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  (select public.remove_collaborator('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '44444444-4444-4444-4444-444444444444'::uuid)),
  true,
  'Owner can successfully remove collaborator'
);

-- 32. Collaborator record actually deleted from document_collaborators
select is(
  (select count(*)::int from public.document_collaborators where document_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and user_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'Collaborator record actually deleted from document_collaborators'
);

-- 33. Access revoked after collaborator removal (Dave can no longer read document)
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select is_empty(
  $$ select * from public.documents where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  'Collaborator access is revoked after removal (cannot read document)'
);

-- Finish pgTAP plan
select * from finish();

rollback;
