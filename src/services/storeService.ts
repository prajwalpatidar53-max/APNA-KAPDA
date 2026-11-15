import { supabase, isSupabaseConfigured, SUPABASE_URL } from '../lib/supabase';
import { isDemoProductId, PREVIEW_PRODUCTS } from '../data/catalog';
import {
  normalizeProductImages,
  resolveProductImageUrl,
} from '../utils/imageUrl';
import type {
  DiscountPreviewResult,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  ShippingAddress,
  StorefrontBanner,
  UserProfile,
} from '../types';

export interface CatalogFetchResult {
  products: Product[];
  source: 'supabase';
  warning?: string;
}

function logDbError(
  operation: string,
  table: string,
  error: { code?: string; message: string; details?: string | null; hint?: string | null }
) {
  console.error('[APNA KAPDA Supabase Query Error]', {
    operation,
    endpoint: `${SUPABASE_URL}/rest/v1/${table}`,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deduplicateSizesCaseInsensitive(sizes: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of sizes) {
    const clean = raw.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export async function fetchActiveProducts(): Promise<CatalogFetchResult> {
  if (!supabase || !isSupabaseConfigured) {
    return {
      products: [],
      source: 'supabase',
      warning:
        'Supabase is not configured. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to load products.',
    };
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    logDbError('fetchActiveProducts', 'products', error);
    return {
      products: [],
      source: 'supabase',
      warning: `Unable to load live products (${error.message}). Ensure supabase/schema.sql has been applied in Supabase.`,
    };
  }

  if (!data || data.length === 0) {
    return {
      products: [],
      source: 'supabase',
      warning: 'No active products are currently published in Supabase.',
    };
  }

  return {
    products: (data as Product[]).map((p) =>
      normalizeProductImages({ ...p, is_demo: false })
    ),
    source: 'supabase',
  };
}

export async function fetchAllProductsAdmin(): Promise<{
  products: Product[];
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { products: [], error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    logDbError('fetchAllProductsAdmin', 'products', error);
    return { products: [], error: error.message };
  }
  return {
    products: ((data as Product[]) ?? []).map(normalizeProductImages),
  };
}

export async function saveProductAdmin(
  productInput: Omit<Product, 'id' | 'slug' | 'created_at'> & {
    id?: string;
    slug?: string;
  }
): Promise<{ product?: Product; error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return {
      error:
        'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.',
    };
  }

  const cleanSizes = deduplicateSizesCaseInsensitive(productInput.sizes);

  if (cleanSizes.length === 0) {
    return { error: 'At least one valid garment size is required.' };
  }

  const payload = {
    name: productInput.name.trim(),
    slug:
      productInput.slug?.trim() ||
      `${slugify(productInput.name)}-${Date.now().toString(36).slice(-4)}`,
    description: productInput.description.trim(),
    category: productInput.category,
    garment_type: productInput.garment_type.trim(),
    price_inr: Number(productInput.price_inr),
    compare_at_price_inr: productInput.compare_at_price_inr
      ? Number(productInput.compare_at_price_inr)
      : null,
    tag: productInput.tag.trim().toUpperCase() || 'NEW',
    fabric_care: productInput.fabric_care.trim(),
    sizes: cleanSizes,
    stock_count: Number(productInput.stock_count),
    image_url: productInput.image_url.trim(),
    is_active: productInput.is_active,
    updated_at: new Date().toISOString(),
  };

  if (productInput.id && !productInput.id.startsWith('ak-')) {
    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', productInput.id)
      .select()
      .single();

    if (error) {
      logDbError('saveProductAdmin.update', 'products', error);
      return { error: error.message };
    }
    return { product: data as Product };
  }

  const { data, error } = await supabase
    .from('products')
    .insert(payload)
    .select()
    .single();

  if (error) {
    logDbError('saveProductAdmin.insert', 'products', error);
    return { error: error.message };
  }
  return { product: data as Product };
}

export async function deleteProductAdmin(id: string): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) {
    logDbError('deleteProductAdmin', 'products', error);
    return { error: error.message };
  }
  return {};
}

export async function seedPreviewProductsToSupabase(): Promise<{
  count?: number;
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const rows = PREVIEW_PRODUCTS.map((p) => ({
    name: p.name,
    slug: p.slug,
    description: p.description,
    category: p.category,
    garment_type: p.garment_type,
    price_inr: p.price_inr,
    compare_at_price_inr: p.compare_at_price_inr ?? null,
    tag: p.tag,
    fabric_care: p.fabric_care,
    sizes: p.sizes,
    stock_count: p.stock_count,
    image_url: p.image_url,
    is_active: true,
  }));

  const { data, error } = await supabase
    .from('products')
    .upsert(rows, { onConflict: 'slug' })
    .select();

  if (error) {
    logDbError('seedPreviewProductsToSupabase', 'products', error);
    return { error: error.message };
  }
  return { count: data?.length ?? rows.length };
}

export async function fetchUserProfile(
  userId: string
): Promise<{ profile?: UserProfile; error?: string }> {
  if (!supabase || !isSupabaseConfigured) return {};

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logDbError('fetchUserProfile', 'profiles', error);
    return { error: error.message };
  }
  if (!data) return {};

  return {
    profile: {
      id: data.id,
      full_name: data.full_name ?? '',
      email: data.email ?? '',
      phone: data.phone ?? '',
      role: data.role === 'admin' ? 'admin' : 'customer',
      default_address: {
        line1: data.default_address?.line1 ?? '',
        line2: data.default_address?.line2 ?? '',
        city: data.default_address?.city ?? '',
        state: data.default_address?.state ?? '',
        pincode: data.default_address?.pincode ?? '',
      },
    },
  };
}

