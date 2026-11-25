-- ============================================================================
-- APNA KAPDA — Complete Production Database Reconciliation Migration
-- ============================================================================
-- Safe, non-destructive & idempotent:
--   • Preserves EVERY existing customer, profile, product, order, order item,
--     and newsletter subscriber record (never drops/truncates/overwrites data).
--   • Reconciles live DB against current frontend (storeService.ts / adminService.ts).
--   • Enforces MANUAL STOCK MANAGEMENT: neither checkout nor order cancellation
--     automatically deducts or restores public.products.stock_count / size_stock.
--   • Enforces server-side price, size, discount, and shipping (>= ₹1,499 free,
--     otherwise ₹99) validation in create_order_atomic() and preview_checkout_discount().
--   • Strictly isolates bulk shipping QA test orders (is_test_order = true) from
--     customer accounts, customer RLS, analytics, revenue, and real inventory.
--   • Reconciles CHECK constraints, RLS policies, explicit GRANTs, storage bucket
--     policies, triggers, and RPC overloads without duplicates.
--
-- Run manually in: Supabase Dashboard -> SQL Editor -> New Query.
-- Do NOT expect this file to touch existing live orders or alter real data.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 0. BASELINE NON-DESTRUCTIVE TABLE CHECKS & TRIGGER SAFETY AUDIT
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
  discount_inr integer not null default 0 check (discount_inr >= 0),
  applied_offer_id uuid,
  applied_coupon_code text,
  applied_offer_title text,
  total_inr integer not null check (total_inr >= 0),
  notes text,
  idempotency_key text,
  is_test_order boolean not null default false,
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

create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 1. ADD ALL MISSING COLUMNS & INDEXES NON-DESTRUCTIVELY
-- ============================================================================
-- Profiles
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists role text not null default 'customer';
alter table public.profiles add column if not exists default_address jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Products
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

-- Populate empty gallery_images from image_url without overwriting existing galleries
update public.products
   set gallery_images = array[image_url]
 where coalesce(array_length(gallery_images, 1), 0) = 0
   and coalesce(image_url, '') <> '';

create index if not exists products_category_active_idx
  on public.products (is_active, category, created_at desc);

-- Orders (preserves existing live order rows cleanly via safe defaults)
alter table public.orders add column if not exists notes text;
alter table public.orders add column if not exists idempotency_key text;
alter table public.orders add column if not exists is_test_order boolean not null default false;
alter table public.orders add column if not exists discount_inr integer not null default 0;
alter table public.orders add column if not exists applied_offer_id uuid;
alter table public.orders add column if not exists applied_coupon_code text;
alter table public.orders add column if not exists applied_offer_title text;
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

create index if not exists orders_is_test_order_idx
  on public.orders (is_test_order, created_at desc);

create unique index if not exists orders_test_idempotency_key_idx
  on public.orders (idempotency_key)
  where is_test_order = true and idempotency_key is not null;

-- Order Items
alter table public.order_items add column if not exists product_uuid uuid references public.products(id) on delete set null;
alter table public.order_items add column if not exists product_image text;
alter table public.order_items add column if not exists stock_deducted boolean not null default false;
alter table public.order_items add column if not exists stock_restored boolean not null default false;
alter table public.order_items add column if not exists stock_restoration_status text not null default 'not_applicable';
alter table public.order_items add column if not exists stock_restoration_error text;
alter table public.order_items add column if not exists stock_tracking_mode text not null default 'legacy';
alter table public.order_items add column if not exists created_at timestamptz not null default now();

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

-- ============================================================================
-- 1B. PREFLIGHT COLUMN TYPE & LEGACY TRIGGER AUDIT
-- ============================================================================
do $$
declare
  v_type_mismatch text;
  v_trig record;
  v_src_lower text;
  v_has_direct_stock_ref boolean;
  v_has_dynamic_sql boolean;
  v_has_unique_order_number boolean;
  v_dup_order_numbers text;
begin
  select pg_catalog.string_agg(
           req.tbl || '.' || req.col || ' (found ' || c.data_type || '/' || c.udt_name || ', expected ' || req.kind || ')',
           ', '
           order by req.tbl, req.col
         )
    into v_type_mismatch
    from (
      values
        ('products', 'id', 'uuid'),
        ('products', 'slug', 'text'),
        ('products', 'name', 'text'),
        ('products', 'category', 'text'),
        ('products', 'price_inr', 'int'),
        ('products', 'sizes', 'text_array'),
        ('products', 'stock_count', 'int'),
        ('products', 'size_stock', 'jsonb'),
        ('products', 'image_url', 'text'),
        ('products', 'is_active', 'bool'),
        ('products', 'updated_at', 'timestamptz'),
        ('orders', 'id', 'uuid'),
        ('orders', 'order_number', 'text'),
        ('orders', 'user_id', 'uuid'),
        ('orders', 'customer_name', 'text'),
        ('orders', 'customer_email', 'text'),
        ('orders', 'customer_phone', 'text'),
        ('orders', 'shipping_address', 'jsonb'),
        ('orders', 'payment_method', 'text'),
        ('orders', 'payment_status', 'text'),
        ('orders', 'order_status', 'text'),
        ('orders', 'subtotal_inr', 'int'),
        ('orders', 'shipping_inr', 'int'),
        ('orders', 'discount_inr', 'int'),
        ('orders', 'total_inr', 'int'),
        ('orders', 'notes', 'text'),
        ('orders', 'idempotency_key', 'text'),
        ('orders', 'is_test_order', 'bool'),
        ('orders', 'created_at', 'timestamptz'),
        ('orders', 'updated_at', 'timestamptz'),
        ('order_items', 'id', 'uuid'),
        ('order_items', 'order_id', 'uuid'),
        ('order_items', 'product_uuid', 'uuid'),
        ('order_items', 'product_id', 'text'),
        ('order_items', 'product_name', 'text'),
        ('order_items', 'product_image', 'text'),
        ('order_items', 'selected_size', 'text'),
        ('order_items', 'unit_price_inr', 'int'),
        ('order_items', 'quantity', 'int'),
        ('order_items', 'created_at', 'timestamptz')
    ) as req(tbl, col, kind)
    join information_schema.columns c
      on c.table_schema = 'public'
     and c.table_name = req.tbl
     and c.column_name = req.col
   where not (
     (req.kind = 'uuid' and c.data_type = 'uuid')
     or (req.kind = 'text' and c.data_type in ('text', 'character varying'))
     or (req.kind = 'int' and c.data_type in ('integer', 'smallint', 'bigint'))
     or (req.kind = 'bool' and c.data_type = 'boolean')
     or (req.kind = 'jsonb' and c.data_type = 'jsonb')
     or (req.kind = 'timestamptz' and c.data_type in ('timestamp with time zone', 'timestamp without time zone'))
     or (req.kind = 'text_array' and c.data_type = 'ARRAY' and c.udt_name in ('_text', '_varchar'))
   );

  if v_type_mismatch is not null then
    raise exception
      'Incompatible column type(s) detected in live schema: %. Align column types before applying reconciliation migration.',
      v_type_mismatch;
  end if;

  -- Audit triggers on orders / order_items so no forgotten legacy trigger silently mutates stock
  for v_trig in
    select rel.relname as tbl_name,
           tg.tgname as trig_name,
           proc_nsp.nspname as fn_schema,
           proc.proname as fn_name,
           proc.oid as fn_oid,
           lang.lanname as fn_lang,
           proc.prosrc as fn_src
      from pg_catalog.pg_trigger tg
      join pg_catalog.pg_class rel on rel.oid = tg.tgrelid
      join pg_catalog.pg_namespace nsp on nsp.oid = rel.relnamespace
      join pg_catalog.pg_proc proc on proc.oid = tg.tgfoid
      join pg_catalog.pg_namespace proc_nsp on proc_nsp.oid = proc.pronamespace
      join pg_catalog.pg_language lang on lang.oid = proc.prolang
     where nsp.nspname = 'public'
       and rel.relname in ('orders', 'order_items')
       and not tg.tgisinternal
       and tg.tgname not in ('orders_set_updated_at', 'order_items_decrement_stock')
  loop
    v_src_lower := pg_catalog.lower(coalesce(v_trig.fn_src, ''));

    v_has_direct_stock_ref :=
      pg_catalog.strpos(v_src_lower, 'products') > 0
      or pg_catalog.strpos(v_src_lower, 'stock_count') > 0
      or pg_catalog.strpos(v_src_lower, 'size_stock') > 0
      or exists (
        select 1
          from pg_catalog.pg_depend dep
          join pg_catalog.pg_class dep_rel on dep_rel.oid = dep.refobjid
          join pg_catalog.pg_namespace dep_nsp on dep_nsp.oid = dep_rel.relnamespace
         where dep.objid = v_trig.fn_oid
           and dep_nsp.nspname = 'public'
           and dep_rel.relname = 'products'
      );

    v_has_dynamic_sql :=
      v_trig.fn_lang = 'plpgsql'
      and v_src_lower ~ '(^|[^a-z0-9_])execute\s';

    if v_has_direct_stock_ref then
      raise exception
        'Unexpected trigger "%" on public.% (%.%()) references products/stock. Drop or review it to guarantee manual stock management.',
        v_trig.trig_name, v_trig.tbl_name, v_trig.fn_schema, v_trig.fn_name;
    elsif v_trig.fn_schema = 'public' and (v_has_dynamic_sql or v_trig.fn_lang not in ('sql', 'plpgsql')) then
      raise exception
        'Custom trigger "%" on public.% (%.%(), language %) uses dynamic SQL or non-SQL logic that cannot be statically audited. Inspect it before migrating.',
        v_trig.trig_name, v_trig.tbl_name, v_trig.fn_schema, v_trig.fn_name, v_trig.fn_lang;
    end if;
  end loop;

  -- Ensure a non-partial single-column UNIQUE index/constraint exists on public.orders(order_number)
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
        'Cannot enforce UNIQUE constraint on public.orders.order_number because duplicates exist: %. Resolve duplicates first.',
        v_dup_order_numbers;
    end if;

    alter table public.orders
      add constraint orders_order_number_unique unique (order_number);
  end if;
end $$;

-- ============================================================================
-- 2. CORE HELPER & TRIGGER FUNCTIONS (ADMIN CHECK, AUTH SYNC, UPDATED_AT)
-- ============================================================================
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

-- Non-destructive backfill for auth users created prior to trigger setup
insert into public.profiles (id, full_name, email, role)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  u.email,
  'customer'
from auth.users u
on conflict (id) do nothing;

create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt_role text := coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    ''
  );
  v_is_privileged_session boolean := false;
begin
  if v_jwt_role = '' and nullif(pg_catalog.current_setting('request.jwt.claims', true), '') is not null then
    begin
      v_jwt_role := coalesce(pg_catalog.current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    exception when others then
      v_jwt_role := '';
    end;
  end if;

  select exists (
    select 1
      from pg_catalog.pg_roles r
     where r.rolname = session_user
       and (r.rolsuper or r.rolbypassrls)
  )
    into v_is_privileged_session;

  if tg_op = 'INSERT' then
    if new.role is distinct from 'customer' then
      if v_uid is not null then
        if not public.is_admin() then
          raise exception 'Only administrators can assign user roles.';
        end if;
      elsif not (v_jwt_role = 'service_role' or (v_jwt_role = '' and v_is_privileged_session)) then
        raise exception 'Only administrators can assign user roles.';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then
      if v_uid is not null then
        if not public.is_admin() then
          raise exception 'Only administrators can change user roles.';
        end if;
      elsif not (v_jwt_role = 'service_role' or (v_jwt_role = '' and v_is_privileged_session)) then
        raise exception 'Only administrators can change user roles.';
      end if;
    end if;
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.prevent_role_escalation() from public, anon, authenticated;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before insert or update on public.profiles
  for each row execute procedure public.prevent_role_escalation();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute procedure public.set_updated_at();

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- 3. OFFERS, COUPONS, REDEMPTIONS & STOREFRONT BANNERS TABLES
-- ============================================================================
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  discount_mode text not null check (discount_mode in ('automatic', 'coupon')),
  coupon_code text,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value integer not null check (discount_value > 0),
  min_cart_value_inr integer not null default 0 check (min_cart_value_inr >= 0),
  max_discount_inr integer check (max_discount_inr is null or max_discount_inr >= 0),
  applies_to text not null default 'all' check (applies_to in ('all', 'products', 'categories')),
  product_ids uuid[] not null default array[]::uuid[],
  categories text[] not null default array[]::text[],
  total_usage_limit integer check (total_usage_limit is null or total_usage_limit > 0),
  per_customer_usage_limit integer check (per_customer_usage_limit is null or per_customer_usage_limit > 0),
  usage_count integer not null default 0 check (usage_count >= 0),
  allow_stacking boolean not null default false,
  is_active boolean not null default true,
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_percentage_cap_check
    check (discount_type <> 'percentage' or discount_value <= 100),
  constraint offers_schedule_window_check
    check (expires_at is null or starts_at is null or expires_at > starts_at),
  constraint offers_coupon_mode_consistency_check
    check (
      (discount_mode = 'automatic' and coupon_code is null)
      or (discount_mode = 'coupon' and nullif(trim(coalesce(coupon_code, '')), '') is not null)
    )
);

