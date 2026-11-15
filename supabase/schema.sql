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
set search_path = pg_catalog
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- Trigger function: auto-create customer profile when a user signs up via Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
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

revoke all on function public.handle_new_user() from public, anon, authenticated;

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
set search_path = pg_catalog
as $$
begin
  if new.role is distinct from old.role then
    if current_user in ('authenticated', 'anon') and not public.is_admin() then
      raise exception 'Only administrators can change user roles.';
    end if;
  end if;
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.prevent_role_escalation() from public, anon, authenticated;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute procedure public.prevent_role_escalation();

-- Reusable updated_at trigger for products and orders
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

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
  size_stock jsonb not null default '{}'::jsonb,
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
alter table public.products add column if not exists size_stock jsonb not null default '{}'::jsonb;
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
  payment_status text not null check (payment_status in ('cod_due', 'awaiting_payment', 'paid', 'refund_pending', 'failed', 'refunded', 'cancelled')),
  order_status text not null default 'pending' check (order_status in ('pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled')),
  subtotal_inr integer not null check (subtotal_inr >= 0),
  shipping_inr integer not null check (shipping_inr >= 0),
  total_inr integer not null check (total_inr >= 0),
  notes text,
  idempotency_key text,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('customer', 'admin')),
  cancelled_by_user_id uuid references auth.users(id) on delete set null,
  cancellation_reason text,
  stock_deducted boolean not null default false,
  stock_restored boolean not null default false,
  stock_restoration_status text not null default 'not_applicable' check (stock_restoration_status in ('not_applicable', 'pending', 'restored', 'partial', 'failed')),
  refund_status text not null default 'none' check (refund_status in ('none', 'not_required', 'pending', 'processed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists notes text;
alter table public.orders add column if not exists idempotency_key text;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancelled_by text;
alter table public.orders add column if not exists cancelled_by_user_id uuid references auth.users(id) on delete set null;
alter table public.orders add column if not exists cancellation_reason text;
alter table public.orders add column if not exists stock_deducted boolean not null default false;
alter table public.orders add column if not exists stock_restored boolean not null default false;
alter table public.orders add column if not exists stock_restoration_status text not null default 'not_applicable';
alter table public.orders add column if not exists refund_status text not null default 'none';
alter table public.orders add column if not exists created_at timestamptz not null default now();
alter table public.orders add column if not exists updated_at timestamptz not null default now();

create index if not exists orders_user_id_created_idx
  on public.orders (user_id, created_at desc);

create unique index if not exists orders_user_idempotency_key_idx
  on public.orders (user_id, idempotency_key)
  where idempotency_key is not null;

do $$
declare
  v_has_unique_order_number boolean;
  v_dup_order_numbers text;
begin
  select exists (
    select 1
      from pg_catalog.pg_index idx
      join pg_catalog.pg_class rel on rel.oid = idx.indrelid
      join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
      join pg_catalog.pg_attribute att
        on att.attrelid = rel.oid
       and att.attnum = idx.indkey[0]
     where nsp.nspname = 'public'
       and rel.relname = 'orders'
       and idx.indisunique
       and idx.indisvalid
       and idx.indnatts = 1
       and idx.indpred is null
       and att.attname = 'order_number'
       and not att.attisdropped
  )
    into v_has_unique_order_number;

  if not v_has_unique_order_number then
    select pg_catalog.string_agg(dup_num, ', ')
      into v_dup_order_numbers
      from (
        select coalesce(order_number, '<NULL>') as dup_num
          from public.orders
         group by order_number
        having pg_catalog.count(*) > 1
         limit 10
      ) d;

    if v_dup_order_numbers is not null then
      raise exception
        'Cannot add UNIQUE constraint on public.orders.order_number because duplicate values exist: %. Resolve duplicates first.',
        v_dup_order_numbers;
    end if;

    alter table public.orders
      add constraint orders_order_number_unique unique (order_number);
  end if;
end $$;

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
  stock_deducted boolean not null default false,
  stock_restored boolean not null default false,
  stock_restoration_status text not null default 'not_applicable' check (stock_restoration_status in ('not_applicable', 'deducted', 'restored', 'failed')),
  stock_restoration_error text,
  stock_tracking_mode text not null default 'legacy' check (stock_tracking_mode in ('legacy', 'total_only', 'size_stock', 'none')),
  created_at timestamptz not null default now()
);

alter table public.order_items add column if not exists product_uuid uuid references public.products(id) on delete set null;
alter table public.order_items add column if not exists product_image text;
alter table public.order_items add column if not exists stock_deducted boolean not null default false;
alter table public.order_items add column if not exists stock_restored boolean not null default false;
alter table public.order_items add column if not exists stock_restoration_status text not null default 'not_applicable';
alter table public.order_items add column if not exists stock_restoration_error text;
alter table public.order_items add column if not exists stock_tracking_mode text not null default 'legacy';
alter table public.order_items add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.order_items'::regclass
       and con.conname = 'order_items_stock_tracking_mode_check'
  ) then
    alter table public.order_items
      add constraint order_items_stock_tracking_mode_check
      check (stock_tracking_mode in ('legacy', 'total_only', 'size_stock', 'none'));
  end if;
end $$;

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

-- ORDERS & ORDER ITEMS POLICIES + DIRECT INSERT HARDENING
revoke insert on table public.orders from public, anon;
revoke insert on table public.order_items from public, anon;

do $$
declare
  v_tbl text;
  v_relid oid;
  v_pol record;
  v_roles_sql text;
  v_using_sql text;
  v_check_sql text;
  v_update_check_sql text;
  v_new_name text;