export async function updateUserProfile(
  userId: string,
  updates: { full_name: string; phone: string; default_address: ShippingAddress }
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: updates.full_name.trim(),
      phone: updates.phone.trim(),
      default_address: updates.default_address,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    logDbError('updateUserProfile', 'profiles', error);
    return { error: error.message };
  }
  return {};
}

export async function fetchActiveStorefrontBanner(): Promise<{
  banner: StorefrontBanner | null;
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { banner: null };
  }

  const { data, error } = await supabase
    .from('storefront_banners')
    .select('*')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(10);

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return { banner: null };
    }
    logDbError('fetchActiveStorefrontBanner', 'storefront_banners', error);
    return { banner: null, error: error.message };
  }

  const nowMs = Date.now();
  const activeRow = ((data ?? []) as Record<string, unknown>[]).find((row) => {
    const startOk = !row.starts_at || new Date(String(row.starts_at)).getTime() <= nowMs;
    const endOk = !row.expires_at || new Date(String(row.expires_at)).getTime() >= nowMs;
    return startOk && endOk;
  });

  if (!activeRow) return { banner: null };

  const destType = String(activeRow.destination_type ?? 'shop');
  return {
    banner: {
      id: String(activeRow.id ?? ''),
      offer_title: String(activeRow.offer_title ?? ''),
      banner_text: String(activeRow.banner_text ?? ''),
      cta_text: String(activeRow.cta_text ?? 'Shop Now'),
      destination_type:
        destType === 'category' || destType === 'product' || destType === 'url'
          ? destType
          : 'shop',
      destination_value: String(activeRow.destination_value ?? ''),
      is_active: Boolean(activeRow.is_active),
      starts_at: activeRow.starts_at ? String(activeRow.starts_at) : null,
      expires_at: activeRow.expires_at ? String(activeRow.expires_at) : null,
      created_at: activeRow.created_at ? String(activeRow.created_at) : undefined,
      updated_at: activeRow.updated_at ? String(activeRow.updated_at) : undefined,
    },
  };
}

