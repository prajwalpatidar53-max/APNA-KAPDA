-- ============================================================================
-- APNA KAPDA — Atomic Order Creation, Cancellation & Inventory Migration
-- Safe & non-destructive: preserves all existing customers, products & orders.
-- Does NOT restore stock for historical orders where stock was never deducted.
-- Prevents client-side price/shipping/total manipulation, preserves unrelated
-- and combined CHECK constraints, and validates total/size stock & overflows.
-- Run in: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================================

-- 0a. Verify required baseline tables and columns exist before migrating
do $$
declare
  v_missing text;
begin
  select pg_catalog.string_agg(req.tbl || '.' || req.col, ', ' order by req.tbl, req.col)
    into v_missing
    from (
      values
        ('products', 'id'),
        ('products', 'slug'),
        ('products', 'name'),
        ('products', 'price_inr'),
        ('products', 'stock_count'),
        ('products', 'is_active'),
        ('orders', 'id'),
        ('orders', 'user_id'),
        ('orders', 'order_status'),
        ('orders', 'payment_status'),
        ('orders', 'payment_method'),
        ('orders', 'subtotal_inr'),
        ('orders', 'shipping_inr'),
        ('orders', 'total_inr'),
        ('orders', 'created_at'),
        ('orders', 'updated_at'),
        ('order_items', 'id'),
        ('order_items', 'order_id'),
        ('order_items', 'product_uuid'),
        ('order_items', 'product_id'),
        ('order_items', 'product_name'),
        ('order_items', 'selected_size'),
        ('order_items', 'unit_price_inr'),
        ('order_items', 'quantity'),
        ('order_items', 'created_at')
    ) as req(tbl, col)
   where not exists (
     select 1
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = req.tbl
        and c.column_name = req.col
   );

  if v_missing is not null then
    raise exception
      'Baseline schema is missing required table/column(s): %. Run supabase/schema.sql first or verify existing schema before applying this migration.',
      v_missing;
  end if;
end $$;

-- 0b. Best-effort pre-migration audit of existing triggers on public.orders & public.order_items
--     LIMITATION: Static inspection checks pg_proc.prosrc and direct pg_depend references.
--     It CANNOT guarantee detection of multi-hop indirect calls, dynamic SQL (`EXECUTE ...`)
--     constructed at runtime, or non-SQL/C triggers. Review any custom triggers manually
--     in Supabase (Database -> Triggers) before deploying to production.
do $$
declare
  v_trig record;
  v_src_lower text;
  v_has_direct_stock_ref boolean;
  v_has_dynamic_sql boolean;
begin
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
      pg_catalog.position('products' in v_src_lower) > 0
      or pg_catalog.position('stock_count' in v_src_lower) > 0
      or pg_catalog.position('size_stock' in v_src_lower) > 0
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
        'Existing trigger "%" on public.% (%.%()) references products/stock. Review or drop it before migrating to prevent duplicate stock deduction.',
        v_trig.trig_name, v_trig.tbl_name, v_trig.fn_schema, v_trig.fn_name;
    elsif v_trig.fn_schema = 'public' and (v_has_dynamic_sql or v_trig.fn_lang not in ('sql', 'plpgsql')) then
      raise exception
        'Custom trigger "%" on public.% (%.%(), language %) uses dynamic SQL or non-SQL logic that cannot be statically audited for stock deduction. Inspect it manually before migrating.',
        v_trig.trig_name, v_trig.tbl_name, v_trig.fn_schema, v_trig.fn_name, v_trig.fn_lang;
    else
      raise notice
        'Existing trigger "%" on public.% (%.%()) kept. Note: static audit cannot trace indirect helper calls; confirm manually it does not modify inventory.',
        v_trig.trig_name, v_trig.tbl_name, v_trig.fn_schema, v_trig.fn_name;
    end if;
  end loop;
end $$;

-- 1. Optional per-size stock map on public.products (non-breaking alongside stock_count)
alter table public.products
  add column if not exists size_stock jsonb not null default '{}'::jsonb;

-- 2. Cancellation, actor, refund tracking, and granular deduction/restoration state
--    Historical orders safely default to stock_deducted = false, stock_restored = false,
--    and stock_restoration_status = 'not_applicable'.
alter table public.orders
  add column if not exists cancelled_at timestamptz;

alter table public.orders
  add column if not exists cancelled_by text;

alter table public.orders
  add column if not exists cancelled_by_user_id uuid references auth.users(id) on delete set null;

alter table public.orders
  add column if not exists cancellation_reason text;

alter table public.orders
  add column if not exists stock_deducted boolean not null default false;

alter table public.orders
  add column if not exists stock_restored boolean not null default false;

alter table public.orders
  add column if not exists stock_restoration_status text not null default 'not_applicable';

alter table public.orders
  add column if not exists refund_status text not null default 'none';

alter table public.order_items
  add column if not exists stock_deducted boolean not null default false;

alter table public.order_items
  add column if not exists stock_restored boolean not null default false;

alter table public.order_items
  add column if not exists stock_restoration_status text not null default 'not_applicable';

alter table public.order_items
  add column if not exists stock_restoration_error text;

-- 3. Safely validate existing rows and migrate ONLY target CHECK constraints.
--    - Preserves all unrelated CHECK constraints (including those mentioning target columns
--      in unrelated guards such as `(order_status <> 'delivered') OR (...)`).
--    - For combined constraints that restrict a target column via `= ANY (ARRAY[...])`,
--      recreates the COMPLETE original constraint logic with the expanded allowed values.
--    - Drops and replaces ONLY pure single-column allowed-values CHECK constraints for the
--      target status columns.
--    - Aborts safely if any constraint touching a target column cannot be preserved cleanly.
do $$
declare
  v_orders_relid oid := 'public.orders'::regclass;
  v_order_items_relid oid := 'public.order_items'::regclass;
  v_con record;
  v_target_cols text[];
  v_unrelated_cols text[];
  v_col text;
  v_skel text;
  v_enum_match text[];
  v_enum_inner text;
  v_existing_lits text[];
  v_req_values text[];
  v_merged_lits text[];
  v_new_array_items text;
  v_rewritten_def text;
  v_remaining_after_enum text;
  v_occupied_order_cons text[] := array[]::text[];
  v_occupied_item_cons text[] := array[]::text[];
  v_invalid_order_statuses text;
  v_invalid_payment_statuses text;
  v_invalid_cancelled_by text;
  v_invalid_refund_statuses text;
  v_invalid_restoration_statuses text;
  v_invalid_item_restoration_statuses text;