begin
  foreach v_tbl in array array['orders', 'order_items']
  loop
    v_relid := ('public.' || v_tbl)::regclass;

    for v_pol in
      select p.oid,
             p.polname,
             p.polcmd,
             p.polpermissive,
             p.polroles,
             pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr,
             pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
        from pg_catalog.pg_policy p
       where p.polrelid = v_relid
         and (p.polcmd = 'a' or (p.polcmd = '*' and p.polpermissive))
       order by p.polname
    loop
      if v_pol.polcmd = 'a' then
        execute pg_catalog.format('drop policy if exists %I on public.%I', v_pol.polname, v_tbl);
      elsif v_pol.polcmd = '*' and v_pol.polpermissive then
        if array[0::oid] = v_pol.polroles or coalesce(pg_catalog.array_length(v_pol.polroles, 1), 0) = 0 then
          v_roles_sql := 'public';
        else
          select pg_catalog.string_agg(pg_catalog.quote_ident(r.rolname), ', ' order by ord)
            into v_roles_sql
            from pg_catalog.unnest(v_pol.polroles) with ordinality as pr(roid, ord)
            join pg_catalog.pg_roles r on r.oid = pr.roid;
        end if;

        v_using_sql := v_pol.using_expr;
        v_check_sql := v_pol.check_expr;

        execute pg_catalog.format('drop policy if exists %I on public.%I', v_pol.polname, v_tbl);

        if v_using_sql is not null then
          v_update_check_sql := coalesce(v_check_sql, v_using_sql);

          v_new_name := pg_catalog.left(v_pol.polname, 54) || ' (select)';
          if exists (select 1 from pg_catalog.pg_policy p2 where p2.polrelid = v_relid and p2.polname = v_new_name) then
            v_new_name := pg_catalog.left(v_pol.polname, 46) || ' (select ' || v_pol.oid::text || ')';
          end if;
          execute pg_catalog.format(
            'create policy %I on public.%I as permissive for select to %s using (%s)',
            v_new_name, v_tbl, v_roles_sql, v_using_sql
          );

          v_new_name := pg_catalog.left(v_pol.polname, 54) || ' (update)';
          if exists (select 1 from pg_catalog.pg_policy p2 where p2.polrelid = v_relid and p2.polname = v_new_name) then
            v_new_name := pg_catalog.left(v_pol.polname, 46) || ' (update ' || v_pol.oid::text || ')';
          end if;
          execute pg_catalog.format(
            'create policy %I on public.%I as permissive for update to %s using (%s) with check (%s)',
            v_new_name, v_tbl, v_roles_sql, v_using_sql, v_update_check_sql
          );

          v_new_name := pg_catalog.left(v_pol.polname, 54) || ' (delete)';
          if exists (select 1 from pg_catalog.pg_policy p2 where p2.polrelid = v_relid and p2.polname = v_new_name) then
            v_new_name := pg_catalog.left(v_pol.polname, 46) || ' (delete ' || v_pol.oid::text || ')';
          end if;
          execute pg_catalog.format(
            'create policy %I on public.%I as permissive for delete to %s using (%s)',
            v_new_name, v_tbl, v_roles_sql, v_using_sql
          );
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- ORDERS POLICIES
drop policy if exists "Customers can view own orders" on public.orders;
create policy "Customers can view own orders"
  on public.orders for select
  using (auth.uid() = user_id or public.is_admin());

create policy "Admins can insert orders"
  on public.orders for insert
  to authenticated
  with check (public.is_admin());

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

create policy "Admins can insert order items"
  on public.order_items for insert
  to authenticated
  with check (public.is_admin());

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

-- ============================================================================
-- 8. ATOMIC ORDER CREATION, STOCK DEDUCTION & ORDER CANCELLATION RPCs
-- ============================================================================
create or replace function public.catalog_has_real_products()
returns boolean
language sql
security definer
set search_path = pg_catalog
stable
as $$
  select exists (
    select 1
      from public.products
  );
$$;

revoke all on function public.catalog_has_real_products() from public;
grant execute on function public.catalog_has_real_products() to anon, authenticated;

create or replace function public.decrement_stock_on_order_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_prod public.products%rowtype;
  v_clean_pid text;
  v_uuid_from_pid uuid;
  v_lookup_uuid uuid;
  v_next_size_stock jsonb;
  v_has_size_inventory boolean := false;
  v_size_stock_key_count integer := 0;
  v_size_stock_distinct_count integer := 0;
  v_has_blank_size_key boolean := false;
  v_size_match_count integer := 0;
  v_size_key text;
  v_size_val_type text;
  v_size_val_text text;
  v_curr_size_big bigint;
  v_updated_rows integer;
  v_matched_size text;