export async function previewCheckoutDiscount(params: {
  items: { product_id: string; quantity: number; unit_price_inr?: number }[];
  couponCode?: string | null;
}): Promise<DiscountPreviewResult> {
  const localSubtotal = params.items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.unit_price_inr ?? 0)) * item.quantity,
    0
  );
  const localShipping = localSubtotal === 0 || localSubtotal >= 1499 ? 0 : 99;
  const fallbackBase: DiscountPreviewResult = {
    valid: !params.couponCode?.trim(),
    message: null,
    applied_offer_id: null,
    applied_coupon_code: null,
    applied_offer_title: null,
    discount_mode: null,
    discount_inr: 0,
    subtotal_inr: localSubtotal,
    shipping_inr: localShipping,
    total_inr: localSubtotal + localShipping,
    stacking_policy: 'no_stacking',
  };

  if (!supabase || !isSupabaseConfigured || params.items.length === 0) {
    return fallbackBase;
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const rpcItems = params.items.map((item) => ({
    product_uuid: uuidRegex.test(item.product_id) ? item.product_id : null,
    product_id: item.product_id,
    quantity: item.quantity,
  }));

  const normalizedCode = params.couponCode?.trim().toUpperCase() || null;

  const { data, error } = await supabase.rpc('preview_checkout_discount', {
    p_items: rpcItems,
    p_coupon_code: normalizedCode,
  });

  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      return {
        ...fallbackBase,
        valid: !normalizedCode,
        message: normalizedCode
          ? 'Coupon validation requires running supabase/offers_migration.sql in Supabase SQL Editor.'
          : null,
      };
    }
    logDbError('previewCheckoutDiscount', 'rpc/preview_checkout_discount', error);
    return {
      ...fallbackBase,
      valid: false,
      message: error.message || 'Unable to verify discount right now.',
    };
  }

  const res = data as Partial<DiscountPreviewResult> | null;
  if (!res) return fallbackBase;

  return {
    valid: Boolean(res.valid),
    message: res.message ?? null,
    applied_offer_id: res.applied_offer_id ?? null,
    applied_coupon_code: res.applied_coupon_code ?? null,
    applied_offer_title: res.applied_offer_title ?? null,
    discount_mode: res.discount_mode ?? null,
    discount_inr: Number(res.discount_inr ?? 0),
    subtotal_inr: Number(res.subtotal_inr ?? localSubtotal),
    shipping_inr: Number(res.shipping_inr ?? localShipping),
    total_inr: Number(res.total_inr ?? localSubtotal + localShipping),
    stacking_policy: 'no_stacking',
  };
}

export async function createOrder(params: {
  userId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: ShippingAddress;
  paymentMethod: PaymentMethod;
  subtotalInr: number;
  shippingInr: number;
  totalInr: number;
  couponCode?: string | null;
  discountInr?: number;
  notes?: string;
  idempotencyKey?: string;
  items: OrderItem[];
}): Promise<{ order?: Order; error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return {
      error:
        'Supabase is not connected yet. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to place real orders.',
    };
  }

  if (!params.items || params.items.length === 0) {
    return { error: 'Your shopping bag is empty.' };
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  for (const item of params.items) {
    if (isDemoProductId(item.product_id)) {
      return {
        error: `"${item.product_name}" is a demo item and cannot be checked out. Please select live products from the store.`,
      };
    }
    if (!item.selected_size || !item.selected_size.trim()) {
      return {
        error: `Please select a valid size for "${item.product_name}" before placing your order.`,
      };
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return {
        error: `Invalid quantity selected for "${item.product_name}".`,
      };
    }
  }

  const rpcItems = params.items.map((item) => ({
    product_uuid: uuidRegex.test(item.product_id) ? item.product_id : null,
    product_id: item.product_id,
    product_name: item.product_name,
    product_image: item.product_image || null,
    selected_size: item.selected_size.trim(),
    unit_price_inr: item.unit_price_inr,
    quantity: item.quantity,
  }));

  const baseRpcArgs = {
    p_order_number: null,
    p_customer_name: params.customerName.trim(),
    p_customer_email: params.customerEmail.trim(),
    p_customer_phone: params.customerPhone.trim(),
    p_shipping_address: params.shippingAddress,
    p_payment_method: params.paymentMethod,
    p_subtotal_inr: params.subtotalInr,
    p_shipping_inr: params.shippingInr,
    p_total_inr: params.totalInr,
    p_notes: params.notes?.trim() || null,
    p_items: rpcItems,
  };

  const normalizedCoupon = params.couponCode?.trim().toUpperCase() || null;
  const expectedDiscount = Math.max(0, Math.round(Number(params.discountInr ?? 0)));

  let { data: atomicData, error: atomicError } = await supabase.rpc(
    'create_order_atomic',
    {
      ...baseRpcArgs,
      p_idempotency_key: params.idempotencyKey?.trim() || null,
      p_coupon_code: normalizedCoupon,
      p_discount_inr: expectedDiscount,
    }
  );

  // Backward-compatible fallback ONLY when no coupon/discount was requested and DB still runs 12-arg create_order_atomic
  if (
    atomicError?.code === 'PGRST202' &&
    (atomicError.message.includes('p_coupon_code') ||
      atomicError.message.includes('p_discount_inr'))
  ) {
    if (normalizedCoupon || expectedDiscount > 0) {
      return {
        error:
          'Offers & coupon checkout requires running supabase/offers_migration.sql in Supabase SQL Editor.',
      };
    }
    const twelveArgCall = await supabase.rpc('create_order_atomic', {
      ...baseRpcArgs,
      p_idempotency_key: params.idempotencyKey?.trim() || null,
    });
    atomicData = twelveArgCall.data;
    atomicError = twelveArgCall.error;
  }

  // Backward-compatible fallback if Supabase still has the 11-arg create_order_atomic signature
  if (
    atomicError?.code === 'PGRST202' &&
    atomicError.message.includes('p_idempotency_key')
  ) {
    const legacyCall = await supabase.rpc('create_order_atomic', baseRpcArgs);
    atomicData = legacyCall.data;
    atomicError = legacyCall.error;
  }

  if (atomicError) {
    if (atomicError.code === '42883' || atomicError.code === 'PGRST202') {
      return {
        error:
          'Checkout RPC (create_order_atomic) is not installed in Supabase yet. Run supabase/order_cancellation_migration.sql in Supabase SQL Editor.',
      };
    }
    logDbError('createOrder.atomic', 'rpc/create_order_atomic', atomicError);
    return { error: atomicError.message || 'Unable to place order.' };
  }

  const payload = atomicData as {
    order?: Order;
    order_items?: OrderItem[];
  } | null;

  if (!payload?.order) {
    return { error: 'Checkout did not return a valid recorded order from Supabase.' };
  }

  const normalizedItems = (payload.order_items ?? rpcItems).map((item) => ({
    ...item,
    product_image: resolveProductImageUrl(item.product_image) || item.product_image,
  }));

  return {
    order: {
      ...payload.order,
      order_items: normalizedItems,
    },
  };
}

