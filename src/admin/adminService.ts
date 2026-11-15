import type { User as SupabaseUser } from '@supabase/supabase-js';
import { PREVIEW_PRODUCTS } from '../data/catalog';
import { isSupabaseConfigured, supabase, SUPABASE_URL } from '../lib/supabase';
import {
  normalizeProductImages,
  resolveProductImageUrl,
} from '../utils/imageUrl';
import type {
  Offer,
  OfferAppliesTo,
  OfferDiscountMode,
  OfferDiscountType,
  Order,
  OrderStatus,
  PaymentStatus,
  Product,
  StorefrontBanner,
  StorefrontBannerDestinationType,
  UserProfile,
} from '../types';

export type AdminSessionState =
  | { status: 'loading' }
  | { status: 'unconfigured' }
  | { status: 'unauthenticated'; error?: string }
  | { status: 'forbidden'; user: SupabaseUser; profile?: UserProfile | null; reason?: string }
  | { status: 'authorized'; user: SupabaseUser; profile: UserProfile };

const PRODUCT_IMAGES_BUCKET = 'product-images';

function logAdminError(
  operation: string,
  resource: string,
  error: { code?: string; message: string; details?: string | null; hint?: string | null }
) {
  console.error('[APNA KAPDA Admin Service Error]', {
    operation,
    endpoint: `${SUPABASE_URL}/rest/v1/${resource}`,
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

function mapProfileRow(row: Record<string, unknown>): UserProfile {
  const addr = (row.default_address as Record<string, string> | null) ?? {};
  return {
    id: String(row.id ?? ''),
    full_name: String(row.full_name ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    role: row.role === 'admin' ? 'admin' : 'customer',
    default_address: {
      line1: addr.line1 ?? '',
      line2: addr.line2 ?? '',
      city: addr.city ?? '',
      state: addr.state ?? '',
      pincode: addr.pincode ?? '',
    },
    created_at: row.created_at ? String(row.created_at) : undefined,
  };
}

export async function verifyAdminSession(): Promise<AdminSessionState> {
  if (!supabase || !isSupabaseConfigured) {
    return { status: 'unconfigured' };
  }

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) {
    return { status: 'unauthenticated', error: sessionErr.message };
  }

  const user = sessionData.session?.user;
  if (!user) {
    return { status: 'unauthenticated' };
  }

  const { data: profileRow, error: profileErr } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, default_address, created_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    logAdminError('verifyAdminSession', 'profiles', profileErr);
    return {
      status: 'forbidden',
      user,
      reason: `Unable to verify administrator role (${profileErr.message}).`,
    };
  }

  if (!profileRow || profileRow.role !== 'admin') {
    return {
      status: 'forbidden',
      user,
      profile: profileRow ? mapProfileRow(profileRow) : null,
      reason: 'This account does not hold administrator privileges.',
    };
  }

  return {
    status: 'authorized',
    user,
    profile: mapProfileRow(profileRow),
  };
}

export async function signInAdmin(
  email: string,
  password: string
): Promise<AdminSessionState> {
  if (!supabase || !isSupabaseConfigured) {
    return { status: 'unconfigured' };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return {
      status: 'unauthenticated',
      error: error?.message || 'Invalid credentials.',
    };
  }

  return verifyAdminSession();
}

export async function sendAdminPasswordReset(
  email: string
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/admin`,
  });

  if (error) {
    return { error: error.message };
  }
  return {};
}

export async function updateAdminPassword(
  newPassword: string
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { error: error.message };
  }
  return {};
}

export async function signOutAdmin(): Promise<void> {
  if (supabase) {
    await supabase.auth.signOut();
  }
}

export async function uploadProductImages(
  files: File[]
): Promise<{ urls: string[]; error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { urls: [], error: 'Supabase is not configured.' };
  }

  const uploadedUrls: string[] = [];
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

  for (const file of files) {
    if (!allowedTypes.includes(file.type)) {
      return {
        urls: uploadedUrls,
        error: `Unsupported image format "${file.name}". Use JPG, PNG, WebP, or AVIF.`,
      };
    }
    if (file.size > 5 * 1024 * 1024) {
      return {
        urls: uploadedUrls,
        error: `File "${file.name}" exceeds the 5 MB limit.`,
      };
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
    const objectPath = `products/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(objectPath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      const hint = uploadError.message.toLowerCase().includes('bucket')
        ? ' Run supabase/admin_migration.sql in Supabase SQL Editor to create the "product-images" bucket and admin Storage policies.'
        : '';
      return {
        urls: uploadedUrls,
        error: `${uploadError.message}.${hint}`,
      };
    }

    const { data: publicData } = supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .getPublicUrl(objectPath);

    if (publicData?.publicUrl) {
      uploadedUrls.push(publicData.publicUrl);
    }
  }

  return { urls: uploadedUrls };
}

export async function fetchAdminProducts(): Promise<{
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
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return {
        products: [],
        error:
          'Table "public.products" was not found in Supabase. Run supabase/schema.sql in Supabase SQL Editor, then click Refresh.',
      };
    }
    logAdminError('fetchAdminProducts', 'products', error);
    return { products: [], error: error.message };
  }

  const normalized = ((data ?? []) as Product[]).map((item) =>
    normalizeProductImages({
      ...item,
      is_demo: false,
      colors: Array.isArray(item.colors) ? item.colors : [],
      gallery_images:
        Array.isArray(item.gallery_images) && item.gallery_images.length > 0
          ? item.gallery_images
          : item.image_url
            ? [item.image_url]
            : [],
    })
  );

  return { products: normalized };
}

