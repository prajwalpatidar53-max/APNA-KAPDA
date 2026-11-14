import { supabase, isSupabaseConfigured, SUPABASE_URL } from '../lib/supabase';
import { PREVIEW_PRODUCTS } from '../data/catalog';
import {
  normalizeProductImages,
  resolveProductImageUrl,
} from '../utils/imageUrl';
import type {
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  ShippingAddress,
  UserProfile,
} from '../types';

export interface CatalogFetchResult {
  products: Product[];
  source: 'supabase' | 'preview';
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

export async function fetchActiveProducts(): Promise<CatalogFetchResult> {
  if (!supabase || !isSupabaseConfigured) {
    return { products: PREVIEW_PRODUCTS, source: 'preview' };
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      console.warn(
        '[APNA KAPDA] public.products table is not provisioned yet; displaying editorial preview catalog. Run supabase/schema.sql in Supabase SQL Editor.'
      );
    } else {
      logDbError('fetchActiveProducts', 'products', error);
    }
    return {
      products: PREVIEW_PRODUCTS,
      source: 'preview',
      warning: `Showing preview catalog (${error.message}). Run supabase/schema.sql in your Supabase SQL Editor.`,
    };
  }

  if (!data || data.length === 0) {
    return {
      products: PREVIEW_PRODUCTS,
      source: 'preview',
      warning:
        'Supabase products table is empty — showing editorial preview catalog until products are added.',
    };
  }

  return {
    products: (data as Product[]).map(normalizeProductImages),
    source: 'supabase',
  };
}

export async function fetchAllProductsAdmin(): Promise<{
  products: Product[];
  error?: string;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { products: PREVIEW_PRODUCTS };
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
    sizes: productInput.sizes.length ? productInput.sizes : ['S', 'M', 'L', 'XL'],
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
  notes?: string;
  items: OrderItem[];
}): Promise<{ order?: Order; error?: string }> {
  if (!supabase || !isSupabaseConfigured) {
    return {
      error:
        'Supabase is not connected yet. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to place real orders.',
    };
  }

  const orderNumber = `AK-${Math.floor(100000 + Math.random() * 900000)}`;
  const paymentStatus: PaymentStatus =
    params.paymentMethod === 'cod' ? 'cod_due' : 'awaiting_payment';

  const { data: orderData, error: orderError } = await supabase
    .from('orders')
    .insert({
      order_number: orderNumber,
      user_id: params.userId,
      customer_name: params.customerName.trim(),
      customer_email: params.customerEmail.trim(),
      customer_phone: params.customerPhone.trim(),
      shipping_address: params.shippingAddress,
      payment_method: params.paymentMethod,
      payment_status: paymentStatus,
      order_status: 'pending',
      subtotal_inr: params.subtotalInr,
      shipping_inr: params.shippingInr,
      total_inr: params.totalInr,
      notes: params.notes?.trim() || null,
    })
    .select()
    .single();

  if (orderError || !orderData) {
    if (orderError) logDbError('createOrder.insertOrder', 'orders', orderError);
    return { error: orderError?.message || 'Unable to create order record.' };
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const lineItems = params.items.map((item) => ({
    order_id: orderData.id,
    product_uuid: uuidRegex.test(item.product_id) ? item.product_id : null,
    product_id: item.product_id,
    product_name: item.product_name,
    product_image: item.product_image || null,
    selected_size: item.selected_size,
    unit_price_inr: item.unit_price_inr,
    quantity: item.quantity,
  }));

  const { error: itemsError } = await supabase.from('order_items').insert(lineItems);

  if (itemsError) {
    logDbError('createOrder.insertItems', 'order_items', itemsError);
    return {
      error: `Order saved (${orderNumber}), but line items failed: ${itemsError.message}`,
    };
  }

  return {
    order: {
      ...(orderData as Order),
      order_items: lineItems,
    },
  };
}

export async function fetchCustomerOrders(
  userId: string
): Promise<{ orders: Order[]; error?: string }> {
  if (!supabase || !isSupabaseConfigured) return { orders: [] };

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
): Promise<{ order?: Order; restoredUnits?: number; error?: string }> {
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

  const payload = data as { order?: Order; restored_units?: number } | null;
  return {
    order: payload?.order,
    restoredUnits: payload?.restored_units ?? 0,
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
