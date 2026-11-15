-- ============================================================================
-- APNA KAPDA — Offers, Coupons, Redemptions, Storefront Banner & Checkout Migration
-- Non-destructive & idempotent: preserves all existing orders, products & users.
-- Run this script in: Supabase Dashboard -> SQL Editor -> New Query.
-- Do NOT run blindly against uninspected environments; review before applying.
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. OFFERS & COUPONS TABLE
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
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.normalize_offer_row() from public, anon, authenticated;

drop trigger if exists offers_normalize_before_write on public.offers;
create trigger offers_normalize_before_write
  before insert or update on public.offers
  for each row execute procedure public.normalize_offer_row();

-- 2. OFFER REDEMPTIONS LEDGER TABLE
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

-- 3. STOREFRONT PROMOTIONAL BANNERS TABLE
create table if not exists public.storefront_banners (
  id uuid primary key default gen_random_uuid(),
  banner_text text not null,
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

create index if not exists storefront_banners_active_schedule_idx
  on public.storefront_banners (is_active, starts_at, expires_at, updated_at desc);

drop trigger if exists storefront_banners_set_updated_at on public.storefront_banners;
create trigger storefront_banners_set_updated_at
  before update on public.storefront_banners
  for each row execute procedure public.set_updated_at();

-- 4. ADD DISCOUNT TRACKING COLUMNS TO EXISTING ORDERS TABLE (NON-DESTRUCTIVE)
alter table public.orders
  add column if not exists applied_offer_id uuid references public.offers(id) on delete set null;
alter table public.orders
  add column if not exists applied_coupon_code text;
alter table public.orders
  add column if not exists applied_offer_title text;
alter table public.orders
  add column if not exists discount_inr integer not null default 0;

do $$
begin
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

-- 5. RLS POLICIES FOR OFFERS, REDEMPTIONS & BANNERS
alter table public.offers enable row level security;
alter table public.offer_redemptions enable row level security;
alter table public.storefront_banners enable row level security;

drop policy if exists "Admins can manage offers" on public.offers;
create policy "Admins can manage offers"
  on public.offers for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Public can view active offers" on public.offers;
create policy "Public can view active offers"
  on public.offers for select
  using (
    is_active = true
    and (starts_at is null or starts_at <= now())
    and (expires_at is null or expires_at >= now())
  );

revoke insert, update, delete on table public.offer_redemptions from public, anon, authenticated;

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

drop policy if exists "Admins can manage storefront banners" on public.storefront_banners;
create policy "Admins can manage storefront banners"
  on public.storefront_banners for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Public can view active storefront banners" on public.storefront_banners;
create policy "Public can view active storefront banners"
  on public.storefront_banners for select
  using (
    is_active = true
    and (starts_at is null or starts_at <= now())
    and (expires_at is null or expires_at >= now())
  );

-- 6. SERVER-SIDE DISCOUNT EVALUATION HELPERS
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
  v_eligible_subtotal_big bigint := 0;
  v_line record;
  v_line_prod_uuid uuid;
  v_line_category text;
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

  if p_offer.starts_at is not null and p_now < p_offer.starts_at then
    return pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', case when p_offer.discount_mode = 'coupon'
        then pg_catalog.format('Coupon code "%s" is not active yet.', p_offer.coupon_code)
        else 'Offer has not started yet.' end,
      'discount_inr', 0
    );
  end if;

  if p_offer.expires_at is not null and p_now > p_offer.expires_at then
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
    for v_line in select value from pg_catalog.jsonb_array_elements(coalesce(p_cart_lines, '[]'::jsonb))
    loop
      v_line_prod_uuid := nullif(v_line.value ->> 'product_uuid', '')::uuid;
      v_line_total := coalesce((v_line.value ->> 'line_total_inr')::bigint, 0);
      if v_line_prod_uuid is not null and v_line_prod_uuid = any(coalesce(p_offer.product_ids, array[]::uuid[])) then
        v_eligible_subtotal_big := v_eligible_subtotal_big + v_line_total;
      end if;
    end loop;
  elsif p_offer.applies_to = 'categories' then
    for v_line in select value from pg_catalog.jsonb_array_elements(coalesce(p_cart_lines, '[]'::jsonb))
    loop
      v_line_category := pg_catalog.lower(trim(coalesce(v_line.value ->> 'category', '')));
      v_line_total := coalesce((v_line.value ->> 'line_total_inr')::bigint, 0);
      if v_line_category <> '' and exists (
        select 1
          from pg_catalog.unnest(coalesce(p_offer.categories, array[]::text[])) as cat
         where pg_catalog.lower(trim(cat)) = v_line_category
      ) then
        v_eligible_subtotal_big := v_eligible_subtotal_big + v_line_total;
      end if;
    end loop;
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
    v_qty := coalesce((v_item.elem ->> 'quantity')::integer, 0);
    if v_qty <= 0 then
      raise exception 'Order item quantity must be positive.';
    end if;

    if v_item.raw_product_uuid is not null
       and v_item.raw_product_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_uuid_from_field := v_item.raw_product_uuid::uuid;
    else
      v_uuid_from_field := null;
    end if;

    if v_item.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_uuid_from_pid := v_item.product_id::uuid;
    else
      v_uuid_from_pid := null;
    end if;

    v_lookup_uuid := coalesce(v_uuid_from_field, v_uuid_from_pid);

    if v_lookup_uuid is not null then
      select * into v_prod from public.products p where p.id = v_lookup_uuid and p.is_active = true;
    else
      select * into v_prod from public.products p where p.slug = v_item.product_id and p.is_active = true limit 1;
    end if;

    if not found then
      raise exception 'One or more bag products are unavailable. Refresh your bag.';
    end if;

    v_line_total_big := v_prod.price_inr::bigint * v_qty::bigint;
    v_subtotal_big := v_subtotal_big + v_line_total_big;

    v_cart_lines := v_cart_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_uuid', v_prod.id,
        'category', v_prod.category,
        'line_total_inr', v_line_total_big
      )
    );
  end loop;

  v_subtotal_inr := v_subtotal_big::integer;

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
        'shipping_inr', case when v_subtotal_inr >= 1499 then 0 else 99 end,
        'total_inr', v_subtotal_inr + case when v_subtotal_inr >= 1499 then 0 else 99 end,
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
        'shipping_inr', case when v_subtotal_inr >= 1499 then 0 else 99 end,
        'total_inr', v_subtotal_inr + case when v_subtotal_inr >= 1499 then 0 else 99 end,
        'stacking_policy', 'no_stacking'
      );
    end if;

    v_discount_inr := (v_eval ->> 'discount_inr')::integer;
    v_discounted_subtotal := pg_catalog.greatest(0, v_subtotal_inr - v_discount_inr);
    v_shipping_inr := case when v_discounted_subtotal >= 1499 or v_subtotal_inr = 0 then 0 else 99 end;
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

  -- Automatic offer evaluation (no stacking: selects single highest eligible discount)
  for v_cand in
    select *
      from public.offers o
     where o.discount_mode = 'automatic'
       and o.is_active = true
       and (o.starts_at is null or o.starts_at <= v_now)
       and (o.expires_at is null or o.expires_at >= v_now)
     order by o.created_at desc
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
  v_discounted_subtotal := pg_catalog.greatest(0, v_subtotal_inr - v_discount_inr);
  v_shipping_inr := case when v_discounted_subtotal >= 1499 or v_subtotal_inr = 0 then 0 else 99 end;
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
grant execute on function public.preview_checkout_discount(jsonb, text) to anon, authenticated;

