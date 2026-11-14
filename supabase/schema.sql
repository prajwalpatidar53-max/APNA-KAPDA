-- ============================================================================
-- APNA KAPDA — Complete Supabase PostgreSQL Schema, Triggers & RLS Policies
-- Safe & non-destructive: checks existing structures before creating/altering.
-- Run this script in: Supabase Dashboard -> SQL Editor -> New Query.
-- ============================================================================

-- 0. INSPECT EXISTING TABLES (non-destructive check logged as notices)
do $$
declare
  tbl text;
  cols text;
begin
  foreach tbl in array array['profiles', 'products', 'orders', 'order_items', 'newsletter_subscribers']
  loop
    select string_agg(column_name || ' (' || data_type || ')', ', ' order by ordinal_position)
      into cols
      from information_schema.columns
      where table_schema = 'public' and table_name = tbl;

    if cols is not null then
      raise notice 'Existing table public.% found with columns: %', tbl, cols;
    else
      raise notice 'Table public.% does not exist yet — will be created.', tbl;
    end if;
  end loop;
end $$;

-- Ensure UUID generation function is available
create extension if not exists pgcrypto;

-- ============================================================================
-- 1. PROFILES TABLE (extends auth.users)
-- ============================================================================
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  full_name text not null default '',
  email text,
  phone text not null default '',
  role text not null default 'customer' check (role in ('customer', 'admin')),
  default_address jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Non-destructive column checks if public.profiles already existed
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists role text not null default 'customer';
alter table public.profiles add column if not exists default_address jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Helper function to safely check admin role without RLS infinite recursion
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Trigger function: auto-create customer profile when a user signs up via Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    'customer'
  )
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email),
        full_name = case
          when coalesce(public.profiles.full_name, '') = ''
          then coalesce(excluded.full_name, '')
          else public.profiles.full_name
        end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill profiles safely for any auth.users created before this schema was run
insert into public.profiles (id, full_name, email, role)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  u.email,
  'customer'
from auth.users u
on conflict (id) do nothing;

-- Trigger function: block role self-escalation from PostgREST API calls
-- (Allows SQL Editor / postgres superuser to promote an admin safely)
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if current_user in ('authenticated', 'anon') and not public.is_admin() then
      raise exception 'Only administrators can change user roles.';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute procedure public.prevent_role_escalation();

-- Reusable updated_at trigger for products and orders
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 2. PRODUCTS TABLE (INR pricing, sizes, stock, active flag)
-- ============================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text not null default '',
  category text not null check (category in ('Men', 'Women', 'Unisex')),
  garment_type text not null,
  price_inr integer not null check (price_inr > 0),
  compare_at_price_inr integer check (compare_at_price_inr is null or compare_at_price_inr >= 0),
  tag text not null default 'NEW DROP',
  fabric_care text not null default '100% Breathable Cotton · Gentle Cold Wash',
  sizes text[] not null default array['XS', 'S', 'M', 'L', 'XL'],
  colors text[] not null default array[]::text[],
  stock_count integer not null default 25 check (stock_count >= 0),
  image_url text not null,
  gallery_images text[] not null default array[]::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products add column if not exists description text not null default '';
alter table public.products add column if not exists compare_at_price_inr integer;
alter table public.products add column if not exists tag text not null default 'NEW DROP';
alter table public.products add column if not exists fabric_care text not null default '100% Breathable Cotton · Gentle Cold Wash';
alter table public.products add column if not exists sizes text[] not null default array['XS', 'S', 'M', 'L', 'XL'];
alter table public.products add column if not exists colors text[] not null default array[]::text[];
alter table public.products add column if not exists stock_count integer not null default 25;
alter table public.products add column if not exists gallery_images text[] not null default array[]::text[];
alter table public.products add column if not exists is_active boolean not null default true;
alter table public.products add column if not exists created_at timestamptz not null default now();
alter table public.products add column if not exists updated_at timestamptz not null default now();