create unique index if not exists offers_coupon_code_unique_idx
  on public.offers (upper(coupon_code))
  where coupon_code is not null;

create index if not exists offers_active_schedule_idx
  on public.offers (is_active, discount_mode, starts_at, expires_at);

create or replace function public.normalize_offer_row()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.title := trim(coalesce(new.title, ''));
  if new.title = '' then
    raise exception 'Offer title cannot be empty.';
  end if;

  new.description := trim(coalesce(new.description, ''));

  if new.discount_mode = 'coupon' then
    new.coupon_code := nullif(pg_catalog.upper(trim(coalesce(new.coupon_code, ''))), '');
    if new.coupon_code is null then
      raise exception 'Coupon code is required when discount_mode is "coupon".';
    end if;
    if new.coupon_code !~ '^[A-Z0-9_-]{3,32}$' then
      raise exception 'Coupon code must be 3-32 characters (letters, numbers, hyphen, underscore).';
    end if;
  else
    new.coupon_code := null;
  end if;

  new.product_ids := coalesce(new.product_ids, array[]::uuid[]);
  new.categories := coalesce(new.categories, array[]::text[]);
  new.allow_stacking := false;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.normalize_offer_row() from public, anon, authenticated;

drop trigger if exists offers_normalize_before_write on public.offers;
create trigger offers_normalize_before_write
  before insert or update on public.offers
  for each row execute procedure public.normalize_offer_row();

create table if not exists public.offer_redemptions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references public.offers(id) on delete cascade not null,
  order_id uuid references public.orders(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete set null,
  coupon_code text,
  discount_inr integer not null check (discount_inr >= 0),
  created_at timestamptz not null default now()
);

create unique index if not exists offer_redemptions_offer_order_idx
  on public.offer_redemptions (offer_id, order_id);

create index if not exists offer_redemptions_offer_user_idx
  on public.offer_redemptions (offer_id, user_id);

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.orders'::regclass
       and con.conname = 'orders_applied_offer_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_applied_offer_id_fkey
      foreign key (applied_offer_id)
      references public.offers(id)
      on delete set null;
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.orders'::regclass
       and con.conname = 'orders_discount_inr_nonnegative_check'
  ) then
    alter table public.orders
      add constraint orders_discount_inr_nonnegative_check
      check (discount_inr >= 0);
  end if;
end $$;

create table if not exists public.storefront_banners (
  id uuid primary key default gen_random_uuid(),
  banner_text text not null check (nullif(trim(banner_text), '') is not null),
  offer_title text not null default '',
  cta_text text not null default 'Shop Now',
  destination_type text not null default 'shop'
    check (destination_type in ('shop', 'category', 'product', 'url')),
  destination_value text not null default '',
  is_active boolean not null default false,
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storefront_banners_schedule_check
    check (expires_at is null or starts_at is null or expires_at > starts_at)
);

do $$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.storefront_banners'::regclass
       and con.conname = 'storefront_banners_banner_text_nonempty_check'
  ) then
    if not exists (
      select 1
        from public.storefront_banners
       where nullif(trim(coalesce(banner_text, '')), '') is null
    ) then
      alter table public.storefront_banners
        add constraint storefront_banners_banner_text_nonempty_check
        check (nullif(trim(banner_text), '') is not null);
    end if;
  end if;
end $$;

create index if not exists storefront_banners_active_schedule_idx
  on public.storefront_banners (is_active, starts_at, expires_at, updated_at desc);

drop trigger if exists storefront_banners_set_updated_at on public.storefront_banners;
create trigger storefront_banners_set_updated_at
  before update on public.storefront_banners
  for each row execute procedure public.set_updated_at();

-- ============================================================================
-- 4. SAFE EXISTING ROW VALIDATION & CHECK CONSTRAINT RECONCILIATION
-- ============================================================================
do $$
declare
  v_orders_relid oid := 'public.orders'::regclass;
  v_order_items_relid oid := 'public.order_items'::regclass;
  v_con record;
  v_target_cols text[];
  v_unrelated_cols text[];
  v_col text;
  v_norm text;
  v_val_clause text;
  v_disjunct text;
  v_skel text;
  v_skel_no_notnull text;
  v_enum_match text[];
  v_enum_inner text;
  v_existing_lits text[];
  v_req_values text[];
  v_merged_lits text[];
  v_new_array_items text;
  v_rewritten_def text;
  v_remaining_after_enum text;
  v_remaining_no_notnull text;
  v_occupied_order_cons text[] := array[]::text[];
  v_occupied_item_cons text[] := array[]::text[];
  v_invalid_order_statuses text;
  v_invalid_payment_statuses text;
  v_invalid_cancelled_by text;
  v_invalid_refund_statuses text;
  v_invalid_restoration_statuses text;
  v_invalid_item_restoration_statuses text;
  v_invalid_item_tracking_modes text;