export interface SaveAdminProductInput {
  id?: string;
  slug?: string;
  name: string;
  description: string;
  category: 'Men' | 'Women' | 'Unisex';
  garment_type: string;
  price_inr: number;
  compare_at_price_inr?: number | null;
  tag: string;
  fabric_care: string;
  sizes: string[];
  colors: string[];
  stock_count: number;
  gallery_images: string[];
  is_active: boolean;
}

export async function saveAdminProduct(
  input: SaveAdminProductInput
): Promise<{ product?: Product; warning?: string; error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const cleanGallery = input.gallery_images
    .map((url) => url.trim())
    .filter(Boolean);
  const coverImage = cleanGallery[0] ?? '';

  if (!coverImage) {
    return { error: 'At least one product image is required.' };
  }

  const seenSizes = new Set<string>();
  const cleanSizes: string[] = [];
  for (const raw of input.sizes) {
    const clean = raw.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seenSizes.has(key)) continue;
    seenSizes.add(key);
    cleanSizes.push(clean);
  }
  if (cleanSizes.length === 0) {
    return { error: 'At least one garment size is required.' };
  }

  const basePayload = {
    name: input.name.trim(),
    slug:
      input.slug?.trim() ||
      `${slugify(input.name)}-${Date.now().toString(36).slice(-4)}`,
    description: input.description.trim(),
    category: input.category,
    garment_type: input.garment_type.trim(),
    price_inr: Math.round(Number(input.price_inr)),
    compare_at_price_inr:
      input.compare_at_price_inr && Number(input.compare_at_price_inr) > 0
        ? Math.round(Number(input.compare_at_price_inr))
        : null,
    tag: input.tag.trim().toUpperCase() || 'NEW DROP',
    fabric_care: input.fabric_care.trim(),
    sizes: cleanSizes,
    stock_count: Math.max(0, Math.round(Number(input.stock_count))),
    image_url: coverImage,
    is_active: input.is_active,
    updated_at: new Date().toISOString(),
  };

  const extendedPayload = {
    ...basePayload,
    colors: input.colors.map((c) => c.trim()).filter(Boolean),
    gallery_images: cleanGallery,
  };

  const executeMutation = async (payload: Record<string, unknown>) => {
    if (input.id && !input.id.startsWith('ak-')) {
      return supabase!
        .from('products')
        .update(payload)
        .eq('id', input.id)
        .select()
        .single();
    }
    return supabase!.from('products').insert(payload).select().single();
  };

  const { data, error } = await executeMutation(extendedPayload);

  if (error) {
    const isMissingColumnError =
      error.code === 'PGRST204' ||
      error.message.includes('colors') ||
      error.message.includes('gallery_images');

    if (isMissingColumnError) {
      const fallback = await executeMutation(basePayload);
      if (fallback.error) {
        logAdminError('saveAdminProduct.fallback', 'products', fallback.error);
        return { error: fallback.error.message };
      }
      return {
        product: fallback.data as Product,
        warning:
          'Product core fields saved, but "colors" and "gallery_images" columns are missing in Supabase. Run supabase/admin_migration.sql to enable multi-image & colour persistence.',
      };
    }

    logAdminError('saveAdminProduct', 'products', error);
    return { error: error.message };
  }

  return { product: data as Product };
}

