-- ============================================================================
-- APNA KAPDA — Isolated Bulk Shipping Test Orders Migration & Seed (20 Orders)
-- Safe & non-destructive:
--   • Preserves all existing orders, customers, and product inventory.
--   • Never deducts public.products.stock_count or size_stock for test orders.
--   • Strictly isolates is_test_order = true from real customers & analytics.
--   • Uses ONLY existing products, sizes & prices from public.products.
--   • Does NOT fake paid online confirmations (uses cod/cod_due & online_pending/awaiting_payment).
-- Run manually in: Supabase Dashboard -> SQL Editor -> New Query.
-- ============================================================================

-- 1. ADD RELIABLE DATABASE FLAG FOR TEST ORDERS (NON-DESTRUCTIVE)
alter table public.orders
  add column if not exists is_test_order boolean not null default false;

create index if not exists orders_is_test_order_idx
  on public.orders (is_test_order, created_at desc);

create unique index if not exists orders_test_idempotency_key_idx
  on public.orders (idempotency_key)
  where is_test_order = true and idempotency_key is not null;

-- 2. HARDEN CUSTOMER RLS POLICIES TO EXCLUDE TEST ORDERS ALWAYS
drop policy if exists "Customers can view own orders" on public.orders;
create policy "Customers can view own orders"
  on public.orders for select
  using (
    (auth.uid() = user_id and coalesce(is_test_order, false) = false)
    or public.is_admin()
  );

drop policy if exists "Users can view own order items" on public.order_items;
create policy "Users can view own order items"
  on public.order_items for select
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

-- 3. UPDATE STOCK TRIGGER SO TEST ORDERS VALIDATE REAL PRODUCTS WITHOUT DEDUCTING STOCK
create or replace function public.decrement_stock_on_order_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_parent_order public.orders%rowtype;
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
  select o.*
    into v_parent_order
    from public.orders o
   where o.id = new.order_id;

  if not found then
    raise exception 'Parent order (%) was not found for order item.', new.order_id;
  end if;

  if coalesce(v_parent_order.is_test_order, false) then
    if pg_catalog.current_user in ('authenticated', 'anon') and not public.is_admin() then
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
    if coalesce(v_parent_order.is_test_order, false) then
      select p.*
        into v_prod
        from public.products p
       where p.id = v_lookup_uuid;
    else
      select p.*
        into v_prod
        from public.products p
       where p.id = v_lookup_uuid
       for update;
    end if;

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
    if coalesce(v_parent_order.is_test_order, false) then
      select p.*
        into v_prod
        from public.products p
       where p.slug = v_clean_pid
       limit 1;
    else
      select p.*
        into v_prod
        from public.products p
       where p.slug = v_clean_pid
       limit 1
       for update;
    end if;
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

  -- Enforce canonical product identity & metadata from public.products
  new.product_uuid := v_prod.id;
  new.product_id := v_prod.id::text;
  new.product_name := v_prod.name;
  new.product_image := nullif(trim(coalesce(v_prod.image_url, '')), '');
  new.selected_size := v_matched_size;

  -- TEST ORDER BRANCH: Never deduct real product inventory stock
  if coalesce(v_parent_order.is_test_order, false) then
    new.stock_deducted := false;
    new.stock_restored := false;
    new.stock_restoration_status := 'not_applicable';
    new.stock_restoration_error := null;
    new.stock_tracking_mode := 'none';
    return new;
  end if;

  -- REAL CUSTOMER ORDER BRANCH: strict active + stock + size-stock validation & deduction
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

  if v_prod.stock_count is null or v_prod.stock_count < 0 then
    raise exception 'Product "%" has an invalid total stock_count (%). Checkout rejected.',
      v_prod.name, coalesce(v_prod.stock_count::text, 'NULL');
  end if;

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

-- 4. ADMIN-ONLY IDEMPOTENT 20-TEST-ORDER GENERATOR RPC (USES REAL PRODUCTS, NO STOCK DEDUCTION)
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
  if pg_catalog.current_user in ('authenticated', 'anon') and not public.is_admin() then
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
    v_qty1 := pg_catalog.greatest(1, (v_spec ->> 'qty1')::integer);

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

-- 5. SAFE ADMIN CLEANUP RPC FOR TEST ORDERS ONLY (NEVER TOUCHES REAL ORDERS OR STOCK)
create or replace function public.delete_bulk_shipping_test_orders()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_deleted_count integer := 0;
begin
  if pg_catalog.current_user in ('authenticated', 'anon') and not public.is_admin() then
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

-- 6. SEED EXACTLY 20 TEST ORDERS & OUTPUT THEIR ORDER IDS + ORDER NUMBERS
select public.create_bulk_shipping_test_orders() as test_orders_result;

notify pgrst, 'reload schema';