begin
  -- Verify existing row data before migrating constraints
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

  -- Inspect existing CHECK constraints on public.orders using pg_constraint.conkey
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

    -- Case 1: Completely unrelated constraint (no target columns in conkey)
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

    -- Check if this is a pure single-column allowed-values CHECK constraint
    if pg_catalog.array_length(v_target_cols, 1) = 1
       and coalesce(pg_catalog.array_length(v_unrelated_cols, 1), 0) = 0 then
      v_col := v_target_cols[1];

      -- Strip string literals first so literal contents never confuse structural analysis
      v_skel := pg_catalog.regexp_replace(pg_catalog.lower(v_con.def), '''([^'']|'''')*''', '''''', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '::(character varying|varchar|bpchar|char|text)(\[\])?', '', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '\m' || v_col || '\M', '', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '\m(check|is\s+null|any|array|in|or)\M', '', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '[''\(\)\[\],=\s]+', '', 'g');

      if v_skel = '' then
        -- Pure single-column allowed-values constraint: safe to replace cleanly
        execute pg_catalog.format(
          'alter table public.orders drop constraint if exists %I',
          v_con.conname
        );
        continue;
      end if;
    end if;

    -- Case 2: Combined or custom CHECK constraint mentioning one or more target columns.
    -- Recreate its COMPLETE original logic + required new values if cleanly rewritable,
    -- preserve it untouched if it is a safe non-blocking implication guard,
    -- or abort safely if its compatibility cannot be guaranteed.
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

        -- Ensure the column does not also appear outside this single enum clause in a potentially conflicting rule
        v_remaining_after_enum := pg_catalog.regexp_replace(
          v_rewritten_def,
          '\(?\s*\m' || v_col || '\M\s*\)?(?:\s*::\s*[a-z0-9_ ]+)?\s*=\s*any\s*\(\s*\(?\s*array\[[^\]]*\](?:\s*::\s*[a-z0-9_ ]+\[\])?\s*\)?\s*\)',
          '__TARGET_COL_ENUM__',
          'i'
        );

        if pg_catalog.regexp_replace(v_remaining_after_enum, '''([^'']|'''')*''', '''''', 'g') ~* ('\m' || v_col || '\M') then
          raise exception
            'Combined CHECK constraint "%" on public.orders (%) references column "%" multiple times and cannot be safely auto-rewritten. Update it manually before migrating.',
            v_con.conname, v_con.def, v_col;
        end if;

        if pg_catalog.regexp_replace(v_remaining_after_enum, '''([^'']|'''')*''', '''''', 'g') ~* '\mnot\M\s*\(?\s*__TARGET_COL_ENUM__' then
          raise exception
            'Negated CHECK constraint "%" on public.orders (%) negates column "%" and cannot be safely preserved automatically. Update it manually before migrating.',
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
        -- Not an `= ANY (ARRAY[...])` restriction: verify whether it is strictly a non-blocking
        -- implication guard (e.g. `(order_status <> 'delivered') OR (updated_at IS NOT NULL)`).
        v_skel := pg_catalog.regexp_replace(pg_catalog.lower(v_rewritten_def), '''([^'']|'''')*''', '''''', 'g');
        v_skel := pg_catalog.regexp_replace(v_skel, '::(character varying|varchar|bpchar|char|text)(\[\])?', '', 'g');

        if not (
          v_skel ~ ('\m' || v_col || '\M\s*(<>|!=|is\s+distinct\s+from)\s*''''')
          and v_skel ~ '\mor\M'
          and not (v_skel ~ ('\m' || v_col || '\M\s*(=|\min\M|\mnot\s+in\M)'))
          and not (pg_catalog.lower(v_rewritten_def) ~ ('\m' || v_col || '\M\s*(<>|!=|is\s+distinct\s+from)\s*''(cancelled|refund_pending|restored|partial|failed|deducted|customer|admin|not_required|processed)'''))
        ) then
          raise exception
            'Custom/combined CHECK constraint "%" on public.orders (%) references column "%" in a form that cannot be automatically verified or preserved. Update or review it manually before migrating.',
            v_con.conname, v_con.def, v_col;
        end if;
      end if;
    end loop;

    if v_rewritten_def is distinct from v_con.def then
      execute pg_catalog.format(
        'alter table public.orders drop constraint %I',
        v_con.conname
      );
      execute pg_catalog.format(
        'alter table public.orders add constraint %I %s%s',
        v_con.conname,
        v_rewritten_def,
        case when not v_con.convalidated then ' not valid' else '' end
      );
      raise notice 'Updated combined CHECK constraint "%" on public.orders while preserving complete original logic.', v_con.conname;
    else
      raise notice 'Preserved unrelated combined/guard CHECK constraint "%" on public.orders: %', v_con.conname, v_con.def;
    end if;

    v_occupied_order_cons := pg_catalog.array_append(v_occupied_order_cons, v_con.conname);
  end loop;

  -- Add standalone status CHECK constraints (avoiding name collision if a combined constraint keeps the default name)
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

  -- Inspect existing CHECK constraints on public.order_items using pg_constraint.conkey
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
          filter (where a.attname = 'stock_restoration_status'),
        array[]::text[]
      ),
      coalesce(
        pg_catalog.array_agg(a.attname::text order by a.attnum)
          filter (where a.attname <> 'stock_restoration_status'),
        array[]::text[]
      )
      into v_target_cols, v_unrelated_cols
      from pg_catalog.unnest(coalesce(v_con.conkey, array[]::smallint[])) as k(attnum)
      join pg_catalog.pg_attribute a
        on a.attrelid = v_order_items_relid
       and a.attnum = k.attnum
       and not a.attisdropped;

    if coalesce(pg_catalog.array_length(v_target_cols, 1), 0) = 0 then
      if v_con.conname = 'order_items_stock_restoration_status_check' then
        raise exception
          'Unrelated constraint "%" on public.order_items conflicts with target constraint name (%). Rename it before migrating.',
          v_con.conname, v_con.def;
      end if;
      continue;
    end if;

    if pg_catalog.array_length(v_target_cols, 1) = 1
       and coalesce(pg_catalog.array_length(v_unrelated_cols, 1), 0) = 0 then
      v_skel := pg_catalog.regexp_replace(pg_catalog.lower(v_con.def), '''([^'']|'''')*''', '''''', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '::(character varying|varchar|bpchar|char|text)(\[\])?', '', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '\mstock_restoration_status\M', '', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '\m(check|is\s+null|any|array|in|or)\M', '', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '[''\(\)\[\],=\s]+', '', 'g');

      if v_skel = '' then
        execute pg_catalog.format(
          'alter table public.order_items drop constraint if exists %I',
          v_con.conname
        );
        continue;
      end if;
    end if;

    v_rewritten_def := v_con.def;
    v_req_values := array['not_applicable', 'deducted', 'restored', 'failed'];

    v_enum_match := pg_catalog.regexp_match(
      v_rewritten_def,
      '(\(?\s*\mstock_restoration_status\M\s*\)?(?:\s*::\s*[a-z0-9_ ]+)?\s*=\s*any\s*\(\s*\(?\s*array\[([^\]]*)\](?:\s*::\s*[a-z0-9_ ]+\[\])?\s*\)?\s*\))',
      'i'
    );

    if v_enum_match is not null then
      v_enum_inner := v_enum_match[2];
      v_remaining_after_enum := pg_catalog.regexp_replace(
        v_rewritten_def,
        '\(?\s*\mstock_restoration_status\M\s*\)?(?:\s*::\s*[a-z0-9_ ]+)?\s*=\s*any\s*\(\s*\(?\s*array\[[^\]]*\](?:\s*::\s*[a-z0-9_ ]+\[\])?\s*\)?\s*\)',
        '__TARGET_COL_ENUM__',
        'i'
      );

      if pg_catalog.regexp_replace(v_remaining_after_enum, '''([^'']|'''')*''', '''''', 'g') ~* '\mstock_restoration_status\M'
         or pg_catalog.regexp_replace(v_remaining_after_enum, '''([^'']|'''')*''', '''''', 'g') ~* '\mnot\M\s*\(?\s*__TARGET_COL_ENUM__' then
        raise exception
          'Combined CHECK constraint "%" on public.order_items (%) cannot be safely auto-rewritten. Update it manually before migrating.',
          v_con.conname, v_con.def;
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
        pg_catalog.format('stock_restoration_status = ANY (ARRAY[%s])', v_new_array_items)
      );

      execute pg_catalog.format('alter table public.order_items drop constraint %I', v_con.conname);
      execute pg_catalog.format(
        'alter table public.order_items add constraint %I %s%s',
        v_con.conname,
        v_rewritten_def,
        case when not v_con.convalidated then ' not valid' else '' end
      );
      raise notice 'Updated combined CHECK constraint "%" on public.order_items while preserving complete original logic.', v_con.conname;
    else
      v_skel := pg_catalog.regexp_replace(pg_catalog.lower(v_rewritten_def), '''([^'']|'''')*''', '''''', 'g');
      v_skel := pg_catalog.regexp_replace(v_skel, '::(character varying|varchar|bpchar|char|text)(\[\])?', '', 'g');

      if v_skel ~ '\mstock_restoration_status\M\s*(<>|!=|is\s+distinct\s+from)\s*'''''
         and v_skel ~ '\mor\M'
         and not (v_skel ~ '\mstock_restoration_status\M\s*(=|\min\M|\mnot\s+in\M)')
         and not (pg_catalog.lower(v_rewritten_def) ~ '\mstock_restoration_status\M\s*(<>|!=|is\s+distinct\s+from)\s*''(deducted|restored|failed)''') then
        raise notice 'Preserved unrelated guard CHECK constraint "%" on public.order_items: %', v_con.conname, v_con.def;
      else
        raise exception
          'Custom/combined CHECK constraint "%" on public.order_items (%) references stock_restoration_status and cannot be automatically verified or preserved. Update or review it manually before migrating.',
          v_con.conname, v_con.def;
      end if;
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
end $$;

