export type CategoryFilter = 'All' | 'Men' | 'Women' | 'Unisex';
export type ProductCategory = 'Men' | 'Women' | 'Unisex';
export type GarmentType =
  | 'T-Shirts'
  | 'Shirts'
  | 'Tops'
  | 'Bottomwear'
  | 'Denim'
  | 'Dresses';

export type AppView =
  | 'storefront'
  | 'product'
  | 'checkout'
  | 'account';

export type AuthMode = 'login' | 'signup' | 'recovery';

export type PaymentMethod = 'cod' | 'online_pending';
export type PaymentStatus =
  | 'cod_due'
  | 'awaiting_payment'
  | 'paid'
  | 'refund_pending'
  | 'failed'
  | 'refunded'
  | 'cancelled';
export type RefundStatus =
  | 'none'
  | 'not_required'
  | 'pending'
  | 'processed'
  | 'failed';
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: ProductCategory;
  garment_type: GarmentType | string;
  price_inr: number;
  compare_at_price_inr?: number | null;
  tag: string;
  fabric_care: string;
  sizes: string[];
  colors?: string[];
  stock_count: number;
  size_stock?: Record<string, number>;
  image_url: string;
  gallery_images?: string[];
  is_active: boolean;
  created_at?: string;
}

export interface CartItem {
  productId: string;
  size: string;
  qty: number;
}

export interface ShippingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: 'customer' | 'admin';
  default_address: ShippingAddress;
  created_at?: string;
}

export interface OrderItem {
  id?: string;
  order_id?: string;
  product_uuid?: string | null;
  product_id: string;
  product_name: string;
  product_image?: string | null;
  selected_size: string;
  unit_price_inr: number;
  quantity: number;
  created_at?: string;
}

export interface Order {
  id: string;
  order_number: string;
  user_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  shipping_address: ShippingAddress;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  order_status: OrderStatus;
  subtotal_inr: number;
  shipping_inr: number;
  total_inr: number;
  notes?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: 'customer' | 'admin' | null;
  cancelled_by_user_id?: string | null;
  cancellation_reason?: string | null;
  stock_restored?: boolean;
  refund_status?: RefundStatus;
  created_at: string;
  order_items?: OrderItem[];
}
