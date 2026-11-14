-- ============================================================================
-- APNA KAPDA — Non-Destructive Admin Portal & Product Media Migration
-- Safe to run on top of existing tables without dropping or overwriting data.
-- Run in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

-- 1. Add colours & multi-image gallery columns to existing public.products
alter table public.products
  add column if not exists colors text[] not null default array[]::text[];

alter table public.products
  add column if not exists gallery_images text[] not null default array[]::text[];

-- Backfill gallery_images with existing image_url only where gallery_images is empty
update public.products
set gallery_images = array[image_url]
where coalesce(array_length(gallery_images, 1), 0) = 0
  and coalesce(image_url, '') <> '';

-- 2. Create public Storage bucket for product photography (if not present)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

-- 3. Secure Storage RLS Policies (Public read, Admin-only write/update/delete)
drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and public.is_admin()
  );

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
  on storage.objects for update
  using (
    bucket_id = 'product-images'
    and public.is_admin()
  )
  with check (
    bucket_id = 'product-images'
    and public.is_admin()
  );

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
  on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and public.is_admin()
  );

-- 4. Refresh PostgREST schema cache so new columns & bucket are immediately available
notify pgrst, 'reload schema';

-- 5. Verify your admin account (replace with your actual registered email)
-- Example:
-- update public.profiles
-- set role = 'admin'
-- where lower(email) = lower('your-admin-email@example.com');