-- 3b. Close direct PostgREST table-insert bypass on public.orders and public.order_items
--     Authenticated customers must place orders via create_order_atomic() so server-side
--     order numbers, product prices, shipping fees, totals, and stock are enforced atomically.
drop policy if exists "Authenticated customers can create own orders" on public.orders;
drop policy if exists "Admins can insert orders" on public.orders;
create policy "Admins can insert orders"
  on public.orders for insert
  with check (public.is_admin());

drop policy if exists "Users can insert own order items" on public.order_items;
drop policy if exists "Admins can insert order items" on public.order_items;
create policy "Admins can insert order items"
  on public.order_items for insert
  with check (public.is_admin());

-- 4. Atomic stock & price validation/deduction trigger when order_items are inserted
--    - Sole stock deduction mechanism in the codebase & database (prevents double deduction).
--    - Verifies product_uuid and product_id match the exact same product when both are supplied.
--    - Real products: MUST exist in public.products, be active, have valid positive price_inr,
--      and have non-NULL non-negative stock_count >= quantity.
--    - Preview/demo products: ONLY permitted when public.products has ZERO rows total
--      (including inactive rows), product_uuid is NULL, product_id matches the explicit 8-SKU
--      preview catalog, selected_size matches that SKU's actual catalog sizes, and price matches.
--    - Size validation: whenever products.size_stock is non-empty, the selected size key must
--      exist unambiguously (no case-insensitive duplicates), hold a valid integer in 0..2147483647,
--      and have >= quantity available. When size_stock is {}, validates selected_size against sizes[].
create or replace function public.decrement_stock_on_order_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_prod public.products%rowtype;
  v_uuid_from_pid uuid;
  v_lookup_uuid uuid;
  v_next_size_stock jsonb;
  v_has_size_inventory boolean := false;
  v_size_match_count integer := 0;
  v_size_key text;
  v_size_val_type text;
  v_size_val_text text;
  v_curr_size_big bigint;
  v_updated_rows integer;
  v_is_preview_catalog_mode boolean := false;
  v_expected_preview_price integer;
  v_expected_preview_name text;
  v_allowed_preview_sizes text[];
  v_matched_size text;
  v_matched_size_count integer := 0;
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

  if new.product_id is not null
     and new.product_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_uuid_from_pid := new.product_id::uuid;
  else
    v_uuid_from_pid := null;
  end if;

  if new.product_uuid is not null and v_uuid_from_pid is not null and new.product_uuid <> v_uuid_from_pid then
    raise exception 'Order item product_uuid (%) and product_id (%) do not refer to the same product.',
      new.product_uuid, new.product_id;
  end if;

  v_lookup_uuid := coalesce(new.product_uuid, v_uuid_from_pid);

  if v_lookup_uuid is null and nullif(trim(coalesce(new.product_id, '')), '') is null then
    raise exception 'Order item must specify product_uuid or product_id.';
  end if;

  if v_lookup_uuid is not null then
    select p.*
      into v_prod
      from public.products p
     where p.id = v_lookup_uuid
     for update;

    if found and nullif(trim(coalesce(new.product_id, '')), '') is not null then
      if not (
        new.product_id = v_prod.id::text
        or new.product_id = v_prod.slug
        or new.product_id = ('ak-' || v_prod.slug)
      ) then
        raise exception 'Order item product_uuid (%) does not match product_id (%) for "%".',
          v_lookup_uuid, new.product_id, v_prod.name;
      end if;
    end if;
  else
    select p.*
      into v_prod
      from public.products p
     where p.slug = new.product_id
        or ('ak-' || p.slug) = new.product_id
     order by case when p.slug = new.product_id then 1 else 2 end
     limit 1
     for update;
  end if;

  if not found then
    -- Preview/demo items are ONLY allowed when public.products has ZERO rows total
    -- (including inactive rows), no UUID was supplied, product_id matches an approved
    -- preview SKU from src/data/catalog.ts, and selected_size is valid for that SKU.
    v_is_preview_catalog_mode := not exists (
      select 1 from public.products
    );

    select p_sku.expected_price, p_sku.expected_name, p_sku.allowed_sizes
      into v_expected_preview_price, v_expected_preview_name, v_allowed_preview_sizes
      from (
        values
          ('ak-classic-oversized-tee', 799,  'Classic Oversized Tee',  array['XS', 'S', 'M', 'L', 'XL', 'XXL']::text[]),
          ('ak-everyday-linen-shirt',  1299, 'Everyday Linen Shirt',   array['S', 'M', 'L', 'XL', 'XXL']::text[]),
          ('ak-modern-essential-top',  899,  'Modern Essential Top',   array['XS', 'S', 'M', 'L', 'XL']::text[]),
          ('ak-relaxed-fit-trousers',  1499, 'Relaxed Fit Trousers',   array['S', 'M', 'L', 'XL', 'XXL']::text[]),
          ('ak-everyday-street-tee',   749,  'Everyday Street Tee',    array['XS', 'S', 'M', 'L', 'XL']::text[]),
          ('ak-urban-layer-shirt',     1199, 'Urban Layer Shirt',      array['XS', 'S', 'M', 'L', 'XL', 'XXL']::text[]),
          ('ak-signature-denim',       1799, 'Signature Denim',        array['S', 'M', 'L', 'XL', 'XXL']::text[]),
          ('ak-minimal-daily-dress',   1599, 'Minimal Daily Dress',    array['XS', 'S', 'M', 'L', 'XL']::text[])
      ) as p_sku(sku, expected_price, expected_name, allowed_sizes)
     where p_sku.sku = new.product_id;

    if v_is_preview_catalog_mode
       and v_lookup_uuid is null
       and v_expected_preview_price is not null then
      select sz
        into v_matched_size
        from pg_catalog.unnest(v_allowed_preview_sizes) as sz
       where pg_catalog.lower(trim(sz)) = pg_catalog.lower(trim(new.selected_size))
       limit 1;

      if v_matched_size is null then
        raise exception 'Size "%" is not available for preview item "%".',
          new.selected_size, v_expected_preview_name;
      end if;

      if new.unit_price_inr <> v_expected_preview_price then
        raise exception 'Price mismatch for preview item "%" (submitted ₹%, expected ₹%).',
          v_expected_preview_name, new.unit_price_inr, v_expected_preview_price;
      end if;

      new.product_name := v_expected_preview_name;
      new.selected_size := v_matched_size;
      new.stock_deducted := false;
      new.stock_restored := false;
      new.stock_restoration_status := 'not_applicable';
      new.stock_restoration_error := null;
      return new;
    end if;

    raise exception 'Product "%" (id: %) was not found in Supabase inventory. Checkout rejected.',
      coalesce(nullif(trim(coalesce(new.product_name, '')), ''), 'Unknown Product'),
      coalesce(v_lookup_uuid::text, new.product_id);
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

  select exists (
    select 1 from pg_catalog.jsonb_object_keys(v_next_size_stock)
  )
    into v_has_size_inventory;

  -- Strict size inventory enforcement whenever size_stock contains any size keys
  if v_has_size_inventory then
    select pg_catalog.count(*)::integer, pg_catalog.min(k)
      into v_size_match_count, v_size_key
      from pg_catalog.jsonb_object_keys(v_next_size_stock) as k
     where pg_catalog.lower(trim(k)) = pg_catalog.lower(trim(new.selected_size));

    if v_size_match_count > 1 then
      raise exception 'Ambiguous size inventory keys matched "%" for "%". Clean up duplicate size keys in size_stock.',
        new.selected_size, v_prod.name;
    end if;

    if v_size_match_count = 0 or v_size_key is null then
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

    new.selected_size := v_size_key;

    v_next_size_stock := pg_catalog.jsonb_set(
      v_next_size_stock,
      array[v_size_key],
      pg_catalog.to_jsonb((v_curr_size_big - new.quantity::bigint)::integer),
      true
    );
  elsif coalesce(pg_catalog.array_length(v_prod.sizes, 1), 0) > 0 then
    -- Total-stock-only mode (size_stock = '{}'): still reject invalid/unavailable sizes
    select pg_catalog.count(*)::integer, pg_catalog.min(sz)
      into v_matched_size_count, v_matched_size
      from pg_catalog.unnest(v_prod.sizes) as sz
     where pg_catalog.lower(trim(sz)) = pg_catalog.lower(trim(new.selected_size));

    if v_matched_size_count > 1 then
      raise exception 'Ambiguous size "%" configured on "%".',
        new.selected_size, v_prod.name;
    end if;

    if v_matched_size_count = 0 or v_matched_size is null then
      raise exception 'Size "%" is not available for "%".',
        new.selected_size, v_prod.name;
    end if;

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