create index if not exists products_category_active_idx
  on public.products (is_active, category, created_at desc);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- 3. ORDERS TABLE (Customer orders, COD & pending online payment statuses)
-- ============================================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text unique not null,
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  shipping_address jsonb not null,
  payment_method text not null check (payment_method in ('cod', 'online_pending')),
  payment_status text not null check (payment_status in ('cod_due', 'awaiting_payment', 'paid', 'failed', 'refunded')),
  order_status text not null default 'pending' check (order_status in ('pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled')),
  subtotal_inr integer not null check (subtotal_inr >= 0),
  shipping_inr integer not null check (shipping_inr >= 0),
  total_inr integer not null check (total_inr >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists notes text;
alter table public.orders add column if not exists created_at timestamptz not null default now();
alter table public.orders add column if not exists updated_at timestamptz not null default now();

create index if not exists orders_user_id_created_idx
  on public.orders (user_id, created_at desc);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- 4. ORDER ITEMS TABLE
-- ============================================================================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade not null,
  product_uuid uuid references public.products(id) on delete set null,
  product_id text not null,
  product_name text not null,
  product_image text,
  selected_size text not null,
  unit_price_inr integer not null check (unit_price_inr > 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

alter table public.order_items add column if not exists product_uuid uuid references public.products(id) on delete set null;
alter table public.order_items add column if not exists product_image text;
alter table public.order_items add column if not exists created_at timestamptz not null default now();

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

-- ============================================================================
-- 5. NEWSLETTER SUBSCRIBERS TABLE
-- ============================================================================
create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.newsletter_subscribers enable row level security;

-- PROFILES POLICIES
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "Users can insert own customer profile" on public.profiles;
create policy "Users can insert own customer profile"
  on public.profiles for insert
  with check (auth.uid() = id and role = 'customer');

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or (
      auth.uid() = id
      and role = (select p.role from public.profiles p where p.id = auth.uid())
    )
  );

-- PRODUCTS POLICIES
drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products"
  on public.products for select
  using (is_active = true or public.is_admin());

drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products"
  on public.products for insert
  with check (public.is_admin());

drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
  on public.products for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products"
  on public.products for delete
  using (public.is_admin());

-- ORDERS POLICIES
drop policy if exists "Customers can view own orders" on public.orders;
create policy "Customers can view own orders"
  on public.orders for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Authenticated customers can create own orders" on public.orders;
create policy "Authenticated customers can create own orders"
  on public.orders for insert
  with check (
    auth.uid() = user_id
    and order_status = 'pending'
    and (
      (payment_method = 'cod' and payment_status = 'cod_due')
      or (payment_method = 'online_pending' and payment_status = 'awaiting_payment')
    )
  );

drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders"
  on public.orders for update
  using (public.is_admin())
  with check (public.is_admin());

-- ORDER ITEMS POLICIES
drop policy if exists "Users can view own order items" on public.order_items;
create policy "Users can view own order items"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and (orders.user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "Users can insert own order items" on public.order_items;
create policy "Users can insert own order items"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.user_id = auth.uid()
    )
  );

-- NEWSLETTER POLICIES
drop policy if exists "Anyone can subscribe to newsletter" on public.newsletter_subscribers;
create policy "Anyone can subscribe to newsletter"
  on public.newsletter_subscribers for insert
  with check (true);

drop policy if exists "Admins can view subscribers" on public.newsletter_subscribers;
create policy "Admins can view subscribers"
  on public.newsletter_subscribers for select
  using (public.is_admin());

-- ============================================================================
-- 7. STORAGE BUCKET & RLS POLICIES (Product Media)
-- ============================================================================
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

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
  on storage.objects for update
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
  on storage.objects for delete
  using (bucket_id = 'product-images' and public.is_admin());

-- Refresh PostgREST schema cache so REST endpoints immediately see new tables
notify pgrst, 'reload schema';
