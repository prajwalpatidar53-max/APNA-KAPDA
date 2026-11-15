import type { User as SupabaseUser } from '@supabase/supabase-js';
import { PREVIEW_PRODUCTS } from '../data/catalog';
import { isSupabaseConfigured, supabase, SUPABASE_URL } from '../lib/supabase';
import {
  normalizeProductImages,
  resolveProductImageUrl,
} from '../utils/imageUrl';
import type {
  Order,
  OrderStatus,
  PaymentStatus,
  Product,
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
