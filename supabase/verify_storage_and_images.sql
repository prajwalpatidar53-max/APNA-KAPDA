-- ============================================================================
-- APNA KAPDA — Non-Destructive Storage & Product Image Audit Script
-- Does NOT delete, replace, or re-upload any existing product images or rows.
-- Run in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

-- 1. Inspect existing Storage buckets and public/private flags
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by created_at desc;

-- 2. Ensure product-images bucket is publicly readable without touching existing files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
  set public = true;

-- 3. Ensure public SELECT access policy exists on storage.objects for product-images
drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- 4. Read-only audit of stored product image_url values (checks for dev/localhost/relative URLs)
select
  id,
  name,
  slug,
  is_active,
  image_url,
  case
    when coalesce(image_url, '') = '' then 'EMPTY_URL'
    when image_url ~* '(localhost|127\.0\.0\.1|/src/assets/)' then 'LOCAL_DEV_PATH'
    when image_url ~* '^/assets/' then 'BUILD_HASHED_ASSET_PATH'
    when image_url ~* '/storage/v1/object/sign/' then 'SIGNED_EXPIRING_URL'
    when image_url ~* '/storage/v1/object/authenticated/' then 'AUTHENTICATED_PATH'
    when image_url ~* '^https://.*\.supabase\.co/storage/v1/object/public/' then 'SUPABASE_PUBLIC_URL_OK'
    else 'OTHER_URL'
  end as url_status
from public.products
order by created_at desc;