-- 5. Single-transaction atomic order creation RPC with server-side price, shipping & order-number authority
--    - Ignores client prices/shipping/totals for calculation: resolves every real product
--      from public.products and uses public.products.price_inr, name, id, and image_url.
--    - Verifies product_uuid and product_id refer to the exact same product when both supplied.
--    - Generates unique server-side order_number following project AK-XXXXXX convention
--      (and validates format if a caller provides one).
--    - Enforces shipping rule (free >= ₹1,499; otherwise ₹99) and recalculates subtotal & total.
--    - Rejects inactive/missing products, invalid quantities/sizes, negative/invalid prices,
--      inconsistent client prices/totals, and integer overflows.
--    - Preview fallback activates ONLY when public.products has zero rows total (including inactive).
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
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid;
  v_req_order_number text;
  v_order_number text;
  v_rand_bytes bytea;
  v_rand_int integer;
  v_attempt integer;
  v_payment_status text;
  v_is_preview_catalog_mode boolean := false;
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
  v_allowed_preview_sizes text[];
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

  if nullif(trim(coalesce(p_customer_name, '')), '') is null
     or nullif(trim(coalesce(p_customer_email, '')), '') is null
     or nullif(trim(coalesce(p_customer_phone, '')), '') is null then
    raise exception 'Customer contact details are required.';
  end if;

  v_req_order_number := nullif(trim(coalesce(p_order_number, '')), '');
  if v_req_order_number is not null and v_req_order_number !~ '^AK-[0-9]{6}$' then
    raise exception 'Invalid order number format (%). Expected AK-XXXXXX.', v_req_order_number;
  end if;

  -- Generate authoritative server-side unique order number matching AK-XXXXXX convention
  for v_attempt in 1..25 loop
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
      v_order_number := 'AK-' || pg_catalog.lpad(((v_rand_int % 90000000) + 10000000)::text, 8, '0');
      exit when not exists (
        select 1 from public.orders o where o.order_number = v_order_number
      );
      v_order_number := null;
    end loop;
  end if;

  if v_order_number is null then
    raise exception 'Unable to allocate a unique order number. Please retry checkout.';
  end if;

  if p_shipping_address is null
     or pg_catalog.jsonb_typeof(p_shipping_address) <> 'object'
     or p_shipping_address = '{}'::jsonb then
    raise exception 'Valid shipping address object is required.';
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

  -- Preview mode is ONLY active when public.products has zero rows total (including inactive rows).
  v_is_preview_catalog_mode := not exists (
    select 1 from public.products
  );

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

    -- Resolve authoritative product from public.products and lock row
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
          or v_item.product_id = ('ak-' || v_prod.slug)
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
          or ('ak-' || p.slug) = v_item.product_id
       order by case when p.slug = v_item.product_id then 1 else 2 end
       limit 1
       for update;
    end if;

    if found then
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

      v_resolved_product_uuid := v_prod.id;
      v_resolved_product_id := v_prod.id::text;
      v_resolved_product_name := v_prod.name;
      v_resolved_product_image := nullif(trim(coalesce(v_prod.image_url, '')), '');
      v_resolved_selected_size := v_item.selected_size;
    else
      -- Explicit unseeded preview catalog fallback (zero product rows total, NULL UUID, approved SKU + size + price)
      v_auth_unit_price := null;
      v_resolved_product_name := null;
      v_allowed_preview_sizes := null;

      if v_is_preview_catalog_mode and v_product_uuid is null then
        select p_sku.expected_price, p_sku.expected_name, p_sku.allowed_sizes
          into v_auth_unit_price, v_resolved_product_name, v_allowed_preview_sizes
          from (
            values
              ('ak-classic-oversized-tee', 799,  'Classic Oversized Tee',  array['XS', 'S', 'M', 'L', 'XL', 'XXL']::text[]),
              ('ak-everyday-linen-shirt',  1299, 'Everyday Linen Shirt',   array['S', 'M', 'L', 'XL', 'XXL']::text[]),
              ('ak-modern-essential-top',  899,  'Modern Essential Top',   array['XS', 'S', 'M', 'L', 'XL']::text[]),
              ('ak-relaxed-fit-trousers',  1499, 'Relaxed Fit Trousers',   array['S', 'M', 'L', 'XL', 'XXL']::text[]),
              ('ak-everyday-street-tee',   749,  'Everyday Street Tee',    array['XS', 'S', 'M', 'L', 'XL']::text[]),
              ('ak-urban-layer-shirt',     1199, 'Urban Layer Shirt',      array['XS', 'S', 'M', 'L', 'XL', 'XXL']::text[]),
              ('ak-signature-denim',       1799, 'Signature Denim',        array['S', 'M', 'L', 'XL', 'XXL']::text[]),
              ('ak-minimal-daily-dress',   1599, 'Minimal Daily Dress',    array['XS', 'S', 'M', 'L', 'XL']::text[])
          ) as p_sku(sku, expected_price, expected_name, allowed_sizes)
         where p_sku.sku = v_item.product_id;
      end if;

      if v_auth_unit_price is null then
        raise exception 'Product (id: %) was not found in Supabase inventory. Checkout rejected.',
          coalesce(v_product_uuid::text, v_item.product_id);
      end if;

      select sz
        into v_resolved_selected_size
        from pg_catalog.unnest(v_allowed_preview_sizes) as sz
       where pg_catalog.lower(trim(sz)) = pg_catalog.lower(trim(v_item.selected_size))
       limit 1;

      if v_resolved_selected_size is null then
        raise exception 'Size "%" is not available for preview product "%".',
          v_item.selected_size, v_resolved_product_name;
      end if;

      if v_client_unit_price is not null and v_client_unit_price <> v_auth_unit_price then
        raise exception 'Price mismatch for preview product "%" (submitted ₹%, expected ₹%). Refresh your bag and try again.',
          v_resolved_product_name, v_client_unit_price, v_auth_unit_price;
      end if;

      v_resolved_product_uuid := null;
      v_resolved_product_id := v_item.product_id;
      v_resolved_product_image := v_item.product_image;
    end if;

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
    notes
  )
  values (
    v_order_number,
    v_uid,
    trim(p_customer_name),
    trim(p_customer_email),
    trim(p_customer_phone),
    p_shipping_address,
    p_payment_method,
    v_payment_status,
    'pending',
    v_calc_subtotal_inr,
    v_calc_shipping_inr,
    v_calc_total_inr,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into v_order;

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
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb
) from public, anon;
grant execute on function public.create_order_atomic(
  text, text, text, text, jsonb, text, integer, integer, integer, text, jsonb
) to authenticated;