begin
  select pg_catalog.string_agg(distinct coalesce(order_status, '<NULL>'), ', ')
    into v_invalid_order_statuses
    from public.orders
   where order_status is null
      or order_status not in ('pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled');

  if v_invalid_order_statuses is not null then
    raise exception 'Unexpected existing order_status values found: %. Resolve before migrating.', v_invalid_order_statuses;
  end if;

  select pg_catalog.string_agg(distinct coalesce(payment_status, '<NULL>'), ', ')
    into v_invalid_payment_statuses
    from public.orders
   where payment_status is null
      or payment_status not in ('cod_due', 'awaiting_payment', 'paid', 'refund_pending', 'failed', 'refunded', 'cancelled');

  if v_invalid_payment_statuses is not null then
    raise exception 'Unexpected existing payment_status values found: %. Resolve before migrating.', v_invalid_payment_statuses;
  end if;

  select pg_catalog.string_agg(distinct cancelled_by, ', ')
    into v_invalid_cancelled_by
    from public.orders
   where cancelled_by is not null
     and cancelled_by not in ('customer', 'admin');

  if v_invalid_cancelled_by is not null then
    raise exception 'Unexpected existing orders.cancelled_by values found: %. Resolve before migrating.', v_invalid_cancelled_by;
  end if;

  select pg_catalog.string_agg(distinct coalesce(refund_status, '<NULL>'), ', ')
    into v_invalid_refund_statuses
    from public.orders
   where refund_status is null
      or refund_status not in ('none', 'not_required', 'pending', 'processed', 'failed');

  if v_invalid_refund_statuses is not null then
    raise exception 'Unexpected existing orders.refund_status values found: %. Resolve before migrating.', v_invalid_refund_statuses;
  end if;

  select pg_catalog.string_agg(distinct coalesce(stock_restoration_status, '<NULL>'), ', ')
    into v_invalid_restoration_statuses
    from public.orders
   where stock_restoration_status is null
      or stock_restoration_status not in ('not_applicable', 'pending', 'restored', 'partial', 'failed');

  if v_invalid_restoration_statuses is not null then
    raise exception 'Unexpected existing orders.stock_restoration_status values found: %. Resolve before migrating.', v_invalid_restoration_statuses;
  end if;

  select pg_catalog.string_agg(distinct coalesce(stock_restoration_status, '<NULL>'), ', ')
    into v_invalid_item_restoration_statuses
    from public.order_items
   where stock_restoration_status is null
      or stock_restoration_status not in ('not_applicable', 'deducted', 'restored', 'failed');

  if v_invalid_item_restoration_statuses is not null then
    raise exception 'Unexpected existing order_items.stock_restoration_status values found: %. Resolve before migrating.', v_invalid_item_restoration_statuses;
  end if;

  select pg_catalog.string_agg(distinct coalesce(stock_tracking_mode, '<NULL>'), ', ')
    into v_invalid_item_tracking_modes
    from public.order_items
   where stock_tracking_mode is null
      or stock_tracking_mode not in ('legacy', 'total_only', 'size_stock', 'none');

  if v_invalid_item_tracking_modes is not null then
    raise exception 'Unexpected existing order_items.stock_tracking_mode values found: %. Resolve before migrating.', v_invalid_item_tracking_modes;
  end if;

  -- Migrate public.orders status CHECK constraints while preserving NOT NULL / custom checks
  for v_con in
    select con.oid,
           con.conname,
           con.convalidated,
           con.conkey,
           pg_catalog.pg_get_constraintdef(con.oid) as def
      from pg_catalog.pg_constraint con
     where con.conrelid = v_orders_relid
       and con.contype = 'c'
     order by con.conname
  loop
    select
      coalesce(
        pg_catalog.array_agg(a.attname::text order by a.attnum)
          filter (where a.attname in ('order_status', 'payment_status', 'cancelled_by', 'refund_status', 'stock_restoration_status')),
        array[]::text[]
      ),
      coalesce(
        pg_catalog.array_agg(a.attname::text order by a.attnum)
          filter (where a.attname not in ('order_status', 'payment_status', 'cancelled_by', 'refund_status', 'stock_restoration_status')),
        array[]::text[]
      )
      into v_target_cols, v_unrelated_cols
      from pg_catalog.unnest(coalesce(v_con.conkey, array[]::smallint[])) as k(attnum)
      join pg_catalog.pg_attribute a
        on a.attrelid = v_orders_relid
       and a.attnum = k.attnum
       and not a.attisdropped;

    if coalesce(pg_catalog.array_length(v_target_cols, 1), 0) = 0 then
      if v_con.conname in (
        'orders_order_status_check',
        'orders_payment_status_check',
        'orders_cancelled_by_check',
        'orders_refund_status_check',
        'orders_stock_restoration_status_check'
      ) then
        raise exception
          'Unrelated constraint "%" on public.orders conflicts with target constraint name (%). Rename it before migrating.',
          v_con.conname, v_con.def;
      end if;
      continue;
    end if;

    if pg_catalog.array_length(v_target_cols, 1) = 1
       and coalesce(pg_catalog.array_length(v_unrelated_cols, 1), 0) = 0 then
      v_col := v_target_cols[1];

      v_norm := pg_catalog.regexp_replace(pg_catalog.lower(v_con.def), '''([^'']|'''')*''', '__STR__', 'g');
      v_norm := pg_catalog.regexp_replace(v_norm, '::(?:character varying|varchar|bpchar|char|text)(?:\[\])?', '', 'g');
      v_norm := pg_catalog.btrim(pg_catalog.regexp_replace(v_norm, '\s+', ' ', 'g'));
      v_norm := pg_catalog.regexp_replace(v_norm, ' *([\(\)\[\],=]) *', '\1', 'g');

      if v_col <> 'cancelled_by'
         and pg_catalog.length(pg_catalog.replace(v_norm, '(', '')) = pg_catalog.length(pg_catalog.replace(v_norm, ')', ''))
         and v_norm ~ pg_catalog.format('^check\(+%s(?:\s+|\)+)is\s+not\s+null\)+$', v_col) then
        v_occupied_order_cons := pg_catalog.array_append(v_occupied_order_cons, v_con.conname);
        continue;
      end if;

      v_val_clause := pg_catalog.format(
        '(?:\(*%s\)*=__STR__|\(*%s\)*=any\(\(*array\[__STR__(?:,__STR__)*\]\)*\)|(?:\(*%s\s+|\(*%s\)+)in\(__STR__(?:,__STR__)*\))',
        v_col, v_col, v_col, v_col
      );
      v_disjunct := pg_catalog.format(
        '(?:%s|(?:\(*%s\s+|\(*%s\)+)is\s+null)',
        v_val_clause, v_col, v_col
      );

      if v_norm ~ v_val_clause
         and v_norm !~ '\m(and|not)\M'
         and v_norm !~ '[<>!~]'
         and pg_catalog.length(pg_catalog.replace(v_norm, '(', '')) = pg_catalog.length(pg_catalog.replace(v_norm, ')', ''))
         and v_norm ~ pg_catalog.format('^check\(+%s(?:(?:\)+\s*|\s+)or(?:\s*\(+|\s+)%s)*\)+$', v_disjunct, v_disjunct) then
        execute pg_catalog.format(
          'alter table public.orders drop constraint if exists %I',
          v_con.conname
        );
        continue;
      end if;
    end if;

    v_rewritten_def := v_con.def;

    foreach v_col in array v_target_cols
    loop
      v_req_values := case v_col
        when 'order_status' then array['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled']
        when 'payment_status' then array['cod_due', 'awaiting_payment', 'paid', 'refund_pending', 'failed', 'refunded', 'cancelled']
        when 'cancelled_by' then array['customer', 'admin']
        when 'refund_status' then array['none', 'not_required', 'pending', 'processed', 'failed']
        when 'stock_restoration_status' then array['not_applicable', 'pending', 'restored', 'partial', 'failed']
      end;

      v_enum_match := pg_catalog.regexp_match(
        v_rewritten_def,
        '(\(?\s*\m' || v_col || '\M\s*\)?(?:\s*::\s*[a-z0-9_ ]+)?\s*=\s*any\s*\(\s*\(?\s*array\[([^\]]*)\](?:\s*::\s*[a-z0-9_ ]+\[\])?\s*\)?\s*\))',
        'i'
      );

      if v_enum_match is not null then
        v_enum_inner := v_enum_match[2];

        v_remaining_after_enum := pg_catalog.regexp_replace(
          v_rewritten_def,
          '\(?\s*\m' || v_col || '\M\s*\)?(?:\s*::\s*[a-z0-9_ ]+)?\s*=\s*any\s*\(\s*\(?\s*array\[[^\]]*\](?:\s*::\s*[a-z0-9_ ]+\[\])?\s*\)?\s*\)',
          '__TARGET_COL_ENUM__',
          'i'
        );

        v_remaining_no_notnull := pg_catalog.regexp_replace(v_remaining_after_enum, '''([^'']|'''')*''', '''''', 'g');
        if v_col <> 'cancelled_by' then
          v_remaining_no_notnull := pg_catalog.regexp_replace(
            v_remaining_no_notnull,
            '\(*\s*\m' || v_col || '\M\s*\)*\s+is\s+not\s+null\M',
            '',
            'gi'
          );
        end if;

        if v_remaining_no_notnull ~* ('\m' || v_col || '\M')
           or pg_catalog.regexp_replace(v_remaining_after_enum, '''([^'']|'''')*''', '''''', 'g') ~* '\mnot\M\s*\(?\s*__TARGET_COL_ENUM__' then
          raise exception
            'Combined CHECK constraint "%" on public.orders (%) references column "%" and cannot be safely auto-rewritten. Update it manually before migrating.',
            v_con.conname, v_con.def, v_col;
        end if;

        select coalesce(pg_catalog.array_agg(pg_catalog.replace(m[1], '''''', '''')), array[]::text[])
          into v_existing_lits
          from pg_catalog.regexp_matches(v_enum_inner, '''((?:[^'']|'''')*)''', 'g') as m;

        v_merged_lits := v_existing_lits || v_req_values;

        select pg_catalog.string_agg(pg_catalog.quote_literal(val) || '::text', ', ')
          into v_new_array_items
          from (
            select val
              from pg_catalog.unnest(v_merged_lits) with ordinality as t(val, ord)
             group by val
             order by pg_catalog.min(ord)
          ) dedup;

        v_rewritten_def := pg_catalog.replace(
          v_rewritten_def,
          v_enum_match[1],
          pg_catalog.format('%I = ANY (ARRAY[%s])', v_col, v_new_array_items)
        );
      else
        v_skel := pg_catalog.regexp_replace(pg_catalog.lower(v_rewritten_def), '''([^'']|'''')*''', '''''', 'g');
        v_skel := pg_catalog.regexp_replace(v_skel, '::(?:character varying|varchar|bpchar|char|text)(?:\[\])?', '', 'g');

        v_skel_no_notnull := v_skel;
        if v_col <> 'cancelled_by' then
          v_skel_no_notnull := pg_catalog.regexp_replace(
            v_skel_no_notnull,
            '\(*\s*\m' || v_col || '\M\s*\)*\s+is\s+not\s+null\M',
            '',
            'gi'
          );
        end if;

        if not (v_skel_no_notnull ~ ('\m' || v_col || '\M')) then
          null;
        elsif not (
          v_skel ~ ('\m' || v_col || '\M\s*(<>|!=|is\s+distinct\s+from)\s*''''')
          and v_skel ~ '\mor\M'
          and not (v_skel ~ ('\m' || v_col || '\M\s*(=|\min\M|\mnot\s+in\M)'))
          and not (pg_catalog.lower(v_rewritten_def) ~ ('\m' || v_col || '\M\s*(<>|!=|is\s+distinct\s+from)\s*''(cancelled|refund_pending|restored|partial|failed|deducted|customer|admin|not_required|processed)'''))
        ) then
          raise exception
            'Custom/combined CHECK constraint "%" on public.orders (%) references column "%" in a form that cannot be automatically verified or preserved. Review it manually before migrating.',
            v_con.conname, v_con.def, v_col;
        end if;
      end if;
    end loop;

    if v_rewritten_def is distinct from v_con.def then
      execute pg_catalog.format('alter table public.orders drop constraint %I', v_con.conname);
      execute pg_catalog.format(
        'alter table public.orders add constraint %I %s%s',
        v_con.conname,
        v_rewritten_def,
        case when not v_con.convalidated then ' not valid' else '' end
      );
    end if;

    v_occupied_order_cons := pg_catalog.array_append(v_occupied_order_cons, v_con.conname);
  end loop;

  if not ('orders_order_status_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_order_status_check
      check (order_status in ('pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'));
  elsif not ('orders_order_status_values_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_order_status_values_check
      check (order_status in ('pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'));
  end if;

  if not ('orders_payment_status_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (payment_status in ('cod_due', 'awaiting_payment', 'paid', 'refund_pending', 'failed', 'refunded', 'cancelled'));
  elsif not ('orders_payment_status_values_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_payment_status_values_check
      check (payment_status in ('cod_due', 'awaiting_payment', 'paid', 'refund_pending', 'failed', 'refunded', 'cancelled'));
  end if;

  if not ('orders_cancelled_by_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_cancelled_by_check
      check (cancelled_by is null or cancelled_by in ('customer', 'admin'));
  elsif not ('orders_cancelled_by_values_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_cancelled_by_values_check
      check (cancelled_by is null or cancelled_by in ('customer', 'admin'));
  end if;

  if not ('orders_refund_status_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_refund_status_check
      check (refund_status in ('none', 'not_required', 'pending', 'processed', 'failed'));
  elsif not ('orders_refund_status_values_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_refund_status_values_check
      check (refund_status in ('none', 'not_required', 'pending', 'processed', 'failed'));
  end if;

  if not ('orders_stock_restoration_status_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_stock_restoration_status_check
      check (stock_restoration_status in ('not_applicable', 'pending', 'restored', 'partial', 'failed'));
  elsif not ('orders_stock_restoration_status_values_check' = any(v_occupied_order_cons)) then
    alter table public.orders
      add constraint orders_stock_restoration_status_values_check
      check (stock_restoration_status in ('not_applicable', 'pending', 'restored', 'partial', 'failed'));
  end if;

  -- Migrate public.order_items status CHECK constraints
  for v_con in
    select con.oid,
           con.conname,
           con.convalidated,
           con.conkey,
           pg_catalog.pg_get_constraintdef(con.oid) as def
      from pg_catalog.pg_constraint con
     where con.conrelid = v_order_items_relid
       and con.contype = 'c'
     order by con.conname
  loop
    select
      coalesce(
        pg_catalog.array_agg(a.attname::text order by a.attnum)
          filter (where a.attname in ('stock_restoration_status', 'stock_tracking_mode')),
        array[]::text[]
      ),
      coalesce(
        pg_catalog.array_agg(a.attname::text order by a.attnum)
          filter (where a.attname not in ('stock_restoration_status', 'stock_tracking_mode')),
        array[]::text[]
      )
      into v_target_cols, v_unrelated_cols
      from pg_catalog.unnest(coalesce(v_con.conkey, array[]::smallint[])) as k(attnum)
      join pg_catalog.pg_attribute a
        on a.attrelid = v_order_items_relid
       and a.attnum = k.attnum
       and not a.attisdropped;

    if coalesce(pg_catalog.array_length(v_target_cols, 1), 0) = 0 then
      if v_con.conname in (
        'order_items_stock_restoration_status_check',
        'order_items_stock_tracking_mode_check'
      ) then
        raise exception
          'Unrelated constraint "%" on public.order_items conflicts with target constraint name (%). Rename it before migrating.',
          v_con.conname, v_con.def;
      end if;
      continue;
    end if;

    if pg_catalog.array_length(v_target_cols, 1) = 1
       and coalesce(pg_catalog.array_length(v_unrelated_cols, 1), 0) = 0 then
      v_col := v_target_cols[1];

      v_norm := pg_catalog.regexp_replace(pg_catalog.lower(v_con.def), '''([^'']|'''')*''', '__STR__', 'g');
      v_norm := pg_catalog.regexp_replace(v_norm, '::(?:character varying|varchar|bpchar|char|text)(?:\[\])?', '', 'g');
      v_norm := pg_catalog.btrim(pg_catalog.regexp_replace(v_norm, '\s+', ' ', 'g'));
      v_norm := pg_catalog.regexp_replace(v_norm, ' *([\(\)\[\],=]) *', '\1', 'g');

      if pg_catalog.length(pg_catalog.replace(v_norm, '(', '')) = pg_catalog.length(pg_catalog.replace(v_norm, ')', ''))
         and v_norm ~ pg_catalog.format('^check\(+%s(?:\s+|\)+)is\s+not\s+null\)+$', v_col) then
        v_occupied_item_cons := pg_catalog.array_append(v_occupied_item_cons, v_con.conname);
        continue;
      end if;

      v_val_clause := pg_catalog.format(
        '(?:\(*%s\)*=__STR__|\(*%s\)*=any\(\(*array\[__STR__(?:,__STR__)*\]\)*\)|(?:\(*%s\s+|\(*%s\)+)in\(__STR__(?:,__STR__)*\))',
        v_col, v_col, v_col, v_col
      );
      v_disjunct := pg_catalog.format(
        '(?:%s|(?:\(*%s\s+|\(*%s\)+)is\s+null)',
        v_val_clause, v_col, v_col
      );

      if v_norm ~ v_val_clause
         and v_norm !~ '\m(and|not)\M'
         and v_norm !~ '[<>!~]'
         and pg_catalog.length(pg_catalog.replace(v_norm, '(', '')) = pg_catalog.length(pg_catalog.replace(v_norm, ')', ''))
         and v_norm ~ pg_catalog.format('^check\(+%s(?:(?:\)+\s*|\s+)or(?:\s*\(+|\s+)%s)*\)+$', v_disjunct, v_disjunct) then
        execute pg_catalog.format(
          'alter table public.order_items drop constraint if exists %I',
          v_con.conname
        );
        continue;
      end if;
    end if;

    v_rewritten_def := v_con.def;

    foreach v_col in array v_target_cols
    loop
      v_req_values := case v_col
        when 'stock_restoration_status' then array['not_applicable', 'deducted', 'restored', 'failed']
        when 'stock_tracking_mode' then array['legacy', 'total_only', 'size_stock', 'none']
      end;

      v_enum_match := pg_catalog.regexp_match(
        v_rewritten_def,
        '(\(?\s*\m' || v_col || '\M\s*\)?(?:\s*::\s*[a-z0-9_ ]+)?\s*=\s*any\s*\(\s*\(?\s*array\[([^\]]*)\](?:\s*::\s*[a-z0-9_ ]+\[\])?\s*\)?\s*\))',
        'i'
      );

      if v_enum_match is not null then
        v_enum_inner := v_enum_match[2];
        v_remaining_after_enum := pg_catalog.regexp_replace(
          v_rewritten_def,
          '\(?\s*\m' || v_col || '\M\s*\)?(?:\s*::\s*[a-z0-9_ ]+)?\s*=\s*any\s*\(\s*\(?\s*array\[[^\]]*\](?:\s*::\s*[a-z0-9_ ]+\[\])?\s*\)?\s*\)',
          '__TARGET_COL_ENUM__',
          'i'
        );

        v_remaining_no_notnull := pg_catalog.regexp_replace(v_remaining_after_enum, '''([^'']|'''')*''', '''''', 'g');
        v_remaining_no_notnull := pg_catalog.regexp_replace(
          v_remaining_no_notnull,
          '\(*\s*\m' || v_col || '\M\s*\)*\s+is\s+not\s+null\M',
          '',
          'gi'
        );

        if v_remaining_no_notnull ~* ('\m' || v_col || '\M')
           or pg_catalog.regexp_replace(v_remaining_after_enum, '''([^'']|'''')*''', '''''', 'g') ~* '\mnot\M\s*\(?\s*__TARGET_COL_ENUM__' then
          raise exception
            'Combined CHECK constraint "%" on public.order_items (%) references column "%" and cannot be safely auto-rewritten. Update it manually before migrating.',
            v_con.conname, v_con.def, v_col;
        end if;

        select coalesce(pg_catalog.array_agg(pg_catalog.replace(m[1], '''''', '''')), array[]::text[])
          into v_existing_lits
          from pg_catalog.regexp_matches(v_enum_inner, '''((?:[^'']|'''')*)''', 'g') as m;

        v_merged_lits := v_existing_lits || v_req_values;

        select pg_catalog.string_agg(pg_catalog.quote_literal(val) || '::text', ', ')
          into v_new_array_items
          from (
            select val
              from pg_catalog.unnest(v_merged_lits) with ordinality as t(val, ord)
             group by val
             order by pg_catalog.min(ord)
          ) dedup;

        v_rewritten_def := pg_catalog.replace(
          v_rewritten_def,
          v_enum_match[1],
          pg_catalog.format('%I = ANY (ARRAY[%s])', v_col, v_new_array_items)
        );
      else
        v_skel := pg_catalog.regexp_replace(pg_catalog.lower(v_rewritten_def), '''([^'']|'''')*''', '''''', 'g');
        v_skel := pg_catalog.regexp_replace(v_skel, '::(?:character varying|varchar|bpchar|char|text)(?:\[\])?', '', 'g');
        v_skel_no_notnull := pg_catalog.regexp_replace(
          v_skel,
          '\(*\s*\m' || v_col || '\M\s*\)*\s+is\s+not\s+null\M',
          '',
          'gi'
        );

        if not (v_skel_no_notnull ~ ('\m' || v_col || '\M')) then
          null;
        elsif not (
          v_skel ~ ('\m' || v_col || '\M\s*(<>|!=|is\s+distinct\s+from)\s*''''')
          and v_skel ~ '\mor\M'
          and not (v_skel ~ ('\m' || v_col || '\M\s*(=|\min\M|\mnot\s+in\M)'))
          and not (pg_catalog.lower(v_rewritten_def) ~ ('\m' || v_col || '\M\s*(<>|!=|is\s+distinct\s+from)\s*''(deducted|restored|failed|legacy|total_only|size_stock|none)'''))
        ) then
          raise exception
            'Custom/combined CHECK constraint "%" on public.order_items (%) references column "%" and cannot be automatically verified or preserved. Review it manually before migrating.',
            v_con.conname, v_con.def, v_col;
        end if;
      end if;
    end loop;

    if v_rewritten_def is distinct from v_con.def then
      execute pg_catalog.format('alter table public.order_items drop constraint %I', v_con.conname);
      execute pg_catalog.format(
        'alter table public.order_items add constraint %I %s%s',
        v_con.conname,
        v_rewritten_def,
        case when not v_con.convalidated then ' not valid' else '' end
      );
    end if;

    v_occupied_item_cons := pg_catalog.array_append(v_occupied_item_cons, v_con.conname);
  end loop;

  if not ('order_items_stock_restoration_status_check' = any(v_occupied_item_cons)) then
    alter table public.order_items
      add constraint order_items_stock_restoration_status_check
      check (stock_restoration_status in ('not_applicable', 'deducted', 'restored', 'failed'));
  elsif not ('order_items_stock_restoration_status_values_check' = any(v_occupied_item_cons)) then
    alter table public.order_items
      add constraint order_items_stock_restoration_status_values_check
      check (stock_restoration_status in ('not_applicable', 'deducted', 'restored', 'failed'));
  end if;

  if not ('order_items_stock_tracking_mode_check' = any(v_occupied_item_cons)) then
    alter table public.order_items
      add constraint order_items_stock_tracking_mode_check
      check (stock_tracking_mode in ('legacy', 'total_only', 'size_stock', 'none'));
  elsif not ('order_items_stock_tracking_mode_values_check' = any(v_occupied_item_cons)) then
    alter table public.order_items
      add constraint order_items_stock_tracking_mode_values_check
      check (stock_tracking_mode in ('legacy', 'total_only', 'size_stock', 'none'));
  end if;
end $$;

-- ============================================================================
-- 5. EXPLICIT TABLE GRANTS & HARDENED RLS POLICIES (ALL 8 TABLES)
-- ============================================================================
grant usage on schema public to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.offers enable row level security;
alter table public.offer_redemptions enable row level security;
alter table public.storefront_banners enable row level security;

-- PROFILES
revoke all on table public.profiles from public, anon;
grant select, insert, update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id or public.is_admin());

drop policy if exists "Users can insert own customer profile" on public.profiles;
create policy "Users can insert own customer profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id and role = 'customer');

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id or public.is_admin())
  with check (
    public.is_admin()
    or (
      auth.uid() = id
      and role = 'customer'
    )
  );

-- PRODUCTS
revoke all on table public.products from public;
grant select on table public.products to anon, authenticated;
grant insert, update, delete on table public.products to authenticated;
grant all on table public.products to service_role;

drop policy if exists "Anyone can view active products" on public.products;
create policy "Anyone can view active products"
  on public.products for select
  to anon, authenticated
  using (is_active = true or public.is_admin());

drop policy if exists "Admins can insert products" on public.products;
create policy "Admins can insert products"
  on public.products for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update products" on public.products;
create policy "Admins can update products"
  on public.products for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete products" on public.products;
create policy "Admins can delete products"
  on public.products for delete
  to authenticated
  using (public.is_admin());

-- ORDERS & ORDER ITEMS (close all direct non-admin INSERT / UPDATE / DELETE paths)
revoke all on table public.orders from public, anon;
grant select, insert, update on table public.orders to authenticated;
grant all on table public.orders to service_role;

revoke all on table public.order_items from public, anon;
grant select, insert on table public.order_items to authenticated;
grant all on table public.order_items to service_role;

do $$
declare
  v_tbl text;
  v_relid oid;
  v_pol record;
  v_roles_sql text;
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
             pg_catalog.pg_get_expr(p.polqual, p.polrelid) as using_expr
        from pg_catalog.pg_policy p
       where p.polrelid = v_relid
         and p.polpermissive
         and p.polcmd in ('a', 'w', 'd', '*')
       order by p.polname
    loop
      if v_pol.polcmd = '*' and v_pol.using_expr is not null then
        if array[0::oid] = v_pol.polroles or coalesce(pg_catalog.array_length(v_pol.polroles, 1), 0) = 0 then
          v_roles_sql := 'public';
        else
          select pg_catalog.string_agg(pg_catalog.quote_ident(r.rolname), ', ' order by ord)
            into v_roles_sql
            from pg_catalog.unnest(v_pol.polroles) with ordinality as pr(roid, ord)
            join pg_catalog.pg_roles r on r.oid = pr.roid;
        end if;

        execute pg_catalog.format('drop policy if exists %I on public.%I', v_pol.polname, v_tbl);

        v_new_name := pg_catalog.substr(v_pol.polname, 1, 54) || ' (select)';
        if exists (select 1 from pg_catalog.pg_policy p2 where p2.polrelid = v_relid and p2.polname = v_new_name) then
          v_new_name := pg_catalog.substr(v_pol.polname, 1, 46) || ' (select ' || v_pol.oid::text || ')';
        end if;
        execute pg_catalog.format(
          'create policy %I on public.%I as permissive for select to %s using (%s)',
          v_new_name, v_tbl, v_roles_sql, v_pol.using_expr
        );
      else
        execute pg_catalog.format('drop policy if exists %I on public.%I', v_pol.polname, v_tbl);
      end if;
    end loop;
  end loop;
end $$;

drop policy if exists "Customers can view own orders" on public.orders;
create policy "Customers can view own orders"
  on public.orders for select
  to authenticated
  using (
    (auth.uid() = user_id and coalesce(is_test_order, false) = false)
    or public.is_admin()
  );

create policy "Admins can insert orders"
  on public.orders for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update orders"
  on public.orders for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Users can view own order items" on public.order_items;
create policy "Users can view own order items"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1
        from public.orders
       where orders.id = order_items.order_id
         and (
           (orders.user_id = auth.uid() and coalesce(orders.is_test_order, false) = false)
           or public.is_admin()
         )
    )
  );

create policy "Admins can insert order items"
  on public.order_items for insert
  to authenticated
  with check (public.is_admin());

-- NEWSLETTER SUBSCRIBERS
revoke all on table public.newsletter_subscribers from public;
grant insert on table public.newsletter_subscribers to anon, authenticated;
grant select, delete on table public.newsletter_subscribers to authenticated;
grant all on table public.newsletter_subscribers to service_role;

drop policy if exists "Anyone can subscribe to newsletter" on public.newsletter_subscribers;
create policy "Anyone can subscribe to newsletter"
  on public.newsletter_subscribers for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admins can view subscribers" on public.newsletter_subscribers;
create policy "Admins can view subscribers"
  on public.newsletter_subscribers for select
  to authenticated
  using (public.is_admin());

-- OFFERS
revoke all on table public.offers from public;
grant select on table public.offers to anon, authenticated;
grant insert, update, delete on table public.offers to authenticated;
grant all on table public.offers to service_role;

drop policy if exists "Admins can manage offers" on public.offers;
create policy "Admins can manage offers"
  on public.offers for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Public can view active offers" on public.offers;
create policy "Public can view active offers"
  on public.offers for select
  to anon, authenticated
  using (
    is_active = true
    and (starts_at is null or starts_at <= now())
    and (expires_at is null or expires_at >= now())
  );

-- OFFER REDEMPTIONS
revoke all on table public.offer_redemptions from public, anon, authenticated;
grant select on table public.offer_redemptions to authenticated;
grant all on table public.offer_redemptions to service_role;

drop policy if exists "Admins can view offer redemptions" on public.offer_redemptions;
create policy "Admins can view offer redemptions"
  on public.offer_redemptions for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Customers can view own offer redemptions" on public.offer_redemptions;
create policy "Customers can view own offer redemptions"
  on public.offer_redemptions for select
  to authenticated
  using (auth.uid() = user_id);

-- STOREFRONT BANNERS
revoke all on table public.storefront_banners from public;
grant select on table public.storefront_banners to anon, authenticated;
grant insert, update, delete on table public.storefront_banners to authenticated;
grant all on table public.storefront_banners to service_role;

drop policy if exists "Admins can manage storefront banners" on public.storefront_banners;
create policy "Admins can manage storefront banners"
  on public.storefront_banners for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Public can view active storefront banners" on public.storefront_banners;
create policy "Public can view active storefront banners"
  on public.storefront_banners for select
  to anon, authenticated
  using (
    is_active = true
    and (starts_at is null or starts_at <= now())
    and (expires_at is null or expires_at >= now())
  );

-- ============================================================================
-- 6. STORAGE BUCKET & RLS POLICIES (PRODUCT IMAGES)
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
-- 7. DROP OBSOLETE / OVERLOADED RPCs BEFORE RECREATING CANONICAL DEFINITIONS
-- ============================================================================
do $$
declare
  v_sig text;
begin
  for v_sig in
    select pg_catalog.format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    )
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'create_order_atomic',
         'cancel_order',
         'preview_checkout_discount',
         'calculate_single_offer_discount_inr',
         'create_bulk_shipping_test_orders',
         'delete_bulk_shipping_test_orders',
         'discard_incomplete_order',
         'retry_failed_stock_restoration'
       )
  loop
    execute 'drop function if exists ' || v_sig;
  end loop;
end $$;

-- ============================================================================
-- 8. MANUAL STOCK VALIDATION TRIGGER & CANONICAL RPCs
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
  v_parent_order public.orders%rowtype;
  v_is_test_order boolean := false;
  v_prod public.products%rowtype;
  v_clean_pid text;
  v_uuid_from_pid uuid;
  v_lookup_uuid uuid;
  v_matched_size text;
begin
  select o.*
    into v_parent_order
    from public.orders o
   where o.id = new.order_id;

  if not found then
    raise exception 'Parent order (%) was not found for order item.', new.order_id;
  end if;

  v_is_test_order := coalesce((pg_catalog.to_jsonb(v_parent_order) ->> 'is_test_order')::boolean, false);

  if v_is_test_order then
    if auth.uid() is null or not public.is_admin() then
      raise exception 'Only administrators may insert items for test orders.';
    end if;
  end if;

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
     where p.id = v_lookup_uuid;

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
     limit 1;
  end if;

  if not found then
    raise exception 'Product "%" (id: %) was not found in Supabase inventory. Checkout rejected.',
      coalesce(nullif(trim(coalesce(new.product_name, '')), ''), 'Unknown Product'),
      coalesce(v_lookup_uuid::text, v_clean_pid);
  end if;

  if v_prod.price_inr is null or v_prod.price_inr <= 0 then
    raise exception 'Product "%" has an invalid catalog price (%) in Supabase.',
      v_prod.name, coalesce(v_prod.price_inr::text, 'NULL');
  end if;

  if new.unit_price_inr <> v_prod.price_inr then
    raise exception 'Unit price mismatch for "%" (submitted ₹%, authoritative ₹%).',
      v_prod.name, new.unit_price_inr, v_prod.price_inr;
  end if;

  if v_prod.sizes is null or coalesce(pg_catalog.array_length(v_prod.sizes, 1), 0) = 0 then
    raise exception 'Product "%" has no valid sizes configured in Supabase and cannot be ordered.',
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

  new.product_uuid := v_prod.id;
  new.product_id := v_prod.id::text;
  new.product_name := v_prod.name;
  new.product_image := nullif(trim(coalesce(v_prod.image_url, '')), '');
  new.selected_size := v_matched_size;

  -- Manual stock management: NEVER mutate or reject on products.stock_count or products.size_stock.
  new.stock_deducted := false;
  new.stock_restored := false;
  new.stock_restoration_status := 'not_applicable';
  new.stock_restoration_error := null;
  new.stock_tracking_mode := 'none';

  -- Test orders skip active-product checks cleanly.
  if v_is_test_order then
    return new;
  end if;

  if v_prod.is_active is distinct from true then
    raise exception 'Product "%" is no longer active and cannot be purchased.', v_prod.name;
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

  return new;
end;
$$;

revoke all on function public.decrement_stock_on_order_item() from public, anon, authenticated;

drop trigger if exists order_items_decrement_stock on public.order_items;
create trigger order_items_decrement_stock
  before insert on public.order_items
  for each row execute procedure public.decrement_stock_on_order_item();

create or replace function public.calculate_single_offer_discount_inr(
  p_offer public.offers,
  p_cart_lines jsonb,
  p_subtotal_inr integer,
  p_user_id uuid default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_eligible_subtotal_big bigint := 0;
  v_line record;
  v_line_prod_text text;
  v_line_prod_uuid uuid;
  v_line_category text;
  v_line_total_text text;
  v_line_total bigint;
  v_user_redemptions integer := 0;
  v_discount_big bigint := 0;
  v_discount_inr integer := 0;
begin
  if p_offer.id is null then
    return pg_catalog.jsonb_build_object('eligible', false, 'reason', 'Offer not found.', 'discount_inr', 0);
  end if;

  if p_offer.is_active is distinct from true then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', case when p_offer.discount_mode = 'coupon'
        then pg_catalog.format('Coupon code "%s" is currently inactive.', p_offer.coupon_code)
        else 'Offer is inactive.' end,
      'discount_inr', 0
    );
  end if;

  if p_offer.starts_at is not null and v_now < p_offer.starts_at then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', case when p_offer.discount_mode = 'coupon'
        then pg_catalog.format('Coupon code "%s" is not active yet.', p_offer.coupon_code)
        else 'Offer has not started yet.' end,
      'discount_inr', 0
    );
  end if;

  if p_offer.expires_at is not null and v_now > p_offer.expires_at then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', case when p_offer.discount_mode = 'coupon'
        then pg_catalog.format('Coupon code "%s" has expired.', p_offer.coupon_code)
        else 'Offer has expired.' end,
      'discount_inr', 0
    );
  end if;

  if p_offer.total_usage_limit is not null and coalesce(p_offer.usage_count, 0) >= p_offer.total_usage_limit then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', case when p_offer.discount_mode = 'coupon'
        then pg_catalog.format('Coupon code "%s" has reached its maximum usage limit.', p_offer.coupon_code)
        else 'Offer usage limit reached.' end,
      'discount_inr', 0
    );
  end if;

  if p_offer.per_customer_usage_limit is not null and p_user_id is not null then
    select pg_catalog.count(*)::integer
      into v_user_redemptions
      from public.offer_redemptions r
     where r.offer_id = p_offer.id
       and r.user_id = p_user_id;

    if v_user_redemptions >= p_offer.per_customer_usage_limit then
      return pg_catalog.jsonb_build_object(
        'eligible', false,
        'reason', case when p_offer.discount_mode = 'coupon'
          then pg_catalog.format('You have already used coupon code "%s" the maximum allowed times.', p_offer.coupon_code)
          else 'Per-customer offer limit reached.' end,
        'discount_inr', 0
      );
    end if;
  end if;

  if coalesce(p_subtotal_inr, 0) <= 0 then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', 'Add items to your bag before applying an offer.',
      'discount_inr', 0
    );
  end if;

  if p_subtotal_inr < coalesce(p_offer.min_cart_value_inr, 0) then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', pg_catalog.format(
        'Minimum cart value of ₹%s is required%s.',
        p_offer.min_cart_value_inr,
        case when p_offer.coupon_code is not null then ' for coupon "' || p_offer.coupon_code || '"' else '' end
      ),
      'discount_inr', 0
    );
  end if;

  if p_offer.applies_to = 'all' then
    v_eligible_subtotal_big := p_subtotal_inr::bigint;
  elsif p_offer.applies_to = 'products' then
    if pg_catalog.jsonb_typeof(coalesce(p_cart_lines, '[]'::jsonb)) = 'array' then
      for v_line in select value from pg_catalog.jsonb_array_elements(coalesce(p_cart_lines, '[]'::jsonb))
      loop
        if pg_catalog.jsonb_typeof(v_line.value) <> 'object' then
          continue;
        end if;
        v_line_prod_text := nullif(trim(coalesce(v_line.value ->> 'product_uuid', '')), '');
        v_line_total_text := trim(coalesce(v_line.value ->> 'line_total_inr', '0'));

        if v_line_prod_text is not null
           and v_line_prod_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           and v_line_total_text ~ '^\d+$'
           and pg_catalog.length(v_line_total_text) <= 15 then
          v_line_prod_uuid := v_line_prod_text::uuid;
          v_line_total := v_line_total_text::bigint;
          if v_line_prod_uuid = any(coalesce(p_offer.product_ids, array[]::uuid[])) then
            v_eligible_subtotal_big := v_eligible_subtotal_big + v_line_total;
          end if;
        end if;
      end loop;
    end if;
  elsif p_offer.applies_to = 'categories' then
    if pg_catalog.jsonb_typeof(coalesce(p_cart_lines, '[]'::jsonb)) = 'array' then
      for v_line in select value from pg_catalog.jsonb_array_elements(coalesce(p_cart_lines, '[]'::jsonb))
      loop
        if pg_catalog.jsonb_typeof(v_line.value) <> 'object' then
          continue;
        end if;
        v_line_category := pg_catalog.lower(trim(coalesce(v_line.value ->> 'category', '')));
        v_line_total_text := trim(coalesce(v_line.value ->> 'line_total_inr', '0'));

        if v_line_category <> ''
           and v_line_total_text ~ '^\d+$'
           and pg_catalog.length(v_line_total_text) <= 15
           and exists (
             select 1
               from pg_catalog.unnest(coalesce(p_offer.categories, array[]::text[])) as cat
              where pg_catalog.lower(trim(cat)) = v_line_category
           ) then
          v_line_total := v_line_total_text::bigint;
          v_eligible_subtotal_big := v_eligible_subtotal_big + v_line_total;
        end if;
      end loop;
    end if;
  end if;

  if v_eligible_subtotal_big > p_subtotal_inr::bigint then
    v_eligible_subtotal_big := p_subtotal_inr::bigint;
  end if;

  if v_eligible_subtotal_big <= 0 then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', case when p_offer.discount_mode = 'coupon'
        then pg_catalog.format('Coupon "%s" does not apply to any items currently in your bag.', p_offer.coupon_code)
        else 'Offer does not apply to items in your bag.' end,
      'discount_inr', 0
    );
  end if;

  if p_offer.discount_type = 'percentage' then
    v_discount_big := (v_eligible_subtotal_big * p_offer.discount_value::bigint) / 100;
  else
    v_discount_big := p_offer.discount_value::bigint;
  end if;

  if p_offer.max_discount_inr is not null and v_discount_big > p_offer.max_discount_inr::bigint then
    v_discount_big := p_offer.max_discount_inr::bigint;
  end if;

  if v_discount_big > v_eligible_subtotal_big then
    v_discount_big := v_eligible_subtotal_big;
  end if;

  if v_discount_big > p_subtotal_inr::bigint then
    v_discount_big := p_subtotal_inr::bigint;
  end if;

  if v_discount_big < 0 then
    v_discount_big := 0;
  end if;

  v_discount_inr := v_discount_big::integer;

  if v_discount_inr <= 0 then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', 'This offer produces ₹0 discount for the current bag.',
      'discount_inr', 0
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'eligible', true,
    'reason', null,
    'discount_inr', v_discount_inr
  );
end;
$$;

revoke all on function public.calculate_single_offer_discount_inr(
  public.offers, jsonb, integer, uuid, timestamptz
) from public, anon, authenticated;

create or replace function public.preview_checkout_discount(
  p_items jsonb default '[]'::jsonb,
  p_coupon_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid;
  v_now timestamptz := pg_catalog.now();
  v_coupon_code text;
  v_item record;
  v_prod public.products%rowtype;
  v_uuid_from_field uuid;
  v_uuid_from_pid uuid;
  v_lookup_uuid uuid;
  v_qty_type text;
  v_qty_text text;
  v_qty_big bigint;
  v_qty integer;
  v_line_total_big bigint;
  v_subtotal_big bigint := 0;
  v_subtotal_inr integer := 0;
  v_cart_lines jsonb := '[]'::jsonb;
  v_coupon_offer public.offers%rowtype;
  v_eval jsonb;
  v_best_offer public.offers%rowtype;
  v_best_discount integer := 0;
  v_cand public.offers%rowtype;
  v_cand_eval jsonb;
  v_cand_discount integer;
  v_discount_inr integer := 0;
  v_discounted_subtotal integer := 0;
  v_shipping_inr integer := 0;
  v_total_inr integer := 0;
begin
  v_uid := auth.uid();
  v_coupon_code := nullif(pg_catalog.upper(trim(coalesce(p_coupon_code, ''))), '');

  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0 then
    return pg_catalog.jsonb_build_object(
      'valid', v_coupon_code is null,
      'message', case when v_coupon_code is not null then 'Your bag is empty.' else null end,
      'applied_offer_id', null,
      'applied_coupon_code', null,
      'applied_offer_title', null,
      'discount_mode', null,
      'discount_inr', 0,
      'subtotal_inr', 0,
      'shipping_inr', 0,
      'total_inr', 0,
      'stacking_policy', 'no_stacking'
    );
  end if;

  for v_item in
    select
      elem,
      nullif(trim(coalesce(elem ->> 'product_uuid', '')), '') as raw_product_uuid,
      trim(coalesce(elem ->> 'product_id', '')) as product_id
    from pg_catalog.jsonb_array_elements(p_items) as elem
  loop
    if pg_catalog.jsonb_typeof(v_item.elem) <> 'object' then
      raise exception 'Each bag item must be a JSON object.';
    end if;

    v_qty_type := pg_catalog.jsonb_typeof(v_item.elem -> 'quantity');
    v_qty_text := v_item.elem ->> 'quantity';

    if v_qty_type not in ('number', 'string')
       or v_qty_text is null
       or v_qty_text !~ '^\d+$'
       or pg_catalog.length(v_qty_text) > 10 then
      raise exception 'Order item quantity must be a positive integer.';
    end if;

    v_qty_big := v_qty_text::bigint;
    if v_qty_big <= 0 or v_qty_big > 2147483647 then
      raise exception 'Order item quantity must be between 1 and 2147483647.';
    end if;
    v_qty := v_qty_big::integer;

    if v_item.raw_product_uuid is not null then
      if v_item.raw_product_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Malformed product_uuid (%) on bag item.', v_item.raw_product_uuid;
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
      raise exception 'Conflicting product identifiers on bag item.';
    end if;

    v_lookup_uuid := coalesce(v_uuid_from_field, v_uuid_from_pid);

    if v_lookup_uuid is null and v_item.product_id = '' then
      raise exception 'Each bag item must specify a product identifier.';
    end if;

    if v_lookup_uuid is not null then
      select * into v_prod from public.products p where p.id = v_lookup_uuid and p.is_active = true;
    else
      select * into v_prod from public.products p where p.slug = v_item.product_id and p.is_active = true limit 1;
    end if;

    if not found then
      raise exception 'One or more bag products are unavailable. Refresh your bag.';
    end if;

    if v_prod.price_inr is null or v_prod.price_inr <= 0 then
      raise exception 'Product "%" does not have a valid positive price in Supabase.', v_prod.name;
    end if;

    v_line_total_big := v_prod.price_inr::bigint * v_qty::bigint;
    v_subtotal_big := v_subtotal_big + v_line_total_big;
    if v_subtotal_big > 2147483647 then
      raise exception 'Order subtotal exceeds maximum supported integer amount.';
    end if;

    v_cart_lines := v_cart_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_uuid', v_prod.id,
        'category', v_prod.category,
        'line_total_inr', v_line_total_big
      )
    );
  end loop;

  v_subtotal_inr := v_subtotal_big::integer;

  -- Consistent storewide shipping rule based on pre-discount subtotal:
  -- Subtotal >= ₹1,499 gets complimentary shipping (₹0); otherwise ₹99.
  v_shipping_inr := case when v_subtotal_inr = 0 or v_subtotal_inr >= 1499 then 0 else 99 end;

  if v_coupon_code is not null then
    select *
      into v_coupon_offer
      from public.offers o
     where o.discount_mode = 'coupon'
       and pg_catalog.upper(o.coupon_code) = v_coupon_code
     limit 1;

    if not found then
      return pg_catalog.jsonb_build_object(
        'valid', false,
        'message', pg_catalog.format('Coupon code "%s" is not valid.', v_coupon_code),
        'applied_offer_id', null,
        'applied_coupon_code', null,
        'applied_offer_title', null,
        'discount_mode', null,
        'discount_inr', 0,
        'subtotal_inr', v_subtotal_inr,
        'shipping_inr', v_shipping_inr,
        'total_inr', v_subtotal_inr + v_shipping_inr,
        'stacking_policy', 'no_stacking'
      );
    end if;

    v_eval := public.calculate_single_offer_discount_inr(
      v_coupon_offer,
      v_cart_lines,
      v_subtotal_inr,
      v_uid,
      v_now
    );

    if coalesce((v_eval ->> 'eligible')::boolean, false) is distinct from true then
      return pg_catalog.jsonb_build_object(
        'valid', false,
        'message', v_eval ->> 'reason',
        'applied_offer_id', null,
        'applied_coupon_code', null,
        'applied_offer_title', null,
        'discount_mode', null,
        'discount_inr', 0,
        'subtotal_inr', v_subtotal_inr,
        'shipping_inr', v_shipping_inr,
        'total_inr', v_subtotal_inr + v_shipping_inr,
        'stacking_policy', 'no_stacking'
      );
    end if;

    v_discount_inr := (v_eval ->> 'discount_inr')::integer;
    v_discounted_subtotal := GREATEST(0, v_subtotal_inr - v_discount_inr);
    v_total_inr := v_discounted_subtotal + v_shipping_inr;

    return pg_catalog.jsonb_build_object(
      'valid', true,
      'message', pg_catalog.format('Coupon "%s" applied: -₹%s', v_coupon_offer.coupon_code, v_discount_inr),
      'applied_offer_id', v_coupon_offer.id,
      'applied_coupon_code', v_coupon_offer.coupon_code,
      'applied_offer_title', v_coupon_offer.title,
      'discount_mode', v_coupon_offer.discount_mode,
      'discount_inr', v_discount_inr,
      'subtotal_inr', v_subtotal_inr,
      'shipping_inr', v_shipping_inr,
      'total_inr', v_total_inr,
      'stacking_policy', 'no_stacking'
    );
  end if;

  for v_cand in
    select *
      from public.offers o
     where o.discount_mode = 'automatic'
       and o.is_active = true
       and (o.starts_at is null or o.starts_at <= v_now)
       and (o.expires_at is null or o.expires_at >= v_now)
     order by o.created_at desc, o.id asc
  loop
    v_cand_eval := public.calculate_single_offer_discount_inr(
      v_cand,
      v_cart_lines,
      v_subtotal_inr,
      v_uid,
      v_now
    );

    if coalesce((v_cand_eval ->> 'eligible')::boolean, false) then
      v_cand_discount := coalesce((v_cand_eval ->> 'discount_inr')::integer, 0);
      if v_cand_discount > v_best_discount then
        v_best_discount := v_cand_discount;
        v_best_offer := v_cand;
      end if;
    end if;
  end loop;

  v_discount_inr := v_best_discount;
  v_discounted_subtotal := GREATEST(0, v_subtotal_inr - v_discount_inr);
  v_total_inr := v_discounted_subtotal + v_shipping_inr;

  return pg_catalog.jsonb_build_object(
    'valid', true,
    'message', case
      when v_best_offer.id is not null and v_discount_inr > 0
      then pg_catalog.format('Automatic offer "%s" applied: -₹%s', v_best_offer.title, v_discount_inr)
      else null
    end,
    'applied_offer_id', v_best_offer.id,
    'applied_coupon_code', null,
    'applied_offer_title', v_best_offer.title,
    'discount_mode', v_best_offer.discount_mode,
    'discount_inr', v_discount_inr,
    'subtotal_inr', v_subtotal_inr,
    'shipping_inr', v_shipping_inr,
    'total_inr', v_total_inr,
    'stacking_policy', 'no_stacking'
  );
