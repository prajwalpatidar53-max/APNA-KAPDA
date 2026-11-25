import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  Lock,
  ShieldCheck,
  Tag,
  Truck,
  X,
} from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  FREE_SHIPPING_THRESHOLD_INR,
  STANDARD_SHIPPING_FEE_INR,
  formatINR,
  isDemoProductId,
} from '../data/catalog';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  createOrder,
  previewCheckoutDiscount,
  updateUserProfile,
} from '../services/storeService';
import { getAvailableStockForSize, getConfiguredSizes } from '../utils/inventory';
import type {
  CartItem,
  DiscountPreviewResult,
  Order,
  PaymentMethod,
  Product,
  ShippingAddress,
  UserProfile,
} from '../types';
import { ResilientImage } from './ResilientImage';
import { STORE_EASE } from './StoreMotion';

interface CheckoutViewProps {
  user: SupabaseUser | null;
  profile: UserProfile | null;
  cart: CartItem[];
  products: Product[];
  appliedCouponCode?: string | null;
  onCouponCodeChange?: (code: string | null) => void;
  onBack: () => void;
  onRequireAuth: () => void;
  onOrderCreated: (order: Order) => void;
  onViewOrders: () => void;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ak-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeIndianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return null;
}

const INPUT_CLASS =
  'w-full px-4 py-3 rounded-xl border border-[#dfd6c7] bg-[#faf7f2]/60 focus:bg-[#fffdf9] text-xs outline-none focus:border-[#8d5b3c] text-[#1f1d1a] placeholder:text-[#9c9487] transition-colors';