export async function fetchCustomerOrders(
  userId: string
): Promise<{ orders: Order[]; error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { orders: [], error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    logDbError('fetchCustomerOrders', 'orders', error);
    return { orders: [], error: error.message };
  }
  const normalizedOrders = ((data as Order[]) ?? []).map((order) => ({
    ...order,
    order_items: (order.order_items ?? []).map((item) => ({
      ...item,
      product_image: resolveProductImageUrl(item.product_image) || item.product_image,
    })),
  }));
  return { orders: normalizedOrders };
}

export async function cancelCustomerOrder(
  orderId: string,
  reason?: string
): Promise<{
  order?: Order;
  warning?: string;
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase.rpc('cancel_order', {
    p_order_id: orderId,
    p_reason: reason?.trim() || null,
    p_actor: 'customer',
  });

  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      return {
        error:
          'Order cancellation function is not installed in Supabase yet. Run supabase/order_cancellation_migration.sql in Supabase SQL Editor.',
      };
    }
    logDbError('cancelCustomerOrder', 'rpc/cancel_order', error);
    return { error: error.message };
  }

  const payload = data as {
    order?: Order;
    warning?: string | null;
  } | null;
  return {
    order: payload?.order,
    warning: payload?.warning ?? undefined,
  };
}

export async function fetchAllOrdersAdmin(): Promise<{
  orders: Order[];
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) return { orders: [] };

  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false });

  if (error) {
    logDbError('fetchAllOrdersAdmin', 'orders', error);
    return { orders: [], error: error.message };
  }
  return { orders: (data as Order[]) ?? [] };
}

export async function updateOrderStatusAdmin(
  orderId: string,
  updates: { order_status?: OrderStatus; payment_status?: PaymentStatus }
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const { error } = await supabase
    .from('orders')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (error) {
    logDbError('updateOrderStatusAdmin', 'orders', error);
    return { error: error.message };
  }
  return {};
}

export async function subscribeNewsletter(
  email: string
): Promise<{ message: string; isError?: boolean }> {
  if (!supabase || !isSupabaseConfigured) {
    return {
      message: `Supabase is not connected yet. Add your Supabase keys in .env to persist newsletter signup for ${email}.`,
      isError: true,
    };
  }

  const normalizedEmail = email.trim().toLowerCase();

  const { error } = await supabase
    .from('newsletter_subscribers')
    .upsert(
      { email: normalizedEmail },
      { onConflict: 'email', ignoreDuplicates: true }
    );

  if (error) {
    if (error.code === '23505') {
      return { message: 'You are already subscribed to APNA KAPDA updates.' };
    }
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return {
        message:
          'Newsletter table is not provisioned yet. Run supabase/schema.sql in Supabase SQL Editor.',
        isError: true,
      };
    }
    logDbError('subscribeNewsletter', 'newsletter_subscribers', error);
    return { message: error.message, isError: true };
  }

  return { message: 'Welcome to the circle. You will hear from us on new drops.' };
}