export async function toggleProductActiveAdmin(
  productId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const { error } = await supabase
    .from('products')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', productId);

  if (error) {
    logAdminError('toggleProductActiveAdmin', 'products', error);
    return { error: error.message };
  }
  return {};
}

export async function deleteAdminProduct(
  productId: string
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) {
    logAdminError('deleteAdminProduct', 'products', error);
    return { error: error.message };
  }
  return {};
}

export async function seedStarterCatalogAdmin(): Promise<{
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
    logAdminError('seedStarterCatalogAdmin', 'products', error);
    return { error: error.message };
  }

  return { count: data?.length ?? rows.length };
}

export async function fetchAdminOrders(): Promise<{
  orders: Order[];
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { orders: [], error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return {
        orders: [],
        error:
          'Table "public.orders" was not found in Supabase. Run supabase/schema.sql in Supabase SQL Editor, then click Refresh.',
      };
    }
    logAdminError('fetchAdminOrders', 'orders', error);
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

export async function updateAdminOrder(
  orderId: string,
  updates: { order_status?: OrderStatus; payment_status?: PaymentStatus }
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const derivedRefundStatus =
    updates.payment_status === 'refunded'
      ? 'processed'
      : updates.payment_status === 'refund_pending'
        ? 'pending'
        : updates.payment_status === 'cancelled'
          ? 'not_required'
          : undefined;

  const basePayload = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const extendedPayload =
    derivedRefundStatus !== undefined
      ? { ...basePayload, refund_status: derivedRefundStatus }
      : basePayload;

  const { error } = await supabase
    .from('orders')
    .update(extendedPayload)
    .eq('id', orderId);

  if (error) {
    if (
      derivedRefundStatus !== undefined &&
      (error.code === 'PGRST204' || error.message.includes('refund_status'))
    ) {
      const fallback = await supabase
        .from('orders')
        .update(basePayload)
        .eq('id', orderId);
      if (!fallback.error) return {};
    }
    logAdminError('updateAdminOrder', 'orders', error);
    return { error: error.message };
  }
  return {};
}

export async function cancelOrderAdmin(
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
    p_actor: 'admin',
  });

  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      return {
        error:
          'Order cancellation RPC is not installed yet. Run supabase/order_cancellation_migration.sql in Supabase SQL Editor.',
      };
    }
    logAdminError('cancelOrderAdmin', 'rpc/cancel_order', error);
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

export async function fetchAdminCustomers(): Promise<{
  customers: UserProfile[];
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { customers: [], error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, role, default_address, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    logAdminError('fetchAdminCustomers', 'profiles', error);
    return { customers: [], error: error.message };
  }

  return {
    customers: ((data ?? []) as Record<string, unknown>[]).map(mapProfileRow),
  };
}

export interface BulkMarkShippedResult {
  updatedIds: string[];
  skippedCancelledCount: number;
  skippedDeliveredCount: number;
  skippedAlreadyShippedCount: number;
  error?: string;
}

