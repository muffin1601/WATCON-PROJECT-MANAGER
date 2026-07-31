-- This application has NO authentication (public, single-tenant internal tool).
-- All database access happens server-side via Prisma using the service-role /
-- direct Postgres connection, which bypasses RLS entirely. RLS is left OFF
-- on every table below intentionally — do not enable "authenticated"-only
-- policies here, there are no authenticated users in this app.
--
-- The only thing this file configures is Supabase Storage, since file
-- uploads/downloads go through the Supabase JS client using the anon key
-- from the browser (documents preview/download) as well as server-side
-- writes with the service role key.

insert into storage.buckets (id, name, public)
values ('watcon-documents', 'watcon-documents', true)
on conflict (id) do update set public = true;

-- Public bucket: anyone with the object path can read (matches the
-- prototype's "no login" model). Writes/deletes still require the
-- service role key from server-side route handlers.
create policy "public read watcon-documents"
  on storage.objects for select to public
  using (bucket_id = 'watcon-documents');