end;
$$;

revoke all on function public.preview_checkout_discount(jsonb, text) from public;
grant execute on function public.preview_checkout_discount(jsonb, text) to anon, authenticated, service_role;

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
  p_idempotency_key text default null,
  p_coupon_code text default null,
  p_discount_inr integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid;
  v_now timestamptz := pg_catalog.now();
  v_idempotency_key text;
  v_req_coupon_code text;
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
  v_line_total_big bigint;
  v_calc_subtotal_big bigint := 0;
  v_calc_subtotal_inr integer;
  v_offer_cart_lines jsonb := '[]'::jsonb;
  v_chosen_offer public.offers%rowtype;
  v_cand_offer public.offers%rowtype;
  v_offer_eval jsonb;
  v_best_auto_discount integer := 0;
  v_best_auto_id uuid := null;
  v_excluded_offer_ids uuid[] := array[]::uuid[];
  v_auto_attempt integer := 0;
  v_calc_discount_inr integer := 0;
  v_discounted_subtotal integer := 0;
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

  v_req_coupon_code := nullif(pg_catalog.upper(trim(coalesce(p_coupon_code, ''))), '');

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
     or (p_discount_inr is not null and p_discount_inr < 0)
     or (p_total_inr is not null and p_total_inr < 0) then
    raise exception 'Order monetary totals must be non-negative integers.';
  end if;

  if p_items is null
     or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item.';
  end if;

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
       for share;

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
       for share;
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

    -- Manual stock management: do NOT reject checkout or deduct stock based on stock_count or size_stock.
    v_resolved_selected_size := v_matched_size;

    v_resolved_product_uuid := v_prod.id;
    v_resolved_product_id := v_prod.id::text;
    v_resolved_product_name := v_prod.name;
    v_resolved_product_image := nullif(trim(coalesce(v_prod.image_url, '')), '');

    v_line_total_big := v_auth_unit_price::bigint * v_qty::bigint;
    v_calc_subtotal_big := v_calc_subtotal_big + v_line_total_big;
    if v_calc_subtotal_big > 2147483647 then
      raise exception 'Order subtotal exceeds maximum supported integer amount.';
    end if;

    v_offer_cart_lines := v_offer_cart_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_uuid', v_resolved_product_uuid,
        'category', v_prod.category,
        'line_total_inr', v_line_total_big
      )
    );

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

  -- Server-side offer / coupon validation & row locking (no stacking)
  v_chosen_offer.id := null;
  v_calc_discount_inr := 0;

  if v_req_coupon_code is not null then
    select *
      into v_chosen_offer
      from public.offers o
     where o.discount_mode = 'coupon'
       and pg_catalog.upper(o.coupon_code) = v_req_coupon_code
     limit 1
     for update;

    if not found then
      raise exception 'Coupon code "%" is invalid.', v_req_coupon_code;
    end if;

    v_offer_eval := public.calculate_single_offer_discount_inr(
      v_chosen_offer,
      v_offer_cart_lines,
      v_calc_subtotal_inr,
      v_uid,
      v_now
    );

    if coalesce((v_offer_eval ->> 'eligible')::boolean, false) is distinct from true then
      raise exception '%', coalesce(v_offer_eval ->> 'reason', 'Coupon code cannot be applied.');
    end if;

    v_calc_discount_inr := coalesce((v_offer_eval ->> 'discount_inr')::integer, 0);
  else
    for v_auto_attempt in 1..20 loop
      v_best_auto_discount := 0;
      v_best_auto_id := null;

      for v_cand_offer in
        select *
          from public.offers o
         where o.discount_mode = 'automatic'
           and o.is_active = true
           and (o.starts_at is null or o.starts_at <= v_now)
           and (o.expires_at is null or o.expires_at >= v_now)
           and not (o.id = any(v_excluded_offer_ids))
         order by o.created_at desc, o.id asc
      loop
        v_offer_eval := public.calculate_single_offer_discount_inr(
          v_cand_offer,
          v_offer_cart_lines,
          v_calc_subtotal_inr,
          v_uid,
          v_now
        );

        if coalesce((v_offer_eval ->> 'eligible')::boolean, false) then
          if coalesce((v_offer_eval ->> 'discount_inr')::integer, 0) > v_best_auto_discount then
            v_best_auto_discount := coalesce((v_offer_eval ->> 'discount_inr')::integer, 0);
            v_best_auto_id := v_cand_offer.id;
          end if;
        end if;
      end loop;

      exit when v_best_auto_id is null;

      select *
        into v_chosen_offer
        from public.offers o
       where o.id = v_best_auto_id
       for update;

      if found then
        v_offer_eval := public.calculate_single_offer_discount_inr(
          v_chosen_offer,
          v_offer_cart_lines,
          v_calc_subtotal_inr,
          v_uid,
          v_now
        );
        if coalesce((v_offer_eval ->> 'eligible')::boolean, false) then
          v_calc_discount_inr := coalesce((v_offer_eval ->> 'discount_inr')::integer, 0);
          exit;
        end if;
      end if;

      v_excluded_offer_ids := pg_catalog.array_append(v_excluded_offer_ids, v_best_auto_id);
      v_chosen_offer.id := null;
      v_calc_discount_inr := 0;
    end loop;
  end if;

  if p_discount_inr is not null and p_discount_inr <> v_calc_discount_inr then
    raise exception 'Discount mismatch (submitted ₹%, server-verified ₹%). Refresh your bag and try again.',
      p_discount_inr, v_calc_discount_inr;
  end if;

  v_discounted_subtotal := GREATEST(0, v_calc_subtotal_inr - v_calc_discount_inr);

  -- Consistent server-side shipping rule (pre-discount subtotal >= ₹1,499 free; otherwise ₹99)
  if v_calc_subtotal_inr >= 1499 then
    v_calc_shipping_inr := 0;
  else
    v_calc_shipping_inr := 99;
  end if;

  v_calc_total_big := v_discounted_subtotal::bigint + v_calc_shipping_inr::bigint;
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
        discount_inr,
        applied_offer_id,
        applied_coupon_code,
        applied_offer_title,
        total_inr,
        notes,
        idempotency_key,
        is_test_order,
        stock_deducted,
        stock_restored,
        stock_restoration_status,
        refund_status
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
        v_calc_discount_inr,
        v_chosen_offer.id,
        v_chosen_offer.coupon_code,
        v_chosen_offer.title,
        v_calc_total_inr,
        nullif(trim(coalesce(p_notes, '')), ''),
        v_idempotency_key,
        false,
        false,
        false,
        'not_applicable',
        'none'
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

  if v_chosen_offer.id is not null and v_calc_discount_inr > 0 then
    insert into public.offer_redemptions (
      offer_id,
      order_id,
      user_id,
      coupon_code,
      discount_inr
    )
    values (
      v_chosen_offer.id,
      v_order.id,
      v_uid,
      v_chosen_offer.coupon_code,
      v_calc_discount_inr
    );

    update public.offers
       set usage_count = usage_count + 1,
           updated_at = pg_catalog.now()
     where id = v_chosen_offer.id;
  end if;

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
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb, text, text, integer
) from public, anon;
grant execute on function public.create_order_atomic(
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb, text, text, integer
) to authenticated, service_role;

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

  select *
    into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  if not v_is_admin and (v_order.user_id is distinct from v_uid or coalesce(v_order.is_test_order, false)) then
    raise exception 'You do not have permission to cancel this order.';
  end if;

  if v_order.order_status = 'cancelled' then
    raise exception 'This order has already been cancelled.';
  end if;

  if v_order.order_status = 'delivered' then
    raise exception 'Delivered orders cannot be cancelled.';
  end if;

  if not v_is_admin and v_order.order_status not in ('pending', 'confirmed', 'packed') then
    raise exception 'Orders in "%" status can no longer be cancelled by the customer.', v_order.order_status;
  end if;

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