-- 7. UPDATE create_order_atomic TO SERVER-VALIDATE & APPLY OFFERS/COUPONS ATOMICALLY
drop function if exists public.create_order_atomic(
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb
);
drop function if exists public.create_order_atomic(
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb, text
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
  v_offer_cart_lines jsonb := '[]'::jsonb;
  v_chosen_offer public.offers%rowtype;
  v_cand_offer public.offers%rowtype;
  v_offer_eval jsonb;
  v_best_auto_discount integer := 0;
  v_best_auto_id uuid := null;
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

  -- Server-side trusted offer / coupon resolution & locking (default policy: no stacking)
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
    -- Find single best eligible automatic offer (no stacking), then lock & verify atomically
    for v_cand_offer in
      select *
        from public.offers o
       where o.discount_mode = 'automatic'
         and o.is_active = true
         and (o.starts_at is null or o.starts_at <= v_now)
         and (o.expires_at is null or o.expires_at >= v_now)
       order by o.created_at desc
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

    if v_best_auto_id is not null then
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
        else
          v_chosen_offer.id := null;
          v_calc_discount_inr := 0;
        end if;
      end if;
    end if;
  end if;

  if p_discount_inr is not null and p_discount_inr <> v_calc_discount_inr then
    raise exception 'Discount mismatch (submitted ₹%, server-verified ₹%). Refresh your bag and try again.',
      p_discount_inr, v_calc_discount_inr;
  end if;

  v_discounted_subtotal := pg_catalog.greatest(0, v_calc_subtotal_inr - v_calc_discount_inr);

  -- Explicit trusted server-side shipping rule after discount:
  -- Orders >= ₹1,499 qualify for complimentary shipping (₹0); orders < ₹1,499 pay ₹99.
  if v_discounted_subtotal >= 1499 or v_calc_subtotal_inr = 0 then
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

  -- Generate strictly 6-digit AK-XXXXXX order number
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
        v_calc_discount_inr,
        v_chosen_offer.id,
        v_chosen_offer.coupon_code,
        v_chosen_offer.title,
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

  -- Record redemption & increment offer usage count atomically when an offer was applied
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
) to authenticated;

notify pgrst, 'reload schema';