-- 6. Legacy empty-shell cleanup helper retained strictly scoped (cannot affect historical orders
--    or any order with items; direct customer table inserts are also blocked via RLS in Section 3b).
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

-- 7. Atomic & secure order cancellation RPC
--    - Enforces authentication, ownership (customer own orders; admin any order), and status eligibility.
--    - Prevents duplicate cancellations and double restoration via FOR UPDATE + item-level flags.
--    - Safely skips stock restoration for historical orders where stock_deducted = false.
--    - Validates total stock_count (rejects NULL, < 0, or integer overflow > 2147483647) and
--      enforces exact size_stock restoration parity (rejects missing, ambiguous, non-numeric,
--      or overflowing size stock without partially updating total stock).
--    - Never marks an item restored unless the public.products update succeeded for 1 row.
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
  v_item record;
  v_prod public.products%rowtype;
  v_next_total_big bigint;
  v_next_size_stock jsonb;
  v_has_size_inventory boolean;
  v_size_match_count integer;
  v_size_key text;
  v_size_val_type text;
  v_size_val_text text;
  v_curr_size_big bigint;
  v_next_size_big bigint;
  v_updated_rows integer;
  v_item_error text;
  v_new_payment_status text;
  v_new_refund_status text;
  v_actor text;
  v_restored_units integer := 0;
  v_restored_items integer := 0;
  v_failed_items integer := 0;
  v_failed_units integer := 0;
  v_failed_item_details jsonb := '[]'::jsonb;
  v_deducted_count integer := 0;
  v_restored_count integer := 0;
  v_unrestored_count integer := 0;
  v_order_stock_restored boolean := false;
  v_order_restoration_status text := 'not_applicable';
  v_warning text := null;
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

  -- Atomic idempotent stock restoration:
  -- Only restores items where stock_deducted = true and stock_restored = false.
  -- Historical pre-migration orders (stock_deducted = false) are NOT restocked.
  if coalesce(v_order.stock_deducted, false) = true then
    for v_item in
      select oi.id,
             oi.product_uuid,
             oi.product_id,
             oi.product_name,
             oi.selected_size,
             oi.quantity
        from public.order_items oi
       where oi.order_id = v_order.id
         and coalesce(oi.stock_deducted, false) = true
         and coalesce(oi.stock_restored, false) = false
       order by coalesce(oi.product_uuid::text, oi.product_id), oi.id
         for update of oi
    loop
      v_item_error := null;
      v_size_match_count := 0;
      v_size_key := null;
      v_has_size_inventory := false;
      v_next_total_big := null;

      select p.*
        into v_prod
        from public.products p
       where p.id = v_item.product_uuid
          or p.id::text = v_item.product_id
          or p.slug = v_item.product_id
          or ('ak-' || p.slug) = v_item.product_id
       order by case
         when p.id = v_item.product_uuid then 1
         when p.id::text = v_item.product_id then 2
         when p.slug = v_item.product_id then 3
         else 4
       end
       limit 1
       for update;

      if not found then
        v_item_error := 'Product record no longer exists in public.products (deleted or missing).';
      elsif v_item.quantity is null or v_item.quantity <= 0 then
        v_item_error := pg_catalog.format(
          'Order item has invalid quantity (%); refusing stock restoration.',
          coalesce(v_item.quantity::text, 'NULL')
        );
      elsif v_prod.stock_count is null or v_prod.stock_count < 0 then
        v_item_error := pg_catalog.format(
          'Product "%" has an invalid total stock_count (%); refusing stock restoration.',
          v_prod.name, coalesce(v_prod.stock_count::text, 'NULL')
        );
      else
        v_next_total_big := v_prod.stock_count::bigint + v_item.quantity::bigint;
        if v_next_total_big > 2147483647 then
          v_item_error := pg_catalog.format(
            'Restoring %s unit(s) to "%" would overflow integer stock_count (% + % > 2147483647).',
            v_item.quantity, v_prod.name, v_prod.stock_count, v_item.quantity
          );
        end if;
      end if;

      if v_item_error is null then
        v_next_size_stock := coalesce(v_prod.size_stock, '{}'::jsonb);

        if pg_catalog.jsonb_typeof(v_next_size_stock) <> 'object' then
          v_item_error := pg_catalog.format(
            'Product "%" has invalid non-object size_stock; refusing partial total-only restoration.',
            v_prod.name
          );
        else
          select exists (
            select 1 from pg_catalog.jsonb_object_keys(v_next_size_stock)
          )
            into v_has_size_inventory;

          if v_has_size_inventory then
            select pg_catalog.count(*)::integer, pg_catalog.min(k)
              into v_size_match_count, v_size_key
              from pg_catalog.jsonb_object_keys(v_next_size_stock) as k
             where pg_catalog.lower(trim(k)) = pg_catalog.lower(trim(v_item.selected_size));

            if v_size_match_count > 1 then
              v_item_error := pg_catalog.format(
                'Ambiguous size_stock keys matched "%" for "%"; refusing partial or ambiguous restoration.',
                v_item.selected_size, v_prod.name
              );
            elsif v_size_match_count = 0 or v_size_key is null then
              v_item_error := pg_catalog.format(
                'Original size key "%" was not found in size_stock for "%"; refusing partial total-only restoration.',
                v_item.selected_size, v_prod.name
              );
            else
              v_size_val_type := pg_catalog.jsonb_typeof(v_next_size_stock -> v_size_key);
              v_size_val_text := v_next_size_stock ->> v_size_key;

              if v_size_val_type not in ('number', 'string')
                 or v_size_val_text is null
                 or v_size_val_text !~ '^\d+$'
                 or pg_catalog.length(v_size_val_text) > 10 then
                v_item_error := pg_catalog.format(
                  'Invalid or non-numeric size_stock value (%) for "%" in size "%"; refusing partial total-only restoration.',
                  coalesce(v_size_val_text, 'null'), v_prod.name, v_size_key
                );
              else
                v_curr_size_big := v_size_val_text::bigint;
                if v_curr_size_big < 0 or v_curr_size_big > 2147483647 then
                  v_item_error := pg_catalog.format(
                    'Out-of-range size_stock value (%) for "%" in size "%"; refusing partial total-only restoration.',
                    v_size_val_text, v_prod.name, v_size_key
                  );
                else
                  v_next_size_big := v_curr_size_big + v_item.quantity::bigint;
                  if v_next_size_big > 2147483647 then
                    v_item_error := pg_catalog.format(
                      'Restoring %s unit(s) to "%" in size "%" would overflow integer size_stock (% + % > 2147483647).',
                      v_item.quantity, v_prod.name, v_size_key, v_curr_size_big, v_item.quantity
                    );
                  else
                    v_next_size_stock := pg_catalog.jsonb_set(
                      v_next_size_stock,
                      array[v_size_key],
                      pg_catalog.to_jsonb(v_next_size_big::integer),
                      true
                    );
                  end if;
                end if;
              end if;
            end if;
          end if;
        end if;
      end if;

      if v_item_error is null then
        update public.products
           set stock_count = v_next_total_big::integer,
               size_stock = v_next_size_stock,
               updated_at = pg_catalog.now()
         where id = v_prod.id
           and stock_count is not null
           and stock_count >= 0;

        get diagnostics v_updated_rows = row_count;

        if v_updated_rows <> 1 then
          v_item_error := pg_catalog.format(
            'Total stock_count update could not be performed for "%"; item was not marked restored.',
            v_prod.name
          );
        end if;
      end if;

      if v_item_error is null then
        update public.order_items
           set product_uuid = coalesce(product_uuid, v_prod.id),
               stock_restored = true,
               stock_restoration_status = 'restored',
               stock_restoration_error = null
         where id = v_item.id;

        v_restored_items := v_restored_items + 1;
        v_restored_units := v_restored_units + v_item.quantity;
      else
        update public.order_items
           set stock_restored = false,
               stock_restoration_status = 'failed',
               stock_restoration_error = v_item_error
         where id = v_item.id;

        v_failed_items := v_failed_items + 1;
        v_failed_units := v_failed_units + v_item.quantity;
        v_failed_item_details := v_failed_item_details || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'order_item_id', v_item.id,
            'product_id', v_item.product_id,
            'product_name', v_item.product_name,
            'selected_size', v_item.selected_size,
            'quantity', v_item.quantity,
            'error', v_item_error
          )
        );
      end if;
    end loop;

    -- Verify exact item-level restoration totals before setting order-level restoration flags
    select
      pg_catalog.count(*) filter (where coalesce(oi.stock_deducted, false) = true),
      pg_catalog.count(*) filter (where coalesce(oi.stock_deducted, false) = true and coalesce(oi.stock_restored, false) = true),
      pg_catalog.count(*) filter (where coalesce(oi.stock_deducted, false) = true and coalesce(oi.stock_restored, false) = false)
      into v_deducted_count, v_restored_count, v_unrestored_count
      from public.order_items oi
     where oi.order_id = v_order.id;

    if v_deducted_count > 0 and v_unrestored_count = 0 then
      v_order_stock_restored := true;
      v_order_restoration_status := 'restored';
    elsif v_restored_count > 0 and v_unrestored_count > 0 then
      v_order_stock_restored := false;
      v_order_restoration_status := 'partial';
      v_warning := pg_catalog.format(
        'Order cancelled, but stock restoration was incomplete: %s deducted item(s) could not be restored (check order_items.stock_restoration_error).',
        v_unrestored_count
      );
    else
      v_order_stock_restored := false;
      v_order_restoration_status := 'failed';
      v_warning := 'Order cancelled, but deducted stock could not be restored (check order_items.stock_restoration_error).';
    end if;
  else
    -- Historical pre-migration order or un-seeded preview order
    v_order_stock_restored := false;
    v_order_restoration_status := 'not_applicable';
  end if;

  update public.orders
     set order_status = 'cancelled',
         payment_status = v_new_payment_status,
         refund_status = v_new_refund_status,
         cancelled_at = pg_catalog.now(),
         cancelled_by = v_actor,
         cancelled_by_user_id = v_uid,
         cancellation_reason = nullif(trim(coalesce(p_reason, '')), ''),
         stock_restored = v_order_stock_restored,
         stock_restoration_status = v_order_restoration_status,
         updated_at = pg_catalog.now()
   where id = v_order.id
  returning * into v_updated_order;

  return pg_catalog.jsonb_build_object(
    'order', pg_catalog.to_jsonb(v_updated_order),
    'restored_units', v_restored_units,
    'restored_items', v_restored_items,
    'failed_items', v_failed_items,
    'failed_units', v_failed_units,
    'failed_item_details', v_failed_item_details,
    'stock_restored', v_order_stock_restored,
    'stock_restoration_status', v_order_restoration_status,
    'warning', v_warning
  );