-- Admin-only idempotent 20-order QA test generator (isolated, non-deducting)
create or replace function public.create_bulk_shipping_test_orders()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_specs jsonb := $specs$[
    {"seq":1,"order_number":"AK-910001","customer_name":"Aarav Deshmukh","phone":"9990000001","email":"test.shipping.01@example.invalid","line1":"42 A.B. Road, Vijay Nagar","line2":"Near C21 Mall","city":"Indore","state":"Madhya Pradesh","pincode":"452010","order_status":"pending","payment_method":"cod","payment_status":"cod_due","qty1":1,"qty2":0},
    {"seq":2,"order_number":"AK-910002","customer_name":"Ananya Kulkarni","phone":"9990000002","email":"test.shipping.02@example.invalid","line1":"Flat 504, Sea Breeze Towers, 16th Road","line2":"Bandra West","city":"Mumbai","state":"Maharashtra","pincode":"400050","order_status":"confirmed","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":2,"qty2":0},
    {"seq":3,"order_number":"AK-910003","customer_name":"Rohan Malhotra","phone":"9990000003","email":"test.shipping.03@example.invalid","line1":"B-18, Hauz Khas Enclave","line2":"Opposite Deer Park Gate","city":"Delhi","state":"Delhi","pincode":"110016","order_status":"packed","payment_method":"cod","payment_status":"cod_due","qty1":1,"qty2":1},
    {"seq":4,"order_number":"AK-910004","customer_name":"Priya Nair","phone":"9990000004","email":"test.shipping.04@example.invalid","line1":"Plot 14, Sardar Patel Marg, C-Scheme","line2":"Near Central Park","city":"Jaipur","state":"Rajasthan","pincode":"302001","order_status":"pending","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":3,"qty2":0},
    {"seq":5,"order_number":"AK-910005","customer_name":"Vikramaditya Patel","phone":"9990000005","email":"test.shipping.05@example.invalid","line1":"302, Heritage Crest, Commerce Six Road","line2":"Navrangpura","city":"Ahmedabad","state":"Gujarat","pincode":"380009","order_status":"confirmed","payment_method":"cod","payment_status":"cod_due","qty1":1,"qty2":0},
    {"seq":6,"order_number":"AK-910006","customer_name":"Sneha Chatterjee","phone":"9990000006","email":"test.shipping.06@example.invalid","line1":"E-4/88, Arera Colony","line2":"Near 10 Number Market","city":"Bhopal","state":"Madhya Pradesh","pincode":"462016","order_status":"packed","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":2,"qty2":1},
    {"seq":7,"order_number":"AK-910007","customer_name":"Karthik Subramanian","phone":"9990000007","email":"test.shipping.07@example.invalid","line1":"No. 712, 12th Main Road, HAL 2nd Stage","line2":"Indiranagar","city":"Bengaluru","state":"Karnataka","pincode":"560038","order_status":"pending","payment_method":"cod","payment_status":"cod_due","qty1":1,"qty2":0},
    {"seq":8,"order_number":"AK-910008","customer_name":"Meera Reddy","phone":"9990000008","email":"test.shipping.08@example.invalid","line1":"Plot 45, Road No. 36, Jubilee Hills","line2":"Near Peddamma Temple","city":"Hyderabad","state":"Telangana","pincode":"500033","order_status":"confirmed","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":2,"qty2":0},
    {"seq":9,"order_number":"AK-910009","customer_name":"Siddharth Iyer","phone":"9990000009","email":"test.shipping.09@example.invalid","line1":"28, 2nd Main Road, Gandhi Nagar","line2":"Adyar","city":"Chennai","state":"Tamil Nadu","pincode":"600020","order_status":"packed","payment_method":"cod","payment_status":"cod_due","qty1":1,"qty2":1},
    {"seq":10,"order_number":"AK-910010","customer_name":"Divya Sen","phone":"9990000010","email":"test.shipping.10@example.invalid","line1":"19B, Ballygunge Circular Road","line2":"Near St. Lawrence High School","city":"Kolkata","state":"West Bengal","pincode":"700019","order_status":"pending","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":1,"qty2":0},
    {"seq":11,"order_number":"AK-910011","customer_name":"Arjun Tiwari","phone":"9990000011","email":"test.shipping.11@example.invalid","line1":"2/114, Vishal Khand, Gomti Nagar","line2":"Near Ambedkar Park","city":"Lucknow","state":"Uttar Pradesh","pincode":"226010","order_status":"confirmed","payment_method":"cod","payment_status":"cod_due","qty1":3,"qty2":0},
    {"seq":12,"order_number":"AK-910012","customer_name":"Kavya Sinha","phone":"9990000012","email":"test.shipping.12@example.invalid","line1":"204, Shashi Palace, Fraser Road","line2":"Near Dak Bungalow Crossing","city":"Patna","state":"Bihar","pincode":"800001","order_status":"packed","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":1,"qty2":0},
    {"seq":13,"order_number":"AK-910013","customer_name":"Aditya Shukla","phone":"9990000013","email":"test.shipping.13@example.invalid","line1":"House 18, Civil Lines","line2":"Near Raj Bhavan Road","city":"Raipur","state":"Chhattisgarh","pincode":"492001","order_status":"pending","payment_method":"cod","payment_status":"cod_due","qty1":2,"qty2":1},
    {"seq":14,"order_number":"AK-910014","customer_name":"Nidhi Deshpande","phone":"9990000014","email":"test.shipping.14@example.invalid","line1":"784, Bhandarkar Road, Deccan Gymkhana","line2":"Near Goodluck Chowk","city":"Pune","state":"Maharashtra","pincode":"411004","order_status":"confirmed","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":1,"qty2":0},
    {"seq":15,"order_number":"AK-910015","customer_name":"Pranav Mehta","phone":"9990000015","email":"test.shipping.15@example.invalid","line1":"601, Solitaire Residency, Gaurav Path","line2":"Piplod","city":"Surat","state":"Gujarat","pincode":"395007","order_status":"packed","payment_method":"cod","payment_status":"cod_due","qty1":2,"qty2":0},
    {"seq":16,"order_number":"AK-910016","customer_name":"Ishita Menon","phone":"9990000016","email":"test.shipping.16@example.invalid","line1":"39/1840, Panampilly Nagar Main Avenue","line2":"Ernakulam South","city":"Kochi","state":"Kerala","pincode":"682016","order_status":"pending","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":1,"qty2":1},
    {"seq":17,"order_number":"AK-910017","customer_name":"Harshvardhan Gill","phone":"9990000017","email":"test.shipping.17@example.invalid","line1":"SCO 84, Madhya Marg, Sector 17-E","line2":"Near Plaza Fountain","city":"Chandigarh","state":"Chandigarh","pincode":"160017","order_status":"confirmed","payment_method":"cod","payment_status":"cod_due","qty1":1,"qty2":0},
    {"seq":18,"order_number":"AK-910018","customer_name":"Tanya Rawat","phone":"9990000018","email":"test.shipping.18@example.invalid","line1":"58, Rajpur Road, Jakhan","line2":"Opposite Doon Hospital Lane","city":"Dehradun","state":"Uttarakhand","pincode":"248001","order_status":"packed","payment_method":"online_pending","payment_status":"awaiting_payment","qty1":2,"qty2":0},
    {"seq":19,"order_number":"AK-910019","customer_name":"Nikhil Bora","phone":"9990000019","email":"test.shipping.19@example.invalid","line1":"House 11, Zoo Tiniali, GS Road","line2":"Dispur","city":"Guwahati","state":"Assam","pincode":"781005","order_status":"pending","payment_method":"cod","payment_status":"cod_due","qty1":3,"qty2":0},
    {"seq":20,"order_number":"AK-910020","customer_name":"Rituja Mohanty","phone":"9990000020","email":"test.shipping.20@example.invalid","line1":"Plot N-3/124, Saheed Nagar","line2":"Near Maharishi College Road","city":"Bhubaneswar","state":"Odisha","pincode":"751007","order_status":"confirmed","payment_method":"cod","payment_status":"cod_due","qty1":1,"qty2":1}
  ]$specs$::jsonb;
  v_prod_ids uuid[];
  v_prod_count integer;
  v_spec jsonb;
  v_seq integer;
  v_idem_key text;
  v_order_number text;
  v_candidate_num text;
  v_probe integer;
  v_existing_order public.orders%rowtype;
  v_prod1 public.products%rowtype;
  v_prod2 public.products%rowtype;
  v_idx1 integer;
  v_idx2 integer;
  v_size1 text;
  v_size2 text;
  v_qty1 integer;
  v_qty2 integer;
  v_subtotal_inr integer;
  v_shipping_inr integer;
  v_total_inr integer;
  v_created_at timestamptz;
  v_inserted_order public.orders%rowtype;
  v_created_count integer := 0;
  v_existing_count integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator privileges are required to generate bulk shipping test orders.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('apna-kapda-bulk-shipping-test-orders')
  );

  select pg_catalog.array_agg(p.id order by p.created_at asc, p.id asc)
    into v_prod_ids
    from public.products p
   where p.is_active = true
     and p.price_inr is not null
     and p.price_inr > 0
     and coalesce(pg_catalog.array_length(p.sizes, 1), 0) > 0;

  if coalesce(pg_catalog.array_length(v_prod_ids, 1), 0) = 0 then
    select pg_catalog.array_agg(p.id order by p.created_at asc, p.id asc)
      into v_prod_ids
      from public.products p
     where p.price_inr is not null
       and p.price_inr > 0
       and coalesce(pg_catalog.array_length(p.sizes, 1), 0) > 0;
  end if;

  v_prod_count := coalesce(pg_catalog.array_length(v_prod_ids, 1), 0);
  if v_prod_count = 0 then
    raise exception 'Cannot create 20 test orders: no existing products with valid sizes and positive price_inr were found in public.products.';
  end if;

  for v_spec in
    select value from pg_catalog.jsonb_array_elements(v_specs)
  loop
    v_seq := (v_spec ->> 'seq')::integer;
    v_idem_key := 'apna-kapda-shipping-test-' || pg_catalog.lpad(v_seq::text, 2, '0');

    select o.*
      into v_existing_order
      from public.orders o
     where o.idempotency_key = v_idem_key
       and o.is_test_order = true
     limit 1;

    if found then
      v_existing_count := v_existing_count + 1;
      v_results := v_results || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id', v_existing_order.id,
          'order_number', v_existing_order.order_number,
          'customer_name', v_existing_order.customer_name,
          'city', v_existing_order.shipping_address ->> 'city',
          'state', v_existing_order.shipping_address ->> 'state',
          'pincode', v_existing_order.shipping_address ->> 'pincode',
          'order_status', v_existing_order.order_status,
          'payment_method', v_existing_order.payment_method,
          'payment_status', v_existing_order.payment_status,
          'total_inr', v_existing_order.total_inr,
          'status', 'existing'
        )
      );
      continue;
    end if;

    v_order_number := v_spec ->> 'order_number';
    if exists (select 1 from public.orders o where o.order_number = v_order_number) then
      v_order_number := null;
      for v_probe in 910101..999999 loop
        v_candidate_num := 'AK-' || v_probe::text;
        if not exists (select 1 from public.orders o where o.order_number = v_candidate_num) then
          v_order_number := v_candidate_num;
          exit;
        end if;
      end loop;
    end if;

    if v_order_number is null then
      raise exception 'Unable to allocate unique AK-XXXXXX order number for test order #%.', v_seq;
    end if;

    v_idx1 := ((v_seq - 1) % v_prod_count) + 1;
    select * into v_prod1 from public.products p where p.id = v_prod_ids[v_idx1];
    v_size1 := trim(v_prod1.sizes[((v_seq - 1) % pg_catalog.array_length(v_prod1.sizes, 1)) + 1]);
    v_qty1 := GREATEST(1, (v_spec ->> 'qty1')::integer);

    v_subtotal_inr := v_prod1.price_inr * v_qty1;
    v_qty2 := coalesce((v_spec ->> 'qty2')::integer, 0);

    if v_qty2 > 0 then
      v_idx2 := (v_seq % v_prod_count) + 1;
      select * into v_prod2 from public.products p where p.id = v_prod_ids[v_idx2];
      v_size2 := trim(v_prod2.sizes[(v_seq % pg_catalog.array_length(v_prod2.sizes, 1)) + 1]);
      v_subtotal_inr := v_subtotal_inr + (v_prod2.price_inr * v_qty2);
    end if;

    v_shipping_inr := case when v_subtotal_inr >= 1499 then 0 else 99 end;
    v_total_inr := v_subtotal_inr + v_shipping_inr;
    v_created_at := pg_catalog.now() - ((21 - v_seq) * interval '3 hours');

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
      discount_inr,
      total_inr,
      notes,
      idempotency_key,
      is_test_order,
      stock_deducted,
      stock_restored,
      stock_restoration_status,
      refund_status,
      created_at,
      updated_at
    )
    values (
      v_order_number,
      null,
      v_spec ->> 'customer_name',
      v_spec ->> 'email',
      v_spec ->> 'phone',
      pg_catalog.jsonb_build_object(
        'line1', v_spec ->> 'line1',
        'line2', v_spec ->> 'line2',
        'city', v_spec ->> 'city',
        'state', v_spec ->> 'state',
        'pincode', v_spec ->> 'pincode'
      ),
      v_spec ->> 'payment_method',
      v_spec ->> 'payment_status',
      v_spec ->> 'order_status',
      v_subtotal_inr,
      v_shipping_inr,
      0,
      v_total_inr,
      pg_catalog.format(
        'TEST ORDER #%s (Bulk Shipping Center QA) — Synthetic contact/address. Stock not deducted.',
        pg_catalog.lpad(v_seq::text, 2, '0')
      ),
      v_idem_key,
      true,
      false,
      false,
      'not_applicable',
      'none',
      v_created_at,
      v_created_at
    )
    returning * into v_inserted_order;

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
      v_inserted_order.id,
      v_prod1.id,
      v_prod1.id::text,
      v_prod1.name,
      nullif(trim(coalesce(v_prod1.image_url, '')), ''),
      v_size1,
      v_prod1.price_inr,
      v_qty1
    );

    if v_qty2 > 0 then
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
        v_inserted_order.id,
        v_prod2.id,
        v_prod2.id::text,
        v_prod2.name,
        nullif(trim(coalesce(v_prod2.image_url, '')), ''),
        v_size2,
        v_prod2.price_inr,
        v_qty2
      );
    end if;

    v_created_count := v_created_count + 1;
    v_results := v_results || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_inserted_order.id,
        'order_number', v_inserted_order.order_number,
        'customer_name', v_inserted_order.customer_name,
        'city', v_spec ->> 'city',
        'state', v_spec ->> 'state',
        'pincode', v_spec ->> 'pincode',
        'order_status', v_inserted_order.order_status,
        'payment_method', v_inserted_order.payment_method,
        'payment_status', v_inserted_order.payment_status,
        'total_inr', v_inserted_order.total_inr,
        'status', 'created'
      )
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'created_count', v_created_count,
    'existing_count', v_existing_count,
    'total_count', v_created_count + v_existing_count,
    'orders', v_results
  );