begin
  if new.quantity is null or new.quantity <= 0 then
    raise exception 'Order item quantity must be at least 1.';
  end if;

  if nullif(trim(coalesce(new.selected_size, '')), '') is null then
    raise exception 'Order item must specify a valid selected_size.';
  end if;

  if new.unit_price_inr is null or new.unit_price_inr <= 0 then
    raise exception 'Order item unit_price_inr must be a positive integer.';
  end if;

  v_clean_pid := trim(coalesce(new.product_id, ''));

  if v_clean_pid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid_from_pid := v_clean_pid::uuid;
  else
    v_uuid_from_pid := null;
  end if;

  if new.product_uuid is not null and v_uuid_from_pid is not null and new.product_uuid <> v_uuid_from_pid then
    raise exception 'Order item product_uuid (%) and product_id (%) do not refer to the same product.',
      new.product_uuid, v_clean_pid;
  end if;

  v_lookup_uuid := coalesce(new.product_uuid, v_uuid_from_pid);

  if v_lookup_uuid is null and v_clean_pid = '' then
    raise exception 'Order item must specify product_uuid or product_id.';
  end if;

  if v_lookup_uuid is not null then
    select p.*
      into v_prod
      from public.products p
     where p.id = v_lookup_uuid
     for update;

    if found and v_clean_pid <> '' then
      if not (
        v_clean_pid = v_prod.id::text
        or v_clean_pid = v_prod.slug
      ) then
        raise exception 'Order item product_uuid (%) does not match product_id (%) for "%".',
          v_lookup_uuid, v_clean_pid, v_prod.name;
      end if;
    end if;
  else
    select p.*
      into v_prod
      from public.products p
     where p.slug = v_clean_pid
     limit 1
     for update;
  end if;

  if not found then
    raise exception 'Product "%" (id: %) was not found in Supabase inventory. Checkout rejected.',
      coalesce(nullif(trim(coalesce(new.product_name, '')), ''), 'Unknown Product'),
      coalesce(v_lookup_uuid::text, v_clean_pid);
  end if;

  if v_prod.is_active is distinct from true then
    raise exception 'Product "%" is no longer active and cannot be purchased.', v_prod.name;
  end if;

  if v_prod.price_inr is null or v_prod.price_inr <= 0 then
    raise exception 'Product "%" has an invalid catalog price (%) in Supabase.',
      v_prod.name, coalesce(v_prod.price_inr::text, 'NULL');
  end if;

  if new.unit_price_inr <> v_prod.price_inr then
    raise exception 'Unit price mismatch for "%" (submitted ₹%, authoritative ₹%).',
      v_prod.name, new.unit_price_inr, v_prod.price_inr;
  end if;

  -- Unconditional clothing size validation (never skipped even if sizes or size_stock is empty)
  if v_prod.sizes is null or coalesce(pg_catalog.array_length(v_prod.sizes, 1), 0) = 0 then
    raise exception 'Product "%" has no valid sizes configured in Supabase and cannot be ordered.',
      v_prod.name;
  end if;

  if exists (
    select 1
      from pg_catalog.unnest(v_prod.sizes) as sz
     where nullif(trim(coalesce(sz, '')), '') is null
  ) then
    raise exception 'Product "%" contains blank or invalid entries in its configured sizes.',
      v_prod.name;
  end if;

  if (
    select pg_catalog.count(distinct pg_catalog.lower(trim(sz)))
      from pg_catalog.unnest(v_prod.sizes) as sz
  ) <> pg_catalog.array_length(v_prod.sizes, 1) then
    raise exception 'Product "%" has duplicate sizes configured. Fix size configuration before checkout.',
      v_prod.name;
  end if;

  select trim(sz)
    into v_matched_size
    from pg_catalog.unnest(v_prod.sizes) as sz
   where pg_catalog.lower(trim(sz)) = pg_catalog.lower(trim(new.selected_size))
   limit 1;

  if v_matched_size is null then
    raise exception 'Size "%" is not available for "%".',
      new.selected_size, v_prod.name;
  end if;

  -- Enforce canonical product identity & metadata from public.products
  new.product_uuid := v_prod.id;
  new.product_id := v_prod.id::text;
  new.product_name := v_prod.name;
  new.product_image := nullif(trim(coalesce(v_prod.image_url, '')), '');

  -- Explicitly reject NULL or negative total stock_count before deduction
  if v_prod.stock_count is null or v_prod.stock_count < 0 then
    raise exception 'Product "%" has an invalid total stock_count (%). Checkout rejected.',
      v_prod.name, coalesce(v_prod.stock_count::text, 'NULL');
  end if;

  -- Reject checkout if requested quantity exceeds total product stock
  if v_prod.stock_count < new.quantity then
    raise exception 'Insufficient stock for "%" (requested %, available %).',
      v_prod.name, new.quantity, v_prod.stock_count;
  end if;

  v_next_size_stock := coalesce(v_prod.size_stock, '{}'::jsonb);

  if pg_catalog.jsonb_typeof(v_next_size_stock) <> 'object' then
    raise exception 'Invalid size_stock configuration for "%": expected JSON object.', v_prod.name;
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(distinct pg_catalog.lower(trim(k)))::integer,
         bool_or(nullif(trim(k), '') is null)
    into v_size_stock_key_count, v_size_stock_distinct_count, v_has_blank_size_key
    from pg_catalog.jsonb_object_keys(v_next_size_stock) as k;

  v_has_size_inventory := v_size_stock_key_count > 0;

  if v_has_size_inventory then
    if coalesce(v_has_blank_size_key, false) then
      raise exception 'Product "%" contains blank size key(s) in size_stock.', v_prod.name;
    end if;

    if v_size_stock_key_count <> v_size_stock_distinct_count then
      raise exception 'Ambiguous duplicate size keys detected in size_stock for "%". Clean up duplicate size keys before checkout.',
        v_prod.name;
    end if;

    select pg_catalog.count(*)::integer, pg_catalog.min(k)
      into v_size_match_count, v_size_key
      from pg_catalog.jsonb_object_keys(v_next_size_stock) as k
     where pg_catalog.lower(trim(k)) = pg_catalog.lower(trim(new.selected_size));

    if v_size_match_count <> 1 or v_size_key is null then
      raise exception 'Size "%" is not available in size inventory for "%".',
        new.selected_size, v_prod.name;
    end if;

    v_size_val_type := pg_catalog.jsonb_typeof(v_next_size_stock -> v_size_key);
    v_size_val_text := v_next_size_stock ->> v_size_key;

    if v_size_val_type not in ('number', 'string')
       or v_size_val_text is null
       or v_size_val_text !~ '^\d+$'
       or pg_catalog.length(v_size_val_text) > 10 then
      raise exception 'Invalid or non-numeric stock count for "%" in size "%" (stored value: %).',
        v_prod.name, new.selected_size, coalesce(v_size_val_text, 'null');
    end if;

    v_curr_size_big := v_size_val_text::bigint;
    if v_curr_size_big < 0 or v_curr_size_big > 2147483647 then
      raise exception 'Out-of-range size stock count (%) for "%" in size "%".',
        v_size_val_text, v_prod.name, new.selected_size;
    end if;

    if v_curr_size_big < new.quantity::bigint then
      raise exception 'Insufficient stock for "%" in size % (requested %, available %).',
        v_prod.name, v_size_key, new.quantity, v_curr_size_big;
    end if;

    new.selected_size := trim(v_size_key);

    v_next_size_stock := pg_catalog.jsonb_set(
      v_next_size_stock,
      array[v_size_key],
      pg_catalog.to_jsonb((v_curr_size_big - new.quantity::bigint)::integer),
      true
    );
  else
    new.selected_size := v_matched_size;
  end if;

  update public.products
     set stock_count = v_prod.stock_count - new.quantity,
         size_stock = v_next_size_stock,
         updated_at = pg_catalog.now()
   where id = v_prod.id
     and stock_count is not null
     and stock_count >= new.quantity;

  get diagnostics v_updated_rows = row_count;
  if v_updated_rows <> 1 then
    raise exception 'Concurrent stock update prevented deduction for "%". Retry checkout.', v_prod.name;
  end if;

  new.stock_deducted := true;
  new.stock_restored := false;
  new.stock_restoration_status := 'deducted';
  new.stock_restoration_error := null;
  new.stock_tracking_mode := case when v_has_size_inventory then 'size_stock' else 'total_only' end;

  update public.orders
     set stock_deducted = true,
         stock_restoration_status = case
           when stock_restoration_status = 'not_applicable' then 'pending'
           else stock_restoration_status
         end
   where id = new.order_id;

  return new;