end;
$$;

revoke all on function public.cancel_order(uuid, text, text) from public, anon;
grant execute on function public.cancel_order(uuid, text, text) to authenticated;

-- 8. Admin-only atomic retry RPC for failed stock restoration items
--    - Enforces public.is_admin() so customers can never execute recovery.
--    - Locks public.orders, eligible public.order_items (stock_deducted = true,
--      stock_restored = false, stock_restoration_status = 'failed'), and target public.products.
--    - Validates total stock_count (rejects NULL, < 0, integer overflow > 2147483647),
--      enforces exact & unambiguous size_stock restoration parity (or sizes[] validation when
--      binding a replacement product without size_stock), and checks overflow safety.
--    - Never marks an item restored unless the public.products update succeeded for 1 row.
create or replace function public.retry_failed_stock_restoration(
  p_order_id uuid,
  p_order_item_id uuid default null,
  p_target_product_uuid uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_uid uuid;
  v_order public.orders%rowtype;
  v_item record;
  v_prod public.products%rowtype;
  v_next_total_big bigint;
  v_next_size_stock jsonb;
  v_has_size_inventory boolean;
  v_size_match_count integer;
  v_size_key text;
  v_size_val_type text;
  v_size_val_text text;
  v_curr_size_big bigint;
  v_next_size_big bigint;
  v_updated_rows integer;
  v_item_error text;
  v_retried_items integer := 0;
  v_restored_items integer := 0;
  v_restored_units integer := 0;
  v_failed_items integer := 0;
  v_failed_item_details jsonb := '[]'::jsonb;
  v_deducted_count integer := 0;
  v_restored_count integer := 0;
  v_unrestored_count integer := 0;
  v_order_stock_restored boolean := false;
  v_order_restoration_status text := 'not_applicable';
  v_warning text := null;
  v_updated_order public.orders%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null or not public.is_admin() then
    raise exception 'Admin privileges required to retry failed stock restoration.';
  end if;

  if p_target_product_uuid is not null and p_order_item_id is null then
    raise exception 'p_order_item_id must be specified when providing p_target_product_uuid.';
  end if;

  -- Lock parent order to serialize concurrent retries/cancellations
  select *
    into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  if v_order.order_status <> 'cancelled' then
    raise exception 'Stock restoration retry applies only to cancelled orders (current status: %).', v_order.order_status;
  end if;

  if coalesce(v_order.stock_deducted, false) = false then
    raise exception 'Order did not have stock deducted; nothing to restore.';
  end if;

  if p_target_product_uuid is not null then
    perform 1
      from public.products p
     where p.id = p_target_product_uuid;

    if not found then
      raise exception 'Target product % does not exist in public.products.', p_target_product_uuid;
    end if;
  end if;

  for v_item in
    select oi.id,
           oi.product_uuid,
           oi.product_id,
           oi.product_name,
           oi.selected_size,
           oi.quantity
      from public.order_items oi
     where oi.order_id = v_order.id
       and (p_order_item_id is null or oi.id = p_order_item_id)
       and coalesce(oi.stock_deducted, false) = true
       and coalesce(oi.stock_restored, false) = false
       and oi.stock_restoration_status = 'failed'
     order by coalesce(oi.product_uuid::text, oi.product_id), oi.id
       for update of oi
  loop
    v_retried_items := v_retried_items + 1;
    v_item_error := null;
    v_size_match_count := 0;
    v_size_key := null;
    v_has_size_inventory := false;
    v_next_total_big := null;

    if p_target_product_uuid is not null then
      select p.*
        into v_prod
        from public.products p
       where p.id = p_target_product_uuid
       for update;
    else
      select p.*
        into v_prod
        from public.products p
       where p.id = v_item.product_uuid
          or p.id::text = v_item.product_id
          or p.slug = v_item.product_id
          or ('ak-' || p.slug) = v_item.product_id
       order by case
         when p.id = v_item.product_uuid then 1
         when p.id::text = v_item.product_id then 2
         when p.slug = v_item.product_id then 3
         else 4
       end
       limit 1
       for update;
    end if;

    if not found then
      v_item_error := 'Still unable to match a product record in public.products.';
    elsif v_item.quantity is null or v_item.quantity <= 0 then
      v_item_error := pg_catalog.format(
        'Order item has invalid quantity (%); refusing stock restoration.',
        coalesce(v_item.quantity::text, 'NULL')
      );
    elsif v_prod.stock_count is null or v_prod.stock_count < 0 then
      v_item_error := pg_catalog.format(
        'Product "%" has an invalid total stock_count (%); refusing stock restoration.',
        v_prod.name, coalesce(v_prod.stock_count::text, 'NULL')
      );
    else
      v_next_total_big := v_prod.stock_count::bigint + v_item.quantity::bigint;
      if v_next_total_big > 2147483647 then
        v_item_error := pg_catalog.format(
          'Restoring %s unit(s) to "%" would overflow integer stock_count (% + % > 2147483647).',
          v_item.quantity, v_prod.name, v_prod.stock_count, v_item.quantity
        );
      end if;
    end if;

    if v_item_error is null then
      v_next_size_stock := coalesce(v_prod.size_stock, '{}'::jsonb);

      if pg_catalog.jsonb_typeof(v_next_size_stock) <> 'object' then
        v_item_error := pg_catalog.format(
          'Product "%" has invalid non-object size_stock; refusing partial total-only restoration.',
          v_prod.name
        );
      else
        select exists (
          select 1 from pg_catalog.jsonb_object_keys(v_next_size_stock)
        )
          into v_has_size_inventory;

        if v_has_size_inventory then
          select pg_catalog.count(*)::integer, pg_catalog.min(k)
            into v_size_match_count, v_size_key
            from pg_catalog.jsonb_object_keys(v_next_size_stock) as k
           where pg_catalog.lower(trim(k)) = pg_catalog.lower(trim(v_item.selected_size));

          if v_size_match_count > 1 then
            v_item_error := pg_catalog.format(
              'Ambiguous size_stock keys matched "%" for "%"; refusing partial or ambiguous restoration.',
              v_item.selected_size, v_prod.name
            );
          elsif v_size_match_count = 0 or v_size_key is null then
            v_item_error := pg_catalog.format(
              'Original size key "%" was not found in size_stock for "%"; refusing partial total-only restoration.',
              v_item.selected_size, v_prod.name
            );
          else
            v_size_val_type := pg_catalog.jsonb_typeof(v_next_size_stock -> v_size_key);
            v_size_val_text := v_next_size_stock ->> v_size_key;

            if v_size_val_type not in ('number', 'string')
               or v_size_val_text is null
               or v_size_val_text !~ '^\d+$'
               or pg_catalog.length(v_size_val_text) > 10 then
              v_item_error := pg_catalog.format(
                'Invalid or non-numeric size_stock value (%) for "%" in size "%"; refusing partial total-only restoration.',
                coalesce(v_size_val_text, 'null'), v_prod.name, v_size_key
              );
            else
              v_curr_size_big := v_size_val_text::bigint;
              if v_curr_size_big < 0 or v_curr_size_big > 2147483647 then
                v_item_error := pg_catalog.format(
                  'Out-of-range size_stock value (%) for "%" in size "%"; refusing partial total-only restoration.',
                  v_size_val_text, v_prod.name, v_size_key
                );
              else
                v_next_size_big := v_curr_size_big + v_item.quantity::bigint;
                if v_next_size_big > 2147483647 then
                  v_item_error := pg_catalog.format(
                    'Restoring %s unit(s) to "%" in size "%" would overflow integer size_stock (% + % > 2147483647).',
                    v_item.quantity, v_prod.name, v_size_key, v_curr_size_big, v_item.quantity
                  );
                else
                  v_next_size_stock := pg_catalog.jsonb_set(
                    v_next_size_stock,
                    array[v_size_key],
                    pg_catalog.to_jsonb(v_next_size_big::integer),
                    true
                  );
                end if;
              end if;
            end if;
          end if;
        elsif p_target_product_uuid is not null
              and coalesce(pg_catalog.array_length(v_prod.sizes, 1), 0) > 0 then
          if not exists (
            select 1
              from pg_catalog.unnest(v_prod.sizes) as sz
             where pg_catalog.lower(trim(sz)) = pg_catalog.lower(trim(v_item.selected_size))
          ) then
            v_item_error := pg_catalog.format(
              'Replacement product "%" does not support original size "%".',
              v_prod.name, v_item.selected_size
            );
          end if;
        end if;
      end if;
    end if;

    if v_item_error is null then
      update public.products
         set stock_count = v_next_total_big::integer,
             size_stock = v_next_size_stock,
             updated_at = pg_catalog.now()
       where id = v_prod.id
         and stock_count is not null
         and stock_count >= 0;

      get diagnostics v_updated_rows = row_count;

      if v_updated_rows <> 1 then
        v_item_error := pg_catalog.format(
          'Total stock_count update could not be performed for "%"; item was not marked restored.',
          v_prod.name
        );
      end if;
    end if;

    if v_item_error is null then
      update public.order_items
         set product_uuid = v_prod.id,
             stock_restored = true,
             stock_restoration_status = 'restored',
             stock_restoration_error = null
       where id = v_item.id;

      v_restored_items := v_restored_items + 1;
      v_restored_units := v_restored_units + v_item.quantity;
    else
      update public.order_items
         set stock_restored = false,
             stock_restoration_status = 'failed',
             stock_restoration_error = v_item_error
       where id = v_item.id;

      v_failed_items := v_failed_items + 1;
      v_failed_item_details := v_failed_item_details || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'order_item_id', v_item.id,
          'product_id', v_item.product_id,
          'product_name', v_item.product_name,
          'selected_size', v_item.selected_size,
          'quantity', v_item.quantity,
          'error', v_item_error
        )
      );
    end if;
  end loop;

  if p_order_item_id is not null and v_retried_items = 0 then
    raise exception 'Order item % is not eligible for retry (not found on order, not failed, or already restored).', p_order_item_id;
  end if;

  select
    pg_catalog.count(*) filter (where coalesce(oi.stock_deducted, false) = true),
    pg_catalog.count(*) filter (where coalesce(oi.stock_deducted, false) = true and coalesce(oi.stock_restored, false) = true),
    pg_catalog.count(*) filter (where coalesce(oi.stock_deducted, false) = true and coalesce(oi.stock_restored, false) = false)
    into v_deducted_count, v_restored_count, v_unrestored_count
    from public.order_items oi
   where oi.order_id = v_order.id;

  if v_deducted_count > 0 and v_unrestored_count = 0 then
    v_order_stock_restored := true;
    v_order_restoration_status := 'restored';
  elsif v_restored_count > 0 and v_unrestored_count > 0 then
    v_order_stock_restored := false;
    v_order_restoration_status := 'partial';
    v_warning := pg_catalog.format(
      '%s deducted item(s) still remain unrestored (check order_items.stock_restoration_error).',
      v_unrestored_count
    );
  else
    v_order_stock_restored := false;
    v_order_restoration_status := 'failed';
    v_warning := 'Deducted stock could not be restored (check order_items.stock_restoration_error).';
  end if;

  update public.orders
     set stock_restored = v_order_stock_restored,
         stock_restoration_status = v_order_restoration_status,
         updated_at = pg_catalog.now()
   where id = v_order.id
  returning * into v_updated_order;

  return pg_catalog.jsonb_build_object(
    'order', pg_catalog.to_jsonb(v_updated_order),
    'retried_items', v_retried_items,
    'restored_items', v_restored_items,
    'restored_units', v_restored_units,
    'remaining_failed_items', v_unrestored_count,
    'failed_item_details', v_failed_item_details,
    'stock_restored', v_order_stock_restored,
    'stock_restoration_status', v_order_restoration_status,
    'warning', v_warning
  );
end;
$$;

revoke all on function public.retry_failed_stock_restoration(uuid, uuid, uuid) from public, anon;
grant execute on function public.retry_failed_stock_restoration(uuid, uuid, uuid) to authenticated;

-- Refresh PostgREST schema cache so the new RPCs and columns are immediately callable
notify pgrst, 'reload schema';