const BULK_SHIPPABLE_STATUSES: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
];

export async function bulkMarkOrdersShippedAdmin(
  orderIds: string[]
): Promise<BulkMarkShippedResult> {
  const uniqueIds = Array.from(
    new Set(orderIds.map((id) => id.trim()).filter(Boolean))
  );

  if (uniqueIds.length === 0) {
    return {
      updatedIds: [],
      skippedCancelledCount: 0,
      skippedDeliveredCount: 0,
      skippedAlreadyShippedCount: 0,
      error: 'Select at least one order to mark as shipped.',
    };
  }

  if (!supabase || !isSupabaseConfigured) {
    return {
      updatedIds: [],
      skippedCancelledCount: 0,
      skippedDeliveredCount: 0,
      skippedAlreadyShippedCount: 0,
      error: 'Supabase is not configured.',
    };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return {
      updatedIds: [],
      skippedCancelledCount: 0,
      skippedDeliveredCount: 0,
      skippedAlreadyShippedCount: 0,
      error:
        session.status === 'forbidden'
          ? session.reason || 'Administrator privileges are required.'
          : 'Administrator authentication required.',
    };
  }

  const { data: currentRows, error: fetchError } = await supabase
    .from('orders')
    .select('id, order_status')
    .in('id', uniqueIds);

  if (fetchError) {
    logAdminError('bulkMarkOrdersShippedAdmin.fetch', 'orders', fetchError);
    return {
      updatedIds: [],
      skippedCancelledCount: 0,
      skippedDeliveredCount: 0,
      skippedAlreadyShippedCount: 0,
      error: fetchError.message,
    };
  }

  const rows = (currentRows ?? []) as { id: string; order_status: OrderStatus }[];
  const eligibleIds: string[] = [];
  let skippedCancelledCount = 0;
  let skippedDeliveredCount = 0;
  let skippedAlreadyShippedCount = 0;

  for (const row of rows) {
    if (BULK_SHIPPABLE_STATUSES.includes(row.order_status)) {
      eligibleIds.push(row.id);
    } else if (row.order_status === 'cancelled') {
      skippedCancelledCount += 1;
    } else if (row.order_status === 'delivered') {
      skippedDeliveredCount += 1;
    } else if (row.order_status === 'shipped') {
      skippedAlreadyShippedCount += 1;
    }
  }

  if (eligibleIds.length === 0) {
    return {
      updatedIds: [],
      skippedCancelledCount,
      skippedDeliveredCount,
      skippedAlreadyShippedCount,
    };
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from('orders')
    .update({
      order_status: 'shipped',
      updated_at: new Date().toISOString(),
    })
    .in('id', eligibleIds)
    .in('order_status', [...BULK_SHIPPABLE_STATUSES])
    .select('id');

  if (updateError) {
    logAdminError('bulkMarkOrdersShippedAdmin.update', 'orders', updateError);
    return {
      updatedIds: [],
      skippedCancelledCount,
      skippedDeliveredCount,
      skippedAlreadyShippedCount,
      error: updateError.message,
    };
  }

  return {
    updatedIds: ((updatedRows ?? []) as { id: string }[]).map((r) => r.id),
    skippedCancelledCount,
    skippedDeliveredCount,
    skippedAlreadyShippedCount,
  };
}

export async function updateAdminOrderDelivery(
  orderId: string,
  updates: {
    customer_name: string;
    customer_phone: string;
    shipping_address: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      pincode: string;
    };
  }
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return { error: 'Administrator privileges are required.' };
  }

  const cleanName = updates.customer_name.trim();
  const cleanPhone = updates.customer_phone.trim();
  const cleanLine1 = updates.shipping_address.line1.trim();
  const cleanLine2 = (updates.shipping_address.line2 ?? '').trim();
  const cleanCity = updates.shipping_address.city.trim();
  const cleanState = updates.shipping_address.state.trim();
  const cleanPincode = updates.shipping_address.pincode.trim();

  if (cleanName.length < 2) return { error: 'Customer name is required.' };
  if (cleanPhone.replace(/\D/g, '').length < 10) {
    return { error: 'Valid 10-digit customer phone is required.' };
  }
  if (!cleanLine1 || !cleanCity || !cleanState || !/^\d{6}$/.test(cleanPincode)) {
    return {
      error:
        'Complete address (Line 1, City, State, and 6-digit PIN code) is required.',
    };
  }

  const { error } = await supabase
    .from('orders')
    .update({
      customer_name: cleanName,
      customer_phone: cleanPhone,
      shipping_address: {
        line1: cleanLine1,
        ...(cleanLine2 ? { line2: cleanLine2 } : {}),
        city: cleanCity,
        state: cleanState,
        pincode: cleanPincode,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (error) {
    logAdminError('updateAdminOrderDelivery', 'orders', error);
    return { error: error.message };
  }
  return {};
}

// ============================================================================
// OFFERS & COUPONS ADMIN CRUD
// ============================================================================
export interface SaveAdminOfferInput {
  id?: string;
  title: string;
  description: string;
  discount_mode: OfferDiscountMode;
  coupon_code: string | null;
  discount_type: OfferDiscountType;
  discount_value: number;
  min_cart_value_inr: number;
  max_discount_inr: number | null;
  applies_to: OfferAppliesTo;
  product_ids: string[];
  categories: string[];
  total_usage_limit: number | null;
  per_customer_usage_limit: number | null;
  allow_stacking?: boolean;
  is_active: boolean;
  starts_at: string | null;
  expires_at: string | null;
}

function mapOfferRow(row: Record<string, unknown>): Offer {
  return {
    id: String(row.id ?? ''),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    discount_mode: row.discount_mode === 'automatic' ? 'automatic' : 'coupon',
    coupon_code: row.coupon_code ? String(row.coupon_code) : null,
    discount_type: row.discount_type === 'fixed' ? 'fixed' : 'percentage',
    discount_value: Number(row.discount_value ?? 0),
    min_cart_value_inr: Number(row.min_cart_value_inr ?? 0),
    max_discount_inr:
      row.max_discount_inr !== null && row.max_discount_inr !== undefined
        ? Number(row.max_discount_inr)
        : null,
    applies_to:
      row.applies_to === 'products' || row.applies_to === 'categories'
        ? row.applies_to
        : 'all',
    product_ids: Array.isArray(row.product_ids) ? row.product_ids.map(String) : [],
    categories: Array.isArray(row.categories) ? row.categories.map(String) : [],
    total_usage_limit:
      row.total_usage_limit !== null && row.total_usage_limit !== undefined
        ? Number(row.total_usage_limit)
        : null,
    per_customer_usage_limit:
      row.per_customer_usage_limit !== null && row.per_customer_usage_limit !== undefined
        ? Number(row.per_customer_usage_limit)
        : null,
    usage_count: Number(row.usage_count ?? 0),
    allow_stacking: Boolean(row.allow_stacking),
    is_active: Boolean(row.is_active),
    starts_at: row.starts_at ? String(row.starts_at) : null,
    expires_at: row.expires_at ? String(row.expires_at) : null,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function fetchAdminOffers(): Promise<{
  offers: Offer[];
  migrationMissing?: boolean;
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { offers: [], error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase
    .from('offers')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return {
        offers: [],
        migrationMissing: true,
        error:
          'Offers tables are not installed in Supabase yet. Run supabase/offers_migration.sql in Supabase SQL Editor.',
      };
    }
    logAdminError('fetchAdminOffers', 'offers', error);
    return { offers: [], error: error.message };
  }

  return {
    offers: ((data ?? []) as Record<string, unknown>[]).map(mapOfferRow),
  };
}

export async function saveAdminOffer(
  input: SaveAdminOfferInput
): Promise<{ offer?: Offer; error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return { error: 'Administrator privileges are required.' };
  }

  const title = input.title.trim();
  if (!title) return { error: 'Offer title is required.' };

  const discountValue = Math.round(Number(input.discount_value));
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return { error: 'Discount value must be greater than 0.' };
  }
  if (input.discount_type === 'percentage' && discountValue > 100) {
    return { error: 'Percentage discount cannot exceed 100%.' };
  }

  const minCart = Math.max(0, Math.round(Number(input.min_cart_value_inr || 0)));
  const maxDiscount =
    input.max_discount_inr !== null && Number.isFinite(Number(input.max_discount_inr))
      ? Math.max(0, Math.round(Number(input.max_discount_inr)))
      : null;

  let normalizedCode: string | null = null;
  if (input.discount_mode === 'coupon') {
    normalizedCode = (input.coupon_code ?? '').trim().toUpperCase();
    if (!normalizedCode) {
      return { error: 'Coupon code is required when discount mode is "Coupon Code".' };
    }
    if (!/^[A-Z0-9_-]{3,32}$/.test(normalizedCode)) {
      return {
        error:
          'Coupon code must be 3–32 characters using only letters, numbers, hyphens, or underscores.',
      };
    }
  }

  const startsAtIso = input.starts_at ? new Date(input.starts_at).toISOString() : null;
  const expiresAtIso = input.expires_at ? new Date(input.expires_at).toISOString() : null;
  if (startsAtIso && expiresAtIso && new Date(expiresAtIso) <= new Date(startsAtIso)) {
    return { error: 'Expiry date/time must be after the start date/time.' };
  }

  if (input.applies_to === 'products' && input.product_ids.length === 0) {
    return { error: 'Select at least one target product when Applies To is Specific Products.' };
  }
  if (input.applies_to === 'categories' && input.categories.length === 0) {
    return { error: 'Select at least one category when Applies To is Specific Categories.' };
  }

  const totalLimit =
    input.total_usage_limit !== null && Number.isFinite(Number(input.total_usage_limit))
      ? Math.round(Number(input.total_usage_limit))
      : null;
  if (totalLimit !== null && totalLimit <= 0) {
    return { error: 'Total usage limit must be at least 1 or left blank for unlimited.' };
  }

  const perCustomerLimit =
    input.per_customer_usage_limit !== null &&
    Number.isFinite(Number(input.per_customer_usage_limit))
      ? Math.round(Number(input.per_customer_usage_limit))
      : null;
  if (perCustomerLimit !== null && perCustomerLimit <= 0) {
    return { error: 'Per-customer usage limit must be at least 1 or left blank for unlimited.' };
  }

  const payload = {
    title,
    description: input.description.trim(),
    discount_mode: input.discount_mode,
    coupon_code: normalizedCode,
    discount_type: input.discount_type,
    discount_value: discountValue,
    min_cart_value_inr: minCart,
    max_discount_inr: maxDiscount,
    applies_to: input.applies_to,
    product_ids: input.applies_to === 'products' ? input.product_ids : [],
    categories: input.applies_to === 'categories' ? input.categories : [],
    total_usage_limit: totalLimit,
    per_customer_usage_limit: perCustomerLimit,
    allow_stacking: false,
    is_active: Boolean(input.is_active),
    starts_at: startsAtIso,
    expires_at: expiresAtIso,
    updated_at: new Date().toISOString(),
  };

  const query = input.id
    ? supabase.from('offers').update(payload).eq('id', input.id).select().single()
    : supabase.from('offers').insert(payload).select().single();

  const { data, error } = await query;
  if (error) {
    if (error.code === '23505') {
      return { error: `Coupon code "${normalizedCode}" is already in use by another offer.` };
    }
    logAdminError('saveAdminOffer', 'offers', error);
    return { error: error.message };
  }

  return { offer: mapOfferRow(data as Record<string, unknown>) };
}

export async function toggleOfferActiveAdmin(
  offerId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return { error: 'Administrator privileges are required.' };
  }

  const { error } = await supabase
    .from('offers')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', offerId);

  if (error) {
    logAdminError('toggleOfferActiveAdmin', 'offers', error);
    return { error: error.message };
  }
  return {};
}