end;
$$;

revoke all on function public.decrement_stock_on_order_item() from public, anon, authenticated;

drop trigger if exists order_items_decrement_stock on public.order_items;
create trigger order_items_decrement_stock
  before insert on public.order_items
  for each row execute procedure public.decrement_stock_on_order_item();

drop function if exists public.create_order_atomic(
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb
);

create or replace function public.create_order_atomic(
  p_order_number text default null,
  p_customer_name text default null,
  p_customer_email text default null,
  p_customer_phone text default null,
  p_shipping_address jsonb default null,
  p_payment_method text default null,
  p_subtotal_inr integer default null,
  p_shipping_inr integer default null,
  p_total_inr integer default null,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid;
  v_idempotency_key text;
  v_customer_name text;
  v_customer_email text;
  v_customer_phone text;
  v_req_order_number text;
  v_order_number text;
  v_rand_bytes bytea;
  v_rand_int integer;
  v_attempt integer;
  v_ins_attempt integer;
  v_conflict_constraint text;
  v_payment_status text;
  v_order public.orders%rowtype;
  v_item record;
  v_prod public.products%rowtype;
  v_uuid_from_field uuid;
  v_uuid_from_pid uuid;
  v_product_uuid uuid;
  v_qty_type text;
  v_qty_text text;
  v_qty_big bigint;
  v_qty integer;
  v_client_price_type text;
  v_client_price_text text;
  v_client_price_big bigint;
  v_client_unit_price integer;
  v_auth_unit_price integer;
  v_resolved_product_uuid uuid;
  v_resolved_product_id text;
  v_resolved_product_name text;
  v_resolved_product_image text;
  v_resolved_selected_size text;
  v_matched_size text;
  v_prod_size_stock jsonb;
  v_has_size_inventory boolean := false;
  v_size_stock_key_count integer := 0;
  v_size_stock_distinct_count integer := 0;
  v_has_blank_size_key boolean := false;
  v_size_match_count integer := 0;
  v_size_key text;
  v_size_val_type text;
  v_size_val_text text;
  v_curr_size_big bigint;
  v_line_total_big bigint;
  v_calc_subtotal_big bigint := 0;
  v_calc_subtotal_inr integer;
  v_calc_shipping_inr integer;
  v_calc_total_big bigint;
  v_calc_total_inr integer;
  v_resolved_items jsonb := '[]'::jsonb;
  v_resolved_elem jsonb;
  v_items_json jsonb;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Authentication required to place an order.';
  end if;

  v_idempotency_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_idempotency_key is not null and pg_catalog.length(v_idempotency_key) > 128 then
    raise exception 'Invalid idempotency key length.';
  end if;

  if v_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_uid::text || ':' || v_idempotency_key)
    );

    select *
      into v_order
      from public.orders o
     where o.user_id = v_uid
       and o.idempotency_key = v_idempotency_key
     limit 1;

    if found then
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(oi) order by oi.created_at, oi.id)
        into v_items_json
        from public.order_items oi
       where oi.order_id = v_order.id;

      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.to_jsonb(v_order),
        'order_items', coalesce(v_items_json, '[]'::jsonb)
      );
    end if;
  end if;

  v_customer_name := nullif(trim(coalesce(p_customer_name, '')), '');
  v_customer_email := coalesce(
    nullif(trim(coalesce(p_customer_email, '')), ''),
    (select nullif(trim(p.email), '') from public.profiles p where p.id = v_uid),
    (select nullif(trim(u.email), '') from auth.users u where u.id = v_uid)
  );
  v_customer_phone := nullif(trim(coalesce(p_customer_phone, '')), '');

  if v_customer_name is null
     or v_customer_email is null
     or v_customer_phone is null then
    raise exception 'Customer contact details (name, email, phone) are required.';
  end if;

  v_req_order_number := nullif(trim(coalesce(p_order_number, '')), '');
  if v_req_order_number is not null and v_req_order_number !~ '^AK-[0-9]{6}$' then
    raise exception 'Invalid order number format (%). Expected AK-XXXXXX.', v_req_order_number;
  end if;

  if p_shipping_address is null
     or pg_catalog.jsonb_typeof(p_shipping_address) <> 'object'
     or p_shipping_address = '{}'::jsonb then
    raise exception 'Valid shipping address object is required.';
  end if;

  if nullif(trim(coalesce(p_shipping_address ->> 'line1', '')), '') is null
     or nullif(trim(coalesce(p_shipping_address ->> 'city', '')), '') is null
     or nullif(trim(coalesce(p_shipping_address ->> 'state', '')), '') is null
     or trim(coalesce(p_shipping_address ->> 'pincode', '')) !~ '^[0-9]{6}$' then
    raise exception 'Complete shipping address (line1, city, state, and 6-digit pincode) is required.';
  end if;

  if p_payment_method = 'cod' then
    v_payment_status := 'cod_due';
  elsif p_payment_method = 'online_pending' then
    v_payment_status := 'awaiting_payment';
  else
    raise exception 'Unsupported payment method: %', coalesce(p_payment_method, 'null');
  end if;

  if (p_subtotal_inr is not null and p_subtotal_inr < 0)
     or (p_shipping_inr is not null and p_shipping_inr < 0)
     or (p_total_inr is not null and p_total_inr < 0) then
    raise exception 'Order monetary totals must be non-negative integers.';
  end if;

  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.';
  end if;

  -- Resolve, lock, and validate every item in deterministic order before creating order.
  for v_item in
    select
      elem,
      nullif(trim(coalesce(elem ->> 'product_uuid', '')), '') as raw_product_uuid,
      trim(coalesce(elem ->> 'product_id', '')) as product_id,
      nullif(trim(coalesce(elem ->> 'product_image', '')), '') as product_image,
      trim(coalesce(elem ->> 'selected_size', '')) as selected_size
    from pg_catalog.jsonb_array_elements(p_items) as elem
    order by coalesce(elem ->> 'product_uuid', elem ->> 'product_id', ''), coalesce(elem ->> 'selected_size', '')
  loop
    if pg_catalog.jsonb_typeof(v_item.elem) <> 'object' then
      raise exception 'Each order item must be a JSON object.';
    end if;

    if v_item.selected_size = '' then
      raise exception 'Each order item must specify a selected_size.';
    end if;

    if v_item.raw_product_uuid is not null then
      if v_item.raw_product_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Malformed product_uuid (%) on order item.', v_item.raw_product_uuid;
      end if;
      v_uuid_from_field := v_item.raw_product_uuid::uuid;
    else
      v_uuid_from_field := null;
    end if;

    if v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_uuid_from_pid := v_item.product_id::uuid;
    else
      v_uuid_from_pid := null;
    end if;

    if v_uuid_from_field is not null and v_uuid_from_pid is not null and v_uuid_from_field <> v_uuid_from_pid then
      raise exception 'Conflicting product_uuid (%) and product_id (%) on order item.',
        v_uuid_from_field, v_uuid_from_pid;
    end if;

    v_product_uuid := coalesce(v_uuid_from_field, v_uuid_from_pid);

    if v_product_uuid is null and v_item.product_id = '' then
      raise exception 'Each order item must specify product_uuid or product_id.';
    end if;

    -- Strictly validate quantity without unsafe direct cast
    v_qty_type := pg_catalog.jsonb_typeof(v_item.elem -> 'quantity');
    v_qty_text := v_item.elem ->> 'quantity';

    if v_qty_type not in ('number', 'string')
       or v_qty_text is null
       or v_qty_text !~ '^\d+$'
       or pg_catalog.length(v_qty_text) > 10 then
      raise exception 'Invalid quantity (%) for item "%".',
        coalesce(v_qty_text, 'null'), coalesce(nullif(v_item.product_id, ''), v_product_uuid::text);
    end if;

    v_qty_big := v_qty_text::bigint;
    if v_qty_big <= 0 or v_qty_big > 2147483647 then
      raise exception 'Order item quantity for "%" must be between 1 and 2147483647.',
        coalesce(nullif(v_item.product_id, ''), v_product_uuid::text);
    end if;
    v_qty := v_qty_big::integer;

    -- Validate client-supplied unit_price_inr if present (never trusted as authoritative)
    if (v_item.elem ? 'unit_price_inr')
       and pg_catalog.jsonb_typeof(v_item.elem -> 'unit_price_inr') <> 'null' then
      v_client_price_type := pg_catalog.jsonb_typeof(v_item.elem -> 'unit_price_inr');
      v_client_price_text := v_item.elem ->> 'unit_price_inr';

      if v_client_price_type not in ('number', 'string')
         or v_client_price_text is null
         or v_client_price_text !~ '^\d+$'
         or pg_catalog.length(v_client_price_text) > 10 then
        raise exception 'Invalid or negative unit_price_inr (%) for item "%".',
          coalesce(v_client_price_text, 'null'), coalesce(nullif(v_item.product_id, ''), v_product_uuid::text);
      end if;

      v_client_price_big := v_client_price_text::bigint;
      if v_client_price_big <= 0 or v_client_price_big > 2147483647 then
        raise exception 'Client unit_price_inr for "%" must be a positive integer.',
          coalesce(nullif(v_item.product_id, ''), v_product_uuid::text);
      end if;
      v_client_unit_price := v_client_price_big::integer;
    else
      v_client_unit_price := null;
    end if;

    if v_product_uuid is not null then
      select p.*
        into v_prod
        from public.products p
       where p.id = v_product_uuid
       for update;

      if found and v_item.product_id <> '' then
        if not (
          v_item.product_id = v_prod.id::text
          or v_item.product_id = v_prod.slug
        ) then
          raise exception 'Order item product_uuid (%) and product_id (%) do not refer to the same product.',
            v_product_uuid, v_item.product_id;
        end if;
      end if;
    else
      select p.*
        into v_prod
        from public.products p
       where p.slug = v_item.product_id
       limit 1
       for update;
    end if;

    if not found then
      raise exception 'Product (id: %) was not found in Supabase inventory. Refresh your bag and try again.',
        coalesce(v_product_uuid::text, v_item.product_id);
    end if;

    if v_prod.is_active is distinct from true then
      raise exception 'Product "%" is no longer active and cannot be ordered.', v_prod.name;
    end if;

    if v_prod.price_inr is null or v_prod.price_inr <= 0 then
      raise exception 'Product "%" does not have a valid positive price in Supabase.', v_prod.name;
    end if;

    v_auth_unit_price := v_prod.price_inr;

    if v_client_unit_price is not null and v_client_unit_price <> v_auth_unit_price then
      raise exception 'Price mismatch for "%" (submitted ₹%, current catalog price ₹%). Refresh your bag and try again.',
        v_prod.name, v_client_unit_price, v_auth_unit_price;
    end if;

    if v_prod.stock_count is null or v_prod.stock_count < 0 then
      raise exception 'Product "%" has an invalid total stock_count (%). Checkout rejected.',
        v_prod.name, coalesce(v_prod.stock_count::text, 'NULL');
    end if;

    if v_prod.stock_count < v_qty then
      raise exception 'Insufficient stock for "%" (requested %, available %).',
        v_prod.name, v_qty, v_prod.stock_count;
    end if;

    if v_prod.sizes is null or coalesce(pg_catalog.array_length(v_prod.sizes, 1), 0) = 0 then
      raise exception 'Product "%" has no valid sizes configured in Supabase and cannot be ordered.',
        v_prod.name;
    end if;

    if exists (
      select 1
        from pg_catalog.unnest(v_prod.sizes) as sz
       where nullif(trim(coalesce(sz, '')), '') is null
    ) then
      raise exception 'Product "%" contains blank or invalid entries in its configured sizes.',
        v_prod.name;
    end if;

    if (
      select pg_catalog.count(distinct pg_catalog.lower(trim(sz)))
        from pg_catalog.unnest(v_prod.sizes) as sz
    ) <> pg_catalog.array_length(v_prod.sizes, 1) then
      raise exception 'Product "%" has duplicate sizes configured. Fix size configuration before checkout.',
        v_prod.name;
    end if;

    select trim(sz)
      into v_matched_size
      from pg_catalog.unnest(v_prod.sizes) as sz
     where pg_catalog.lower(trim(sz)) = pg_catalog.lower(trim(v_item.selected_size))
     limit 1;

    if v_matched_size is null then
      raise exception 'Size "%" is not available for "%".',
        v_item.selected_size, v_prod.name;
    end if;

    v_prod_size_stock := coalesce(v_prod.size_stock, '{}'::jsonb);
    if pg_catalog.jsonb_typeof(v_prod_size_stock) <> 'object' then
      raise exception 'Invalid size_stock configuration for "%": expected JSON object.', v_prod.name;
    end if;

    select pg_catalog.count(*)::integer,
           pg_catalog.count(distinct pg_catalog.lower(trim(k)))::integer,
           bool_or(nullif(trim(k), '') is null)
      into v_size_stock_key_count, v_size_stock_distinct_count, v_has_blank_size_key
      from pg_catalog.jsonb_object_keys(v_prod_size_stock) as k;

    v_has_size_inventory := v_size_stock_key_count > 0;
    v_size_key := null;

    if v_has_size_inventory then
      if coalesce(v_has_blank_size_key, false) then
        raise exception 'Product "%" contains blank size key(s) in size_stock.', v_prod.name;
      end if;

      if v_size_stock_key_count <> v_size_stock_distinct_count then
        raise exception 'Ambiguous duplicate size keys detected in size_stock for "%". Clean up duplicate size keys before checkout.',
          v_prod.name;
      end if;

      select pg_catalog.count(*)::integer, pg_catalog.min(k)
        into v_size_match_count, v_size_key
        from pg_catalog.jsonb_object_keys(v_prod_size_stock) as k
       where pg_catalog.lower(trim(k)) = pg_catalog.lower(trim(v_item.selected_size));

      if v_size_match_count <> 1 or v_size_key is null then
        raise exception 'Size "%" is not available in size inventory for "%".',
          v_item.selected_size, v_prod.name;
      end if;

      v_size_val_type := pg_catalog.jsonb_typeof(v_prod_size_stock -> v_size_key);
      v_size_val_text := v_prod_size_stock ->> v_size_key;

      if v_size_val_type not in ('number', 'string')
         or v_size_val_text is null
         or v_size_val_text !~ '^\d+$'
         or pg_catalog.length(v_size_val_text) > 10 then
        raise exception 'Invalid or non-numeric stock count for "%" in size "%" (stored value: %).',
          v_prod.name, v_item.selected_size, coalesce(v_size_val_text, 'null');
      end if;

      v_curr_size_big := v_size_val_text::bigint;
      if v_curr_size_big < 0 or v_curr_size_big > 2147483647 then
        raise exception 'Out-of-range size stock count (%) for "%" in size "%".',
          v_size_val_text, v_prod.name, v_item.selected_size;
      end if;

      if v_curr_size_big < v_qty::bigint then
        raise exception 'Insufficient stock for "%" in size % (requested %, available %).',
          v_prod.name, v_size_key, v_qty, v_curr_size_big;
      end if;

      v_resolved_selected_size := trim(v_size_key);
    else
      v_resolved_selected_size := v_matched_size;
    end if;

    v_resolved_product_uuid := v_prod.id;
    v_resolved_product_id := v_prod.id::text;
    v_resolved_product_name := v_prod.name;
    v_resolved_product_image := nullif(trim(coalesce(v_prod.image_url, '')), '');

    v_line_total_big := v_auth_unit_price::bigint * v_qty::bigint;
    v_calc_subtotal_big := v_calc_subtotal_big + v_line_total_big;
    if v_calc_subtotal_big > 2147483647 then
      raise exception 'Order subtotal exceeds maximum supported integer amount.';
    end if;

    v_resolved_items := v_resolved_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_uuid', v_resolved_product_uuid,
        'product_id', v_resolved_product_id,
        'product_name', v_resolved_product_name,
        'product_image', v_resolved_product_image,
        'selected_size', v_resolved_selected_size,
        'unit_price_inr', v_auth_unit_price,
        'quantity', v_qty
      )
    );
  end loop;

  v_calc_subtotal_inr := v_calc_subtotal_big::integer;

  -- Explicit trusted server-side shipping rule (mirrors src/data/catalog.ts):
  -- Orders >= ₹1,499 qualify for complimentary shipping (₹0); orders < ₹1,499 pay ₹99.
  if v_calc_subtotal_inr >= 1499 then
    v_calc_shipping_inr := 0;
  else
    v_calc_shipping_inr := 99;
  end if;

  v_calc_total_big := v_calc_subtotal_inr::bigint + v_calc_shipping_inr::bigint;
  if v_calc_total_big > 2147483647 then
    raise exception 'Order total exceeds maximum supported integer amount.';
  end if;
  v_calc_total_inr := v_calc_total_big::integer;

  if p_subtotal_inr is not null and p_subtotal_inr <> v_calc_subtotal_inr then
    raise exception 'Order subtotal mismatch (submitted ₹%, server-calculated ₹%). Refresh your bag and try again.',
      p_subtotal_inr, v_calc_subtotal_inr;
  end if;

  if p_shipping_inr is not null and p_shipping_inr <> v_calc_shipping_inr then
    raise exception 'Shipping fee mismatch (submitted ₹%, expected ₹%). Refresh your bag and try again.',
      p_shipping_inr, v_calc_shipping_inr;
  end if;

  if p_total_inr is not null and p_total_inr <> v_calc_total_inr then
    raise exception 'Order total mismatch (submitted ₹%, server-calculated ₹%). Refresh your bag and try again.',
      p_total_inr, v_calc_total_inr;
  end if;

  -- Generate strictly 6-digit AK-XXXXXX order number and retry cleanly on concurrent unique_violation
  v_order.id := null;
  for v_ins_attempt in 1..25 loop
    v_order_number := null;
    for v_attempt in 1..10 loop
      v_rand_bytes := pg_catalog.decode(
        pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8),
        'hex'
      );
      v_rand_int :=
        ((pg_catalog.get_byte(v_rand_bytes, 0) % 128) * 16777216)
        + (pg_catalog.get_byte(v_rand_bytes, 1) * 65536)
        + (pg_catalog.get_byte(v_rand_bytes, 2) * 256)
        + pg_catalog.get_byte(v_rand_bytes, 3);
      v_order_number := 'AK-' || ((v_rand_int % 900000) + 100000)::text;
      exit when not exists (
        select 1 from public.orders o where o.order_number = v_order_number
      );
      v_order_number := null;
    end loop;

    if v_order_number is null then
      raise exception 'Unable to allocate a unique 6-digit order number (AK-XXXXXX). Please retry checkout.';
    end if;

    begin
      insert into public.orders (
        order_number,
        user_id,
        customer_name,
        customer_email,
        customer_phone,
        shipping_address,
        payment_method,
        payment_status,
        order_status,
        subtotal_inr,
        shipping_inr,
        total_inr,
        notes,
        idempotency_key
      )
      values (
        v_order_number,
        v_uid,
        v_customer_name,
        v_customer_email,
        v_customer_phone,
        p_shipping_address,
        p_payment_method,
        v_payment_status,
        'pending',
        v_calc_subtotal_inr,
        v_calc_shipping_inr,
        v_calc_total_inr,
        nullif(trim(coalesce(p_notes, '')), ''),
        v_idempotency_key
      )
      returning * into v_order;

      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_conflict_constraint = constraint_name;
        if not exists (
          select 1
            from pg_catalog.pg_index idx
            join pg_catalog.pg_class rel on rel.oid = idx.indrelid
            join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
            join pg_catalog.pg_class idx_rel on idx_rel.oid = idx.indexrelid
            join pg_catalog.pg_attribute att
              on att.attrelid = rel.oid
             and att.attnum = idx.indkey[0]
            left join pg_catalog.pg_constraint con
              on con.conindid = idx.indexrelid
             and con.conrelid = rel.oid
           where nsp.nspname = 'public'
             and rel.relname = 'orders'
             and idx.indisunique
             and idx.indnatts = 1
             and att.attname = 'order_number'
             and v_conflict_constraint in (idx_rel.relname, con.conname)
        ) then
          raise;
        end if;
        v_order.id := null;
        if v_ins_attempt >= 25 then
          raise exception 'Concurrent checkout order-number collision on "%". Please retry checkout.', coalesce(v_conflict_constraint, v_order_number);
        end if;
    end;
  end loop;

  if v_order.id is null then
    raise exception 'Unable to allocate a unique 6-digit order number (AK-XXXXXX). Please retry checkout.';
  end if;

  -- Insert server-resolved line items; each insert invokes order_items_decrement_stock trigger.
  for v_resolved_elem in
    select value from pg_catalog.jsonb_array_elements(v_resolved_items)
  loop
    insert into public.order_items (
      order_id,
      product_uuid,
      product_id,
      product_name,
      product_image,
      selected_size,
      unit_price_inr,
      quantity
    )
    values (
      v_order.id,
      nullif(v_resolved_elem ->> 'product_uuid', '')::uuid,
      v_resolved_elem ->> 'product_id',
      v_resolved_elem ->> 'product_name',
      nullif(v_resolved_elem ->> 'product_image', ''),
      v_resolved_elem ->> 'selected_size',
      (v_resolved_elem ->> 'unit_price_inr')::integer,
      (v_resolved_elem ->> 'quantity')::integer
    );
  end loop;

  -- Reload parent order so stock_deducted and stock_restoration_status reflect trigger updates
  select *
    into v_order
    from public.orders
   where id = v_order.id;

  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(oi) order by oi.created_at, oi.id)
    into v_items_json
    from public.order_items oi
   where oi.order_id = v_order.id;

  return pg_catalog.jsonb_build_object(
    'order', pg_catalog.to_jsonb(v_order),
    'order_items', coalesce(v_items_json, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.create_order_atomic(
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb, text
) from public, anon;
grant execute on function public.create_order_atomic(
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb, text
) to authenticated;

create or replace function public.discard_incomplete_order(
  p_order_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid;
  v_deleted_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return false;
  end if;

  delete from public.orders o
   where o.id = p_order_id
     and o.user_id = v_uid
     and o.order_status = 'pending'
     and coalesce(o.stock_deducted, false) = false
     and o.created_at >= (pg_catalog.now() - interval '5 minutes')
     and not exists (
       select 1
         from public.order_items oi
        where oi.order_id = o.id
     )
  returning o.id into v_deleted_id;

  return v_deleted_id is not null;
end;
$$;

revoke all on function public.discard_incomplete_order(uuid) from public, anon, authenticated;

create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_order public.orders%rowtype;
  v_new_payment_status text;
  v_new_refund_status text;
  v_actor text;
  v_updated_order public.orders%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Authentication required to cancel an order.';
  end if;

  v_is_admin := public.is_admin();

  -- Lock the order row exclusively to serialize concurrent cancellation attempts
  select *
    into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  -- Ownership validation
  if not v_is_admin and v_order.user_id is distinct from v_uid then
    raise exception 'You do not have permission to cancel this order.';
  end if;

  -- Duplicate cancellation prevention
  if v_order.order_status = 'cancelled' then
    raise exception 'This order has already been cancelled.';
  end if;

  -- Status eligibility validation
  if v_order.order_status = 'delivered' then
    raise exception 'Delivered orders cannot be cancelled.';
  end if;

  if not v_is_admin and v_order.order_status not in ('pending', 'confirmed', 'packed') then
    raise exception 'Orders in "%" status can no longer be cancelled by the customer.', v_order.order_status;
  end if;

  -- Payment & refund state determination (never creates fake refunds)
  if v_order.payment_status = 'paid' then
    v_new_payment_status := 'refund_pending';
    v_new_refund_status := 'pending';
  elsif v_order.payment_status in ('cod_due', 'awaiting_payment') then
    v_new_payment_status := 'cancelled';
    v_new_refund_status := 'not_required';
  elsif v_order.payment_status = 'refunded' then
    v_new_payment_status := 'refunded';
    v_new_refund_status := 'processed';
  elsif v_order.payment_status = 'refund_pending' then
    v_new_payment_status := 'refund_pending';
    v_new_refund_status := 'pending';
  else
    v_new_payment_status := v_order.payment_status;
    v_new_refund_status := 'not_required';
  end if;

  -- Prevent non-admins from spoofing cancelled_by = 'admin'
  if v_is_admin and coalesce(pg_catalog.lower(trim(p_actor)), 'admin') = 'admin' then
    v_actor := 'admin';
  else
    v_actor := 'customer';
  end if;

  update public.orders
     set order_status = 'cancelled',
         payment_status = v_new_payment_status,
         refund_status = v_new_refund_status,
         cancelled_at = pg_catalog.now(),
         cancelled_by = v_actor,
         cancelled_by_user_id = v_uid,
         cancellation_reason = nullif(trim(coalesce(p_reason, '')), ''),
         stock_restored = false,
         stock_restoration_status = 'not_applicable',
         updated_at = pg_catalog.now()
   where id = v_order.id
  returning * into v_updated_order;

  return pg_catalog.jsonb_build_object(
    'order', pg_catalog.to_jsonb(v_updated_order),
    'restored_units', 0,
    'restored_items', 0,
    'failed_items', 0,
    'failed_units', 0,
    'failed_item_details', '[]'::jsonb,
    'stock_restored', false,
    'stock_restoration_status', 'not_applicable',
    'warning', null
  );
end;
$$;

revoke all on function public.cancel_order(uuid, text, text) from public, anon;
grant execute on function public.cancel_order(uuid, text, text) to authenticated;

drop function if exists public.retry_failed_stock_restoration(uuid, uuid, uuid);

-- 9. Post-setup verification of RLS status, permissive policies, table privileges & RPC security
do $$
declare
  v_tbl text;
  v_rel record;
  v_bad_policies text;
  v_owner_bypass boolean;
  v_fn record;
  v_rpc_name text;
begin
  select exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      join pg_catalog.pg_roles r on r.oid = p.proowner
     where n.nspname = 'public'
       and p.proname = 'create_order_atomic'
       and (r.rolsuper or r.rolbypassrls)
  )
    into v_owner_bypass;

  foreach v_tbl in array array['orders', 'order_items', 'products']
  loop
    select c.relrowsecurity, c.relforcerowsecurity
      into v_rel
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = v_tbl;

    if not coalesce(v_rel.relrowsecurity, false) then
      raise exception 'Row Level Security is NOT enabled on public.%.', v_tbl;
    end if;

    if coalesce(v_rel.relforcerowsecurity, false) and not coalesce(v_owner_bypass, false) then
      raise exception 'FORCE ROW LEVEL SECURITY is enabled on public.% while create_order_atomic() owner lacks BYPASSRLS, which would block authenticated customer checkout.', v_tbl;
    end if;
  end loop;

  select pg_catalog.string_agg(c.relname || '.' || p.polname || ' (cmd=' || p.polcmd || ')', ', ')
    into v_bad_policies
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('orders', 'order_items')
     and p.polpermissive
     and (
       p.polcmd = '*'
       or (
         p.polcmd = 'a'
         and p.polname not in ('Admins can insert orders', 'Admins can insert order items')
       )
     );

  if v_bad_policies is not null then
    raise exception 'Unexpected permissive INSERT/ALL policies still present: %', v_bad_policies;
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.orders', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.order_items', 'INSERT') then
    raise exception 'Role anon still has direct INSERT privilege on public.orders or public.order_items.';
  end if;

  if exists (
    select 1
      from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.table_name in ('orders', 'order_items')
       and g.grantee = 'PUBLIC'
       and g.privilege_type = 'INSERT'
  ) then
    raise exception 'PUBLIC still has direct INSERT privilege on public.orders or public.order_items.';
  end if;

  foreach v_rpc_name in array array[
    'catalog_has_real_products',
    'decrement_stock_on_order_item',
    'create_order_atomic',
    'discard_incomplete_order',
    'cancel_order'
  ]
  loop
    select p.oid, p.prosecdef, p.proconfig
      into v_fn
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_rpc_name
     limit 1;

    if not found or not v_fn.prosecdef or not ('search_path=pg_catalog' = any(coalesce(v_fn.proconfig, array[]::text[]))) then
      raise exception 'Function public.%() is missing SECURITY DEFINER or set search_path = pg_catalog.', v_rpc_name;
    end if;

    if v_rpc_name = 'catalog_has_real_products' then
      if not pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
         or not pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'Function public.%() must grant EXECUTE to anon and authenticated.', v_rpc_name;
      end if;
    else
      if pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') then
        raise exception 'Function public.%() must NOT grant EXECUTE to anon.', v_rpc_name;
      end if;

      if v_rpc_name in ('create_order_atomic', 'cancel_order')
         and not pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'Function public.%() must grant EXECUTE to authenticated.', v_rpc_name;
      end if;

      if v_rpc_name in ('decrement_stock_on_order_item', 'discard_incomplete_order')
         and pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'Internal function public.%() must NOT grant EXECUTE to authenticated.', v_rpc_name;
      end if;
    end if;
  end loop;
end $$;

-- Refresh PostgREST schema cache so REST endpoints immediately see new tables & RPCs
notify pgrst, 'reload schema';