end;
$$;

revoke all on function public.create_bulk_shipping_test_orders() from public, anon;
grant execute on function public.create_bulk_shipping_test_orders() to authenticated;

create or replace function public.delete_bulk_shipping_test_orders()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleted_count integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator privileges are required to remove test orders.';
  end if;

  delete from public.orders o
   where o.is_test_order = true;

  get diagnostics v_deleted_count = row_count;

  return pg_catalog.jsonb_build_object(
    'deleted_count', v_deleted_count
  );
end;
$$;

revoke all on function public.delete_bulk_shipping_test_orders() from public, anon;
grant execute on function public.delete_bulk_shipping_test_orders() to authenticated;

-- ============================================================================
-- 9. POST-MIGRATION SECURITY, OVERLOAD, TRIGGER & PERMISSION ASSERTIONS
-- ============================================================================
do $$
declare
  v_tbl text;
  v_rel record;
  v_bad_policies text;
  v_owner_bypass boolean;
  v_fn record;
  v_rpc_name text;
  v_overload_cnt integer;
  v_trigger_cnt integer;
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

  foreach v_tbl in array array[
    'profiles',
    'products',
    'orders',
    'order_items',
    'newsletter_subscribers',
    'offers',
    'offer_redemptions',
    'storefront_banners'
  ]
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

    if v_tbl in ('orders', 'order_items', 'products', 'offers', 'offer_redemptions')
       and coalesce(v_rel.relforcerowsecurity, false)
       and not coalesce(v_owner_bypass, false) then
      raise exception 'FORCE ROW LEVEL SECURITY is enabled on public.% while SECURITY DEFINER owner lacks BYPASSRLS.', v_tbl;
    end if;
  end loop;

  -- Verify zero non-admin permissive INSERT / UPDATE / DELETE / ALL policies on orders & order_items
  select pg_catalog.string_agg(c.relname || '.' || p.polname || ' (cmd=' || p.polcmd || ')', ', ')
    into v_bad_policies
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('orders', 'order_items')
     and p.polpermissive
     and p.polcmd in ('a', 'w', 'd', '*')
     and not (
       (c.relname = 'orders' and p.polcmd = 'a' and p.polname = 'Admins can insert orders')
       or (c.relname = 'orders' and p.polcmd = 'w' and p.polname = 'Admins can update orders')
       or (c.relname = 'order_items' and p.polcmd = 'a' and p.polname = 'Admins can insert order items')
     );

  if v_bad_policies is not null then
    raise exception 'Unexpected permissive mutation policies found on orders/order_items: %', v_bad_policies;
  end if;

  -- Verify PUBLIC & anon privileges are locked down
  if exists (
    select 1
      from information_schema.role_table_grants g
     where g.table_schema = 'public'
       and g.table_name in ('profiles', 'orders', 'order_items', 'offers', 'offer_redemptions', 'storefront_banners')
       and g.grantee = 'PUBLIC'
  ) then
    raise exception 'PUBLIC still holds unexpected table grants on protected tables.';
  end if;

  if pg_catalog.has_table_privilege('anon', 'public.orders', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.orders', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.order_items', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.order_items', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.offer_redemptions', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT') then
    raise exception 'Role anon holds unauthorized privileges on private tables.';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'public.orders', 'DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.order_items', 'DELETE')
     or pg_catalog.has_table_privilege('authenticated', 'public.offer_redemptions', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.offer_redemptions', 'UPDATE')
     or pg_catalog.has_table_privilege('authenticated', 'public.offer_redemptions', 'DELETE') then
    raise exception 'Role authenticated holds unauthorized direct table write/delete privileges.';
  end if;

  -- Verify exactly one overload of each public RPC
  foreach v_rpc_name in array array[
    'catalog_has_real_products',
    'decrement_stock_on_order_item',
    'calculate_single_offer_discount_inr',
    'preview_checkout_discount',
    'create_order_atomic',
    'discard_incomplete_order',
    'cancel_order',
    'create_bulk_shipping_test_orders',
    'delete_bulk_shipping_test_orders'
  ]
  loop
    select pg_catalog.count(*)::integer
      into v_overload_cnt
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_rpc_name;

    if v_overload_cnt <> 1 then
      raise exception 'Expected exactly 1 definition of public.%(), found %.', v_rpc_name, v_overload_cnt;
    end if;

    select p.oid, p.prosecdef, p.proconfig
      into v_fn
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = v_rpc_name
     limit 1;

    if not v_fn.prosecdef or not ('search_path=pg_catalog' = any(coalesce(v_fn.proconfig, array[]::text[]))) then
      raise exception 'Function public.%() must be SECURITY DEFINER with search_path = pg_catalog.', v_rpc_name;
    end if;

    if v_rpc_name in ('catalog_has_real_products', 'preview_checkout_discount') then
      if not pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
         or not pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'Function public.%() must grant EXECUTE to anon and authenticated.', v_rpc_name;
      end if;
    else
      if pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') then
        raise exception 'Function public.%() must NOT grant EXECUTE to anon.', v_rpc_name;
      end if;

      if v_rpc_name in ('create_order_atomic', 'cancel_order', 'create_bulk_shipping_test_orders', 'delete_bulk_shipping_test_orders')
         and not pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'Function public.%() must grant EXECUTE to authenticated.', v_rpc_name;
      end if;

      if v_rpc_name in ('decrement_stock_on_order_item', 'calculate_single_offer_discount_inr', 'discard_incomplete_order')
         and pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
        raise exception 'Internal function public.%() must NOT grant EXECUTE to authenticated.', v_rpc_name;
      end if;
    end if;
  end loop;

  if exists (
    select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'prevent_role_escalation',
         'decrement_stock_on_order_item',
         'create_bulk_shipping_test_orders',
         'delete_bulk_shipping_test_orders'
       )
       and pg_catalog.pg_get_functiondef(p.oid) ~* '\mcurrent_user\M'
  ) then
    raise exception 'SECURITY DEFINER authorization function still references current_user instead of auth.uid()/is_admin().';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'profiles'
       and p.polname = 'Users can update own profile'
       and pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) ~* '\mprofiles\M'
  ) then
    raise exception 'Policy "Users can update own profile" still queries public.profiles recursively.';
  end if;

  select pg_catalog.count(*)::integer
    into v_trigger_cnt
    from pg_catalog.pg_trigger tg
    join pg_catalog.pg_class c on c.oid = tg.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'order_items'
     and not tg.tgisinternal
     and tg.tgname = 'order_items_decrement_stock';

  if v_trigger_cnt <> 1 then
    raise exception 'Expected exactly 1 order_items_decrement_stock trigger on public.order_items, found %.', v_trigger_cnt;
  end if;
end $$;

-- Refresh PostgREST schema cache so REST endpoints immediately see reconciled columns, tables & RPCs
notify pgrst, 'reload schema';