export async function deleteAdminOffer(
  offerId: string
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return { error: 'Administrator privileges are required.' };
  }

  const { error } = await supabase.from('offers').delete().eq('id', offerId);
  if (error) {
    logAdminError('deleteAdminOffer', 'offers', error);
    return { error: error.message };
  }
  return {};
}

// ============================================================================
// STOREFRONT PROMOTIONAL BANNERS ADMIN CRUD
// ============================================================================
export interface SaveAdminBannerInput {
  id?: string;
  offer_title: string;
  banner_text: string;
  cta_text: string;
  destination_type: StorefrontBannerDestinationType;
  destination_value: string;
  is_active: boolean;
  starts_at: string | null;
  expires_at: string | null;
}

function mapBannerRow(row: Record<string, unknown>): StorefrontBanner {
  const destType = String(row.destination_type ?? 'shop');
  const validDest: StorefrontBannerDestinationType =
    destType === 'category' || destType === 'product' || destType === 'url'
      ? destType
      : 'shop';

  return {
    id: String(row.id ?? ''),
    offer_title: String(row.offer_title ?? ''),
    banner_text: String(row.banner_text ?? ''),
    cta_text: String(row.cta_text ?? 'Shop Now'),
    destination_type: validDest,
    destination_value: String(row.destination_value ?? ''),
    is_active: Boolean(row.is_active),
    starts_at: row.starts_at ? String(row.starts_at) : null,
    expires_at: row.expires_at ? String(row.expires_at) : null,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function fetchAdminBanners(): Promise<{
  banners: StorefrontBanner[];
  migrationMissing?: boolean;
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { banners: [], error: 'Supabase is not configured.' };
  }

  const { data, error } = await supabase
    .from('storefront_banners')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return {
        banners: [],
        migrationMissing: true,
        error:
          'Storefront banners table is not installed in Supabase yet. Run supabase/offers_migration.sql in Supabase SQL Editor.',
      };
    }
    logAdminError('fetchAdminBanners', 'storefront_banners', error);
    return { banners: [], error: error.message };
  }

  return {
    banners: ((data ?? []) as Record<string, unknown>[]).map(mapBannerRow),
  };
}

