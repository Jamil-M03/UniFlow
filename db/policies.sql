-- UniFlow Row Level Security policies
-- =====================================
-- Run this in the Supabase SQL editor (or via the CLI) AFTER deploying the
-- hardened server.cjs and setting SUPABASE_SERVICE_ROLE_KEY / CLERK_SECRET_KEY.
--
-- Model:
--   * The browser uses the ANON key. It may READ the public catalog and reviews,
--     but may NOT write anything directly.
--   * All writes go through the trusted Express server (and the scrapers), which
--     use the SERVICE_ROLE key. The service role bypasses RLS by design, so no
--     write policy is needed for it — RLS simply blocks everyone else.
--
-- This closes the hole where the anon key (shipped in the frontend bundle) could
-- be extracted and used to forge reviews or tamper with the catalog.

-- ── Catalog tables: public read, no anon write ──────────────────────────────
alter table public.courses     enable row level security;
alter table public.terms       enable row level security;
alter table public.professors  enable row level security;

drop policy if exists "courses_public_read"    on public.courses;
drop policy if exists "terms_public_read"       on public.terms;
drop policy if exists "professors_public_read"  on public.professors;

create policy "courses_public_read"   on public.courses    for select using (true);
create policy "terms_public_read"     on public.terms      for select using (true);
create policy "professors_public_read" on public.professors for select using (true);
-- (No insert/update/delete policies => only the service role can write.)

-- ── Ratings: public read, no anon write ─────────────────────────────────────
-- Writes are performed by the server with the service role, AFTER it has
-- verified the caller's Clerk token and resolved their app user id. So the
-- anon role gets read-only; the server owns all inserts/updates.
alter table public.course_ratings    enable row level security;
alter table public.professor_ratings enable row level security;

drop policy if exists "course_ratings_public_read"    on public.course_ratings;
drop policy if exists "professor_ratings_public_read" on public.professor_ratings;

create policy "course_ratings_public_read"    on public.course_ratings    for select using (true);
create policy "professor_ratings_public_read" on public.professor_ratings for select using (true);

-- ── users table: no anon access at all ──────────────────────────────────────
-- The frontend resolves the app user via the Clerk-authenticated Supabase
-- client; the server resolves it with the service role. Neither needs the anon
-- role to touch this table, so leave it with RLS on and no anon policy.
alter table public.users enable row level security;

-- Optional: if the frontend's authenticated (Clerk-JWT) Supabase client needs
-- to read/update its own row, add a scoped policy. Example (adjust the JWT
-- claim to match your Clerk/Supabase setup):
--
--   drop policy if exists "users_self_rw" on public.users;
--   create policy "users_self_rw" on public.users
--     using (clerk_user_id = auth.jwt() ->> 'sub')
--     with check (clerk_user_id = auth.jwt() ->> 'sub');

-- ── schedules / favorites: per-user access via authenticated client ──────────
-- If these are read/written by the Clerk-authenticated Supabase client (not the
-- server), scope them to the owner. Adjust the owning column + JWT claim to
-- your schema before enabling.
--
--   alter table public.schedules enable row level security;
--   drop policy if exists "schedules_owner_rw" on public.schedules;
--   create policy "schedules_owner_rw" on public.schedules
--     using (user_id = (select id from public.users where clerk_user_id = auth.jwt() ->> 'sub'))
--     with check (user_id = (select id from public.users where clerk_user_id = auth.jwt() ->> 'sub'));
--
--   alter table public.favorites enable row level security;
--   drop policy if exists "favorites_owner_rw" on public.favorites;
--   create policy "favorites_owner_rw" on public.favorites
--     using (user_id = (select id from public.users where clerk_user_id = auth.jwt() ->> 'sub'))
--     with check (user_id = (select id from public.users where clerk_user_id = auth.jwt() ->> 'sub'));