export function CheckoutView({
  user,
  profile,
  cart,
  products,
  appliedCouponCode: externalCouponCode,
  onCouponCodeChange,
  onBack,
  onRequireAuth,
  onOrderCreated,
  onViewOrders,
}: CheckoutViewProps) {
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [customerEmail, setCustomerEmail] = useState(
    user?.email || profile?.email || ''
  );
  const [phone, setPhone] = useState(profile?.phone || '');
  const [address, setAddress] = useState<ShippingAddress>({
    line1: profile?.default_address?.line1 || '',
    line2: profile?.default_address?.line2 || '',
    city: profile?.default_address?.city || '',
    state: profile?.default_address?.state || '',
    pincode: profile?.default_address?.pincode || '',
  });
  const [notes, setNotes] = useState('');
  const [saveAddressToProfile, setSaveAddressToProfile] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);

  const [localCouponCode, setLocalCouponCode] = useState<string | null>(
    externalCouponCode ?? null
  );
  const activeCouponCode =
    onCouponCodeChange !== undefined ? (externalCouponCode ?? null) : localCouponCode;

  const setActiveCouponCode = (next: string | null) => {
    setLocalCouponCode(next);
    onCouponCodeChange?.(next);
  };

  const [couponInput, setCouponInput] = useState(activeCouponCode || '');
  const [couponApplying, setCouponApplying] = useState(false);
  const [couponError, setCouponError] = useState('');
  const [discountPreview, setDiscountPreview] =
    useState<DiscountPreviewResult | null>(null);

  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  useEffect(() => {
    if (user?.email) {
      setCustomerEmail((prev) => prev || user.email || '');
    }
  }, [user?.email]);

  useEffect(() => {
    if (profile) {
      setFullName((prev) => prev || profile.full_name);
      setCustomerEmail((prev) => prev || profile.email || '');
      setPhone((prev) => prev || profile.phone);
      setAddress((prev) => ({
        line1: prev.line1 || profile.default_address?.line1 || '',
        line2: prev.line2 || profile.default_address?.line2 || '',
        city: prev.city || profile.default_address?.city || '',
        state: prev.state || profile.default_address?.state || '',
        pincode: prev.pincode || profile.default_address?.pincode || '',
      }));
    }
  }, [profile]);

  const itemsWithProduct = cart
    .map((item) => ({
      ...item,
      product: products.find((p) => p.id === item.productId),
    }))
    .filter((entry): entry is CartItem & { product: Product } => Boolean(entry.product));

  const cartSignature = useMemo(
    () =>
      cart
        .map((c) => `${c.productId}:${c.size}:${c.qty}`)
        .sort()
        .join('|'),
    [cart]
  );

  const rawSubtotal = itemsWithProduct.reduce(
    (sum, item) => sum + item.product.price_inr * item.qty,
    0
  );

  useEffect(() => {
    if (placedOrder || itemsWithProduct.length === 0) {
      setDiscountPreview(null);
      return;
    }

    let cancelled = false;
    void previewCheckoutDiscount({
      items: itemsWithProduct.map((x) => ({
        product_id: x.product.id,
        quantity: x.qty,
        unit_price_inr: x.product.price_inr,
      })),
      couponCode: activeCouponCode,
    }).then((res) => {
      if (cancelled) return;
      if (activeCouponCode && !res.valid) {
        setCouponError(res.message || `Coupon "${activeCouponCode}" is no longer valid.`);
        setActiveCouponCode(null);
        return;
      }
      setDiscountPreview(res);
    });

    return () => {
      cancelled = true;
    };
  }, [cartSignature, activeCouponCode, user?.id, placedOrder]);

  const subtotal = discountPreview?.subtotal_inr ?? rawSubtotal;
  const discountInr =
    discountPreview && discountPreview.valid ? discountPreview.discount_inr : 0;
  const discountedSubtotal = Math.max(0, subtotal - discountInr);
  const shippingFee =
    discountPreview && discountPreview.valid
      ? discountPreview.shipping_inr
      : subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD_INR
        ? 0
        : STANDARD_SHIPPING_FEE_INR;
  const total =
    discountPreview && discountPreview.valid
      ? discountPreview.total_inr
      : discountedSubtotal + shippingFee;

  useEffect(() => {
    idempotencyKeyRef.current = generateIdempotencyKey();
  }, [cartSignature, paymentMethod, activeCouponCode, discountInr]);

  const handleApplyCoupon = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      setCouponError('Enter a coupon code to apply.');
      return;
    }
    if (itemsWithProduct.length === 0) {
      setCouponError('Add items to your bag before applying a coupon.');
      return;
    }

    setCouponApplying(true);
    setCouponError('');

    const preview = await previewCheckoutDiscount({
      items: itemsWithProduct.map((x) => ({
        product_id: x.product.id,
        quantity: x.qty,
        unit_price_inr: x.product.price_inr,
      })),
      couponCode: code,
    });

    setCouponApplying(false);

    if (!preview.valid || preview.discount_inr <= 0) {
      setCouponError(preview.message || `Coupon "${code}" cannot be applied.`);
      return;
    }

    setCouponInput(preview.applied_coupon_code || code);
    setActiveCouponCode(preview.applied_coupon_code || code);
    setDiscountPreview(preview);
  };

  const handleRemoveCoupon = () => {
    setCouponError('');
    setCouponInput('');
    setActiveCouponCode(null);
  };

  if (placedOrder) {
    const confirmedItems = placedOrder.order_items ?? [];
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-[5%] py-12 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: STORE_EASE }}
          className="rounded-[28px] bg-[#fffdf9] border border-[#e8e1d5] p-6 sm:p-10 shadow-[0_20px_50px_-28px_rgba(31,29,26,0.2)]"
        >
          <div className="flex items-center gap-3 text-[#2b6345]">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.1, ease: STORE_EASE }}
              className="w-10 h-10 rounded-full bg-[#ecfdf5] border border-[#a7f3d0] flex items-center justify-center"
            >
              <CheckCircle2 className="w-5 h-5" />
            </motion.div>
            <span className="text-[11px] tracking-[0.22em] uppercase font-bold">
              Order Confirmed
            </span>
          </div>

          <h1 className="font-serif-display text-3xl sm:text-4xl text-[#1f1d1a] mt-4">
            Thank you, {placedOrder.customer_name}.
          </h1>
          <p className="text-xs sm:text-sm text-[#5d564c] mt-2 leading-relaxed">
            Your order{' '}
            <strong className="text-[#1f1d1a] tabular-nums">
              {placedOrder.order_number}
            </strong>{' '}
            has been saved permanently to your APNA KAPDA account.
          </p>

          <div className="mt-6 p-5 rounded-2xl bg-[#f8f4ed] border border-[#eae2d5] text-xs space-y-2.5">
            <div className="flex justify-between gap-3">
              <span className="text-[#7c756b]">Order Number</span>
              <span className="font-bold text-[#1f1d1a] tabular-nums">
                {placedOrder.order_number}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#7c756b]">Order Status</span>
              <span className="font-semibold text-[#1f1d1a] uppercase tracking-wider">
                {placedOrder.order_status}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#7c756b]">Payment Method</span>
              <span className="font-semibold text-[#1f1d1a]">
                {placedOrder.payment_method === 'cod'
                  ? 'Cash on Delivery (COD)'
                  : 'Online Payment Reservation'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#7c756b]">Payment Status</span>
              <span className="font-semibold text-[#8d5b3c] uppercase tracking-wider">
                {placedOrder.payment_status === 'cod_due'
                  ? 'Pay on Delivery'
                  : 'Awaiting Payment'}
              </span>
            </div>
            <div className="pt-2.5 border-t border-[#e5ddd0] flex flex-col sm:flex-row sm:justify-between gap-1">
              <span className="text-[#7c756b]">Deliver To</span>
              <span className="text-[#1f1d1a] sm:text-right">
                {placedOrder.shipping_address.line1}
                {placedOrder.shipping_address.line2
                  ? `, ${placedOrder.shipping_address.line2}`
                  : ''}
                , {placedOrder.shipping_address.city},{' '}
                {placedOrder.shipping_address.state} &ndash;{' '}
                <span className="tabular-nums">
                  {placedOrder.shipping_address.pincode}
                </span>
              </span>
            </div>
            <div className="flex justify-between gap-3 text-[#5d564c]">
              <span>Contact</span>
              <span className="text-[#1f1d1a] tabular-nums text-right">
                {placedOrder.customer_email} &middot; {placedOrder.customer_phone}
              </span>
            </div>
          </div>

          {confirmedItems.length > 0 && (
            <div className="mt-5 rounded-2xl border border-[#e8e1d5] overflow-hidden divide-y divide-[#ece5d9] text-xs">
              {confirmedItems.map((item, idx) => (
                <div
                  key={item.id ?? `${item.product_id}-${idx}`}
                  className="p-3.5 flex items-center justify-between gap-3 bg-[#fffdf9]"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[#1f1d1a] truncate">
                      {item.product_name}
                    </p>
                    <p className="text-[11px] text-[#7c756b] tabular-nums mt-0.5">
                      Size {item.selected_size} &times; {item.quantity}
                    </p>
                  </div>
                  <span className="font-semibold text-[#1f1d1a] tabular-nums">
                    {formatINR(item.unit_price_inr * item.quantity)}
                  </span>
                </div>
              ))}
              <div className="p-4 bg-[#f8f4ed] space-y-1.5 tabular-nums">
                <div className="flex justify-between text-[#5d564c]">
                  <span>Subtotal</span>
                  <span>{formatINR(placedOrder.subtotal_inr)}</span>
                </div>
                {(placedOrder.discount_inr ?? 0) > 0 && (
                  <div className="flex justify-between text-[#2b6345]">
                    <span>
                      Discount (
                      {placedOrder.applied_coupon_code
                        ? `Coupon ${placedOrder.applied_coupon_code}`
                        : placedOrder.applied_offer_title || 'Offer'}
                      )
                    </span>
                    <span>&minus;{formatINR(placedOrder.discount_inr ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between text-[#5d564c]">
                  <span>Shipping</span>
                  <span>
                    {placedOrder.shipping_inr === 0
                      ? 'Complimentary'
                      : formatINR(placedOrder.shipping_inr)}
                  </span>
                </div>
                <div className="flex justify-between font-bold text-sm text-[#1f1d1a] pt-2 border-t border-[#e5ddd0]">
                  <span>Total Amount</span>
                  <span>{formatINR(placedOrder.total_inr)}</span>
                </div>
              </div>
            </div>
          )}

          {placedOrder.payment_method === 'online_pending' && (
            <p className="text-xs text-[#69645b] mt-4 leading-relaxed">
              Your order is recorded with <strong>Awaiting Payment</strong> status. No
              online payment was collected or simulated because an online payment
              gateway is not currently connected.
            </p>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onViewOrders}
              className="rounded-full bg-[#1f1d1a] text-white px-7 py-3.5 text-[11px] font-semibold tracking-[0.16em] uppercase hover:bg-[#8d5b3c] transition-colors cursor-pointer"
            >
              View My Orders
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-[#1f1d1a] text-[#1f1d1a] px-7 py-3.5 text-[11px] font-semibold tracking-[0.16em] uppercase hover:bg-[#1f1d1a] hover:text-white transition-colors cursor-pointer"
            >
              Continue Shopping
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || submitting) return;
    setErrorMsg('');

    if (!user) {
      onRequireAuth();
      return;
    }

    if (!isSupabaseConfigured) {
      setErrorMsg(
        'Supabase is not configured yet. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to place orders.'
      );
      return;
    }

    if (itemsWithProduct.length === 0 || itemsWithProduct.length !== cart.length) {
      setErrorMsg(
        itemsWithProduct.length === 0
          ? 'Your shopping bag is empty.'
          : 'Some items in your bag are no longer available. Please review your bag and try again.'
      );
      return;
    }

    const trimmedName = fullName.trim();
    if (trimmedName.length < 2) {
      setErrorMsg('Please enter your full name for delivery.');
      return;
    }

    const trimmedEmail = (customerEmail || user.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setErrorMsg('Please enter a valid email address for order confirmation.');
      return;
    }

    const cleanPhone = normalizeIndianPhone(phone);
    if (!cleanPhone) {
      setErrorMsg('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    const cleanAddress: ShippingAddress = {
      line1: address.line1.trim(),
      line2: address.line2?.trim() || '',
      city: address.city.trim(),
      state: address.state.trim(),
      pincode: address.pincode.trim(),
    };

    if (!cleanAddress.line1 || !cleanAddress.city || !cleanAddress.state) {
      setErrorMsg('Please complete your street address, city, and state.');
      return;
    }

    if (!/^\d{6}$/.test(cleanAddress.pincode)) {
      setErrorMsg('Please enter a valid 6-digit Indian PIN code.');
      return;
    }

    for (const entry of itemsWithProduct) {
      if (isDemoProductId(entry.product.id)) {
        setErrorMsg(
          `"${entry.product.name}" is not a live store product. Please remove it and add products from the live catalog.`
        );
        return;
      }

      const configuredSizes = getConfiguredSizes(entry.product);
      const selectedSize = entry.size.trim();

      if (configuredSizes.length === 0) {
        setErrorMsg(
          `"${entry.product.name}" does not have valid sizes configured and cannot be ordered right now.`
        );
        return;
      }

      if (
        !selectedSize ||
        !configuredSizes.some(
          (s) => s.toLowerCase() === selectedSize.toLowerCase()
        )
      ) {
        setErrorMsg(
          `Selected size "${entry.size || 'None'}" is invalid for "${entry.product.name}".`
        );
        return;
      }

      const available = getAvailableStockForSize(entry.product, selectedSize);
      if (available < entry.qty) {
        setErrorMsg(
          available <= 0
            ? `"${entry.product.name}" (Size ${selectedSize}) is currently out of stock.`
            : `Only ${available} unit(s) available for "${entry.product.name}" in size ${selectedSize}.`
        );
        return;
      }
    }

    isSubmittingRef.current = true;
    setSubmitting(true);

    try {
      if (saveAddressToProfile) {
        const profileRes = await updateUserProfile(user.id, {
          full_name: trimmedName,
          phone: cleanPhone,
          default_address: cleanAddress,
        });
        if (profileRes.error) {
          console.warn(
            '[APNA KAPDA Checkout Profile Save Warning]',
            profileRes.error
          );
        }
      }

      const result = await createOrder({
        userId: user.id,
        customerName: trimmedName,
        customerEmail: trimmedEmail,
        customerPhone: cleanPhone,
        shippingAddress: cleanAddress,
        paymentMethod,
        subtotalInr: subtotal,
        shippingInr: shippingFee,
        totalInr: total,
        couponCode: activeCouponCode,
        discountInr: discountInr,
        notes: notes.trim(),
        idempotencyKey: idempotencyKeyRef.current,
        items: itemsWithProduct.map((entry) => ({
          product_id: entry.product.id,
          product_name: entry.product.name,
          product_image: entry.product.image_url,
          selected_size: entry.size.trim(),
          unit_price_inr: entry.product.price_inr,
          quantity: entry.qty,
        })),
      });

      if (result.error || !result.order) {
        setErrorMsg(result.error || 'Could not place order.');
        return;
      }

      idempotencyKeyRef.current = generateIdempotencyKey();
      setPlacedOrder(result.order);
      onOrderCreated(result.order);
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-[5%] lg:px-[6%] py-8 lg:py-12">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-full border border-[#dfd6c7] bg-[#fffdf9] px-4 py-2 text-[11px] font-medium tracking-[0.12em] uppercase text-[#1f1d1a] hover:border-[#1f1d1a] transition-colors mb-7 cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Storefront</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* Left: Shipping & Payment Method */}
        <div className="lg:col-span-7 rounded-[28px] bg-[#fffdf9] border border-[#e8e1d5] p-6 sm:p-8 shadow-[0_14px_40px_-26px_rgba(31,29,26,0.14)]">
          <p className="text-[10px] tracking-[0.26em] uppercase text-[#8d5b3c] font-bold">
            Secure Checkout
          </p>
          <h1 className="font-serif-display text-3xl text-[#1f1d1a] mt-2 mb-6">
            Delivery &amp; Order Confirmation
          </h1>

          {!user ? (
            <div className="p-6 rounded-2xl bg-[#f8f4ed] border border-[#e5ddd0]">
              <div className="flex items-center gap-2 text-[#1f1d1a] font-semibold text-sm">
                <Lock className="w-4 h-4 text-[#8d5b3c]" />
                <span>Sign in required to place an order</span>
              </div>
              <p className="text-xs text-[#69645b] mt-2 leading-relaxed">
                For order tracking and verified account protection via Supabase Row-Level
                Security, please sign in or create an account before completing checkout.
              </p>
              <button
                type="button"
                onClick={onRequireAuth}
                className="mt-5 rounded-full bg-[#1f1d1a] text-white px-6 py-3 text-[11px] font-semibold tracking-[0.16em] uppercase hover:bg-[#8d5b3c] transition-colors cursor-pointer"
              >
                Sign In / Create Account
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Aarav Sharma"
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                    Mobile Number (+91) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9876543210"
                    className={`${INPUT_CLASS} tabular-nums`}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                  Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                  Street Address / House No. *
                </label>
                <input
                  type="text"
                  required
                  value={address.line1}
                  onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                  placeholder="42, Johari Bazaar Road"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                  Apartment / Landmark (Optional)
                </label>
                <input
                  type="text"
                  value={address.line2 || ''}
                  onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                  placeholder="Near Hawa Mahal Gate"
                  className={INPUT_CLASS}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    placeholder="Jaipur"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                    State *
                  </label>
                  <input
                    type="text"
                    required
                    value={address.state}
                    onChange={(e) => setAddress({ ...address, state: e.target.value })}
                    placeholder="Rajasthan"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                    PIN Code *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={address.pincode}
                    onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                    placeholder="302003"
                    className={`${INPUT_CLASS} tabular-nums`}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-xs text-[#5d564c] cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAddressToProfile}
                  onChange={(e) => setSaveAddressToProfile(e.target.checked)}
                  className="accent-[#8d5b3c] w-4 h-4 rounded"
                />
                <span>Save this delivery address to my customer profile</span>
              </label>

              {/* Honest Payment Method Options */}
              <div className="pt-5 border-t border-[#ece5d9]">
                <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-[#1f1d1a] mb-3">
                  Order &amp; Payment Method
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cod')}
                    className={`p-4 rounded-2xl text-left border transition-all cursor-pointer ${
                      paymentMethod === 'cod'
                        ? 'border-[#1f1d1a] bg-[#f8f4ed] shadow-xs'
                        : 'border-[#e5ddd0] hover:border-[#8d5b3c]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#1f1d1a]">
                        Cash on Delivery (COD)
                      </span>
                      <Truck className="w-4 h-4 text-[#8d5b3c]" />
                    </div>
                    <p className="text-[11px] text-[#7c756b] mt-1.5 leading-relaxed">
                      Pay in cash or UPI directly at your doorstep upon delivery.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('online_pending')}
                    className={`p-4 rounded-2xl text-left border transition-all cursor-pointer ${
                      paymentMethod === 'online_pending'
                        ? 'border-[#1f1d1a] bg-[#f8f4ed] shadow-xs'
                        : 'border-[#e5ddd0] hover:border-[#8d5b3c]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#1f1d1a]">
                        Online Payment (Pending Gateway)
                      </span>
                      <ShieldCheck className="w-4 h-4 text-[#8d5b3c]" />
                    </div>
                    <p className="text-[11px] text-[#7c756b] mt-1.5 leading-relaxed">
                      Saves order as awaiting online payment — no charge is simulated
                      without a live gateway.
                    </p>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#5d564c] font-medium mb-1.5">
                  Delivery Note (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Call on arrival, leave with reception, etc."
                  className={INPUT_CLASS}
                />
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-[#fdf2f0] border border-[#e6c2b8] text-xs text-[#9a3b26]">
                  {errorMsg}
                </div>
              )}

              <motion.button
                type="submit"
                whileTap={{ scale: 0.99 }}
                disabled={submitting || itemsWithProduct.length === 0}
                className="w-full rounded-full bg-[#1f1d1a] text-white py-4 px-6 text-[11px] tracking-[0.18em] uppercase font-semibold hover:bg-[#8d5b3c] transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
              >
                {submitting
                  ? 'Placing Order...'
                  : paymentMethod === 'cod'
                    ? `Place COD Order — ${formatINR(total)}`
                    : `Save Order (Awaiting Online Payment) — ${formatINR(total)}`}
              </motion.button>
            </form>
          )}
        </div>

        {/* Right: Bag Summary */}
        <div className="lg:col-span-5 rounded-[28px] bg-[#fffdf9] border border-[#e8e1d5] p-6 sm:p-8 lg:sticky lg:top-24 shadow-[0_14px_40px_-26px_rgba(31,29,26,0.14)]">
          <h2 className="font-serif-display text-2xl text-[#1f1d1a] pb-4 border-b border-[#ece5d9]">
            Order Summary
          </h2>

          <div className="divide-y divide-[#ece5d9] max-h-[360px] overflow-y-auto my-2">
            {itemsWithProduct.map(({ product, size, qty }) => (
              <div
                key={`${product.id}-${size}`}
                className="py-3.5 flex items-center gap-3.5"
              >
                <div className="w-14 h-[72px] rounded-xl bg-[#eae3d6] overflow-hidden shrink-0 border border-[#e8e1d5]">
                  <ResilientImage
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#1f1d1a] truncate">
                    {product.name}
                  </p>
                  <p className="text-[11px] text-[#7c756b] mt-0.5 tabular-nums">
                    Size {size} &times; {qty}
                  </p>
                </div>
                <span className="text-xs font-bold text-[#1f1d1a] tabular-nums">
                  {formatINR(product.price_inr * qty)}
                </span>
              </div>
            ))}
          </div>

          {/* Coupon Code & Automatic Offer Box */}
          <div className="border-t border-[#ece5d9] pt-4 pb-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.16em] uppercase font-bold text-[#5d564c]">
                <Tag className="w-3.5 h-3.5 text-[#8d5b3c]" />
                <span>Promo / Coupon Code</span>
              </span>
              {activeCouponCode && (
                <button
                  type="button"
                  onClick={handleRemoveCoupon}
                  className="text-[10px] tracking-[0.12em] uppercase text-[#9a3b26] hover:underline cursor-pointer"
                >
                  Remove
                </button>
              )}
            </div>

            {activeCouponCode ? (
              <div className="p-3 rounded-xl bg-[#ecfdf5] border border-[#a7f3d0] text-[#2b6345] flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-[11px]">
                  {activeCouponCode}
                  {discountPreview?.applied_offer_title
                    ? ` · ${discountPreview.applied_offer_title}`
                    : ''}
                </span>
                <button
                  type="button"
                  onClick={handleRemoveCoupon}
                  aria-label="Remove coupon code"
                  className="text-[#2b6345] hover:text-[#1f1d1a] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={couponInput}
                  onChange={(e) => {
                    setCouponInput(e.target.value.toUpperCase());
                    if (couponError) setCouponError('');
                  }}
                  placeholder="Enter code (e.g. WELCOME10)"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#dfd6c7] bg-[#faf7f2]/60 text-xs font-mono uppercase outline-none focus:border-[#8d5b3c]"
                />
                <button
                  type="button"
                  disabled={couponApplying || itemsWithProduct.length === 0}
                  onClick={handleApplyCoupon}
                  className="px-4 py-2.5 rounded-xl border border-[#1f1d1a] text-[10px] tracking-[0.14em] uppercase font-semibold text-[#1f1d1a] hover:bg-[#1f1d1a] hover:text-white transition-colors cursor-pointer disabled:opacity-45"
                >
                  {couponApplying ? 'Checking...' : 'Apply'}
                </button>
              </div>
            )}

            {couponError && (
              <p className="text-[11px] text-[#9a3b26] leading-relaxed">
                {couponError}
              </p>
            )}

            {!activeCouponCode &&
              discountPreview?.valid &&
              discountPreview.discount_inr > 0 &&
              discountPreview.applied_offer_title && (
                <p className="text-[11px] text-[#2b6345] bg-[#ecfdf5] border border-[#a7f3d0] rounded-xl px-3 py-2">
                  Automatic offer applied:{' '}
                  <strong>{discountPreview.applied_offer_title}</strong> (&minus;
                  {formatINR(discountPreview.discount_inr)})
                </p>
              )}

            {discountInr > 0 && (
              <p className="text-[10px] text-[#7c756b]">
                Single best offer policy: offers &amp; coupon codes cannot be stacked.
              </p>
            )}
          </div>

          <div className="border-t border-[#ece5d9] pt-4 space-y-2.5 text-xs tabular-nums">
            <div className="flex justify-between text-[#5d564c]">
              <span>Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            {discountInr > 0 && (
              <div className="flex justify-between text-[#2b6345] font-medium">
                <span>
                  Discount
                  {discountPreview?.applied_coupon_code
                    ? ` (${discountPreview.applied_coupon_code})`
                    : discountPreview?.applied_offer_title
                      ? ` (${discountPreview.applied_offer_title})`
                      : ''}
                </span>
                <span>&minus;{formatINR(discountInr)}</span>
              </div>
            )}
            <div className="flex justify-between text-[#5d564c]">
              <span>Shipping</span>
              <span>
                {shippingFee === 0 ? 'Complimentary' : formatINR(shippingFee)}
              </span>
            </div>
            <div className="flex justify-between text-base font-bold text-[#1f1d1a] pt-3 border-t border-[#ece5d9]">
              <span>Total</span>
              <span>{formatINR(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