export async function saveAdminBanner(
  input: SaveAdminBannerInput
): Promise<{ banner?: StorefrontBanner; error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return { error: 'Administrator privileges are required.' };
  }

  const bannerText = input.banner_text.trim();
  if (!bannerText) {
    return { error: 'Banner message text is required.' };
  }

  const startsAtIso = input.starts_at ? new Date(input.starts_at).toISOString() : null;
  const expiresAtIso = input.expires_at ? new Date(input.expires_at).toISOString() : null;
  if (startsAtIso && expiresAtIso && new Date(expiresAtIso) <= new Date(startsAtIso)) {
    return { error: 'Banner expiry date/time must be after start date/time.' };
  }

  const payload = {
    offer_title: input.offer_title.trim(),
    banner_text: bannerText,
    cta_text: input.cta_text.trim() || 'Shop Now',
    destination_type: input.destination_type,
    destination_value: input.destination_value.trim(),
    is_active: Boolean(input.is_active),
    starts_at: startsAtIso,
    expires_at: expiresAtIso,
    updated_at: new Date().toISOString(),
  };

  const query = input.id
    ? supabase
        .from('storefront_banners')
        .update(payload)
        .eq('id', input.id)
        .select()
        .single()
    : supabase.from('storefront_banners').insert(payload).select().single();

  const { data, error } = await query;
  if (error) {
    logAdminError('saveAdminBanner', 'storefront_banners', error);
    return { error: error.message };
  }

  return { banner: mapBannerRow(data as Record<string, unknown>) };
}

