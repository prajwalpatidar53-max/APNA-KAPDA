-- ============================================================================
-- APNA KAPDA — Atomic Order Cancellation & Inventory Restoration Migration
-- Safe & non-destructive: preserves all existing customers, products & orders.
-- Run in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

-- 1. Optional per-size stock map on public.products (non-breaking alongside stock_count)
alter table public.products
  add column if not exists size_stock jsonb not null default '{}'::jsonb;

-- 2. Cancellation, actor, refund tracking, and idempotent stock restoration columns on public.orders
alter table public.orders
  add column if not exists cancelled_at timestamptz;

alter table public.orders
  add column if not exists cancelled_by text;

alter table public.orders
  add column if not exists cancelled_by_user_id uuid references auth.users(id) on delete set null;

alter table public.orders
  add column if not exists cancellation_reason text;

alter table public.orders
  add column if not exists stock_restored boolean not null default false;

alter table public.orders
  add column if not exists refund_status text not null default 'none';

-- 3. Safely update CHECK constraints on public.orders without touching existing rows
do $$
declare
  c_name text;
begin
  -- Drop existing payment_status check constraints on public.orders so we can include refund_pending & cancelled
  for c_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'orders'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%payment_status%'
  loop
    execute format('alter table public.orders drop constraint if exists %I', c_name);
  end loop;

  alter table public.orders
    add constraint orders_payment_status_check
    check (payment_status in ('cod_due', 'awaiting_payment', 'paid', 'refund_pending', 'failed', 'refunded', 'cancelled'));

  -- Ensure cancelled_by check constraint
  alter table public.orders drop constraint if exists orders_cancelled_by_check;
  alter table public.orders
    add constraint orders_cancelled_by_check
    check (cancelled_by is null or cancelled_by in ('customer', 'admin'));

  -- Ensure refund_status check constraint
  alter table public.orders drop constraint if exists orders_refund_status_check;
  alter table public.orders
    add constraint orders_refund_status_check
    check (refund_status in ('none', 'not_required', 'pending', 'processed', 'failed'));
end $$;

-- 4. Atomic stock deduction when order_items are inserted during checkout
create or replace function public.decrement_stock_on_order_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prod public.products%rowtype;
  v_curr_size_qty integer;
  v_next_size_stock jsonb;
begin
  select *
    into v_prod
    from public.products
   where id = new.product_uuid
      or slug = new.product_id
      or ('ak-' || slug) = new.product_id
   limit 1
   for update;

  if not found then
    return new;
  end if;

  v_next_size_stock := coalesce(v_prod.size_stock, '{}'::jsonb);

  if (v_next_size_stock ? new.selected_size)
     and (v_next_size_stock ->> new.selected_size) ~ '^\d+$' then
    v_curr_size_qty := (v_next_size_stock ->> new.selected_size)::integer;
    v_next_size_stock := jsonb_set(
      v_next_size_stock,
      array[new.selected_size],
      to_jsonb(greatest(0, v_curr_size_qty - new.quantity)),
      true
    );
  end if;

  update public.products
     set stock_count = greatest(0, stock_count - new.quantity),
         size_stock = v_next_size_stock,
         updated_at = now()
   where id = v_prod.id;

  return new;
end;
$$;

drop trigger if exists order_items_decrement_stock on public.order_items;
create trigger order_items_decrement_stock
  after insert on public.order_items
  for each row execute procedure public.decrement_stock_on_order_item();

-- 5. Atomic & secure order cancellation RPC
--    - Enforces ownership (customers: own orders only; admins: any order)
--    - Enforces eligible statuses (customers: pending/confirmed/packed; admins: pending/confirmed/packed/shipped)
--    - Prevents duplicate cancellations and double stock restoration via FOR UPDATE + stock_restored guard
--    - Handles COD, awaiting online payment, and paid online orders accurately without fake refunds
create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text default null,
  p_actor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_is_admin boolean;
  v_order public.orders%rowtype;
  v_item record;
  v_prod public.products%rowtype;
  v_curr_size_qty integer;
  v_next_size_stock jsonb;
  v_new_payment_status text;
  v_new_refund_status text;
  v_actor text;
  v_restored_units integer := 0;
  v_updated_order public.orders%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Authentication required to cancel an order.';
  end if;

  v_is_admin := public.is_admin();

  -- Lock the order row exclusively to prevent concurrent duplicate cancellations
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

  -- Determine honest payment & refund state
  if v_order.payment_status = 'paid' then
    v_new_payment_status := 'refund_pending';
    v_new_refund_status := 'pending';
  elsif v_order.payment_status in ('cod_due', 'awaiting_payment') then
    v_new_payment_status := 'cancelled';
    v_new_refund_status := 'not_required';
  elsif v_order.payment_status = 'refunded' then
    v_new_payment_status := 'refunded';
    v_new_refund_status := 'processed';
  else
    v_new_payment_status := v_order.payment_status;
    v_new_refund_status := 'not_required';
  end if;

  -- Prevent non-admins from spoofing cancelled_by = 'admin'
  if v_is_admin and coalesce(lower(trim(p_actor)), 'admin') = 'admin' then
    v_actor := 'admin';
  else
    v_actor := 'customer';
  end if;

  -- Atomic idempotent inventory restoration (runs at most once per order)
  if coalesce(v_order.stock_restored, false) = false then
    for v_item in
      select product_uuid, product_id, selected_size, quantity
        from public.order_items
       where order_id = v_order.id
    loop
      select *
        into v_prod
        from public.products
       where id = v_item.product_uuid
          or slug = v_item.product_id
          or ('ak-' || slug) = v_item.product_id
       limit 1
       for update;

      if found then
        v_next_size_stock := coalesce(v_prod.size_stock, '{}'::jsonb);

        if (v_next_size_stock ? v_item.selected_size)
           and (v_next_size_stock ->> v_item.selected_size) ~ '^\d+$' then
          v_curr_size_qty := (v_next_size_stock ->> v_item.selected_size)::integer;
          v_next_size_stock := jsonb_set(
            v_next_size_stock,
            array[v_item.selected_size],
            to_jsonb(v_curr_size_qty + v_item.quantity),
            true
          );
        end if;

        update public.products
           set stock_count = stock_count + v_item.quantity,
               size_stock = v_next_size_stock,
               updated_at = now()
         where id = v_prod.id;

        v_restored_units := v_restored_units + v_item.quantity;
      end if;
    end loop;
  end if;

  update public.orders
     set order_status = 'cancelled',
         payment_status = v_new_payment_status,
         refund_status = v_new_refund_status,
         cancelled_at = now(),
         cancelled_by = v_actor,
         cancelled_by_user_id = v_uid,
         cancellation_reason = nullif(trim(coalesce(p_reason, '')), ''),
         stock_restored = true,
         updated_at = now()
   where id = v_order.id
  returning * into v_updated_order;

  return jsonb_build_object(
    'order', to_jsonb(v_updated_order),
    'restored_units', v_restored_units
  );
end;
$$;

revoke all on function public.cancel_order(uuid, text, text) from public;
grant execute on function public.cancel_order(uuid, text, text) to authenticated;

-- Refresh PostgREST schema cache so the new RPC and columns are immediately callable
notify pgrst, 'reload schema';
