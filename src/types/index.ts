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
  is_demo?: boolean;
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

export type OrderStockRestorationStatus =
  | 'not_applicable'
  | 'pending'
  | 'restored'
  | 'partial'
  | 'failed';

export type OrderItemStockRestorationStatus =
  | 'not_applicable'
  | 'deducted'
  | 'restored'
  | 'failed';

export type OrderItemStockTrackingMode =
  | 'legacy'
  | 'total_only'
  | 'size_stock'
  | 'none';

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
  stock_deducted?: boolean;
  stock_restored?: boolean;
  stock_restoration_status?: OrderItemStockRestorationStatus;
  stock_restoration_error?: string | null;
  stock_tracking_mode?: OrderItemStockTrackingMode;
  created_at?: string;
}

export type OfferDiscountMode = 'automatic' | 'coupon';
export type OfferDiscountType = 'percentage' | 'fixed';
export type OfferAppliesTo = 'all' | 'products' | 'categories';
export type StorefrontBannerDestinationType = 'shop' | 'category' | 'product' | 'url';

export interface Offer {
  id: string;
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
  usage_count: number;
  allow_stacking: boolean;
  is_active: boolean;
  starts_at: string | null;
  expires_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StorefrontBanner {
  id: string;
  banner_text: string;
  offer_title: string;
  cta_text: string;
  destination_type: StorefrontBannerDestinationType;
  destination_value: string;
  is_active: boolean;
  starts_at: string | null;
  expires_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DiscountPreviewResult {
  valid: boolean;
  message: string | null;
  applied_offer_id: string | null;
  applied_coupon_code: string | null;
  applied_offer_title: string | null;
  discount_mode: OfferDiscountMode | null;
  discount_inr: number;
  subtotal_inr: number;
  shipping_inr: number;
  total_inr: number;
  stacking_policy: 'no_stacking';
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
  discount_inr?: number;
  applied_offer_id?: string | null;
  applied_coupon_code?: string | null;
  applied_offer_title?: string | null;
  total_inr: number;
  notes?: string | null;
  cancelled_at?: string | null;
  cancelled_by?: 'customer' | 'admin' | null;
  cancelled_by_user_id?: string | null;
  cancellation_reason?: string | null;
  stock_deducted?: boolean;
  stock_restored?: boolean;
  stock_restoration_status?: OrderStockRestorationStatus;
  refund_status?: RefundStatus;
  created_at: string;
  order_items?: OrderItem[];
}