export async function toggleBannerActiveAdmin(
  bannerId: string,
  isActive: boolean
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return { error: 'Administrator privileges are required.' };
  }

  const { error } = await supabase
    .from('storefront_banners')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', bannerId);

  if (error) {
    logAdminError('toggleBannerActiveAdmin', 'storefront_banners', error);
    return { error: error.message };
  }
  return {};
}

export async function deleteAdminBanner(
  bannerId: string
): Promise<{ error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return { error: 'Supabase is not configured.' };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return { error: 'Administrator privileges are required.' };
  }

  const { error } = await supabase
    .from('storefront_banners')
    .delete()
    .eq('id', bannerId);

  if (error) {
    logAdminError('deleteAdminBanner', 'storefront_banners', error);
    return { error: error.message };
  }
  return {};
}

// ============================================================================
// BULK SHIPPING QA TEST ORDERS (ISOLATED & NON-DEDUCTING)
// ============================================================================
export interface BulkTestOrderSummary {
  id: string;
  order_number: string;
  customer_name: string;
  city: string;
  state: string;
  pincode: string;
  order_status: OrderStatus;
  payment_method: 'cod' | 'online_pending';
  payment_status: PaymentStatus;
  total_inr: number;
  status: 'created' | 'existing';
}

export interface BulkTestOrdersResult {
  created_count: number;
  existing_count: number;
  total_count: number;
  orders: BulkTestOrderSummary[];
  migrationMissing?: boolean;
  error?: string;
}

export async function createShippingTestOrdersAdmin(): Promise<BulkTestOrdersResult> {
  if (!supabase || !isSupabaseConfigured) {
    return {
      created_count: 0,
      existing_count: 0,
      total_count: 0,
      orders: [],
      error: 'Supabase is not configured.',
    };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return {
      created_count: 0,
      existing_count: 0,
      total_count: 0,
      orders: [],
      error:
        session.status === 'forbidden'
          ? session.reason || 'Administrator privileges are required.'
          : 'Administrator authentication required.',
    };
  }

  const { data, error } = await supabase.rpc('create_bulk_shipping_test_orders');
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      return {
        created_count: 0,
        existing_count: 0,
        total_count: 0,
        orders: [],
        migrationMissing: true,
        error:
          'Test order generator RPC is not installed yet. Run supabase/test_orders_migration.sql in Supabase SQL Editor.',
      };
    }
    logAdminError(
      'createShippingTestOrdersAdmin',
      'rpc/create_bulk_shipping_test_orders',
      error
    );
    return {
      created_count: 0,
      existing_count: 0,
      total_count: 0,
      orders: [],
      error: error.message,
    };
  }

  const payload = (data ?? {}) as Partial<BulkTestOrdersResult>;
  return {
    created_count: Number(payload.created_count ?? 0),
    existing_count: Number(payload.existing_count ?? 0),
    total_count: Number(payload.total_count ?? 0),
    orders: Array.isArray(payload.orders) ? payload.orders : [],
  };
}

export async function deleteShippingTestOrdersAdmin(): Promise<{
  deleted_count: number;
  migrationMissing?: boolean;
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { deleted_count: 0, error: 'Supabase is not configured.' };
  }

  const session = await verifyAdminSession();
  if (session.status !== 'authorized') {
    return {
      deleted_count: 0,
      error:
        session.status === 'forbidden'
          ? session.reason || 'Administrator privileges are required.'
          : 'Administrator authentication required.',
    };
  }

  const { data, error } = await supabase.rpc('delete_bulk_shipping_test_orders');
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      return {
        deleted_count: 0,
        migrationMissing: true,
        error:
          'Test order cleanup RPC is not installed yet. Run supabase/test_orders_migration.sql in Supabase SQL Editor.',
      };
    }
    logAdminError(
      'deleteShippingTestOrdersAdmin',
      'rpc/delete_bulk_shipping_test_orders',
      error
    );
    return { deleted_count: 0, error: error.message };
  }

  const payload = (data ?? {}) as { deleted_count?: number };
  return {
    deleted_count: Number(payload.deleted_count ?? 0),
  };
}




