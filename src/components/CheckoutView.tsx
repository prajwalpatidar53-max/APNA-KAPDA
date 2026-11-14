import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Lock, ShieldCheck, Truck } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  FREE_SHIPPING_THRESHOLD_INR,
  STANDARD_SHIPPING_FEE_INR,
  formatINR,
} from '../data/catalog';
import { isSupabaseConfigured } from '../lib/supabase';
import { createOrder, updateUserProfile } from '../services/storeService';
import type {
  CartItem,
  Order,
  PaymentMethod,
  Product,
  ShippingAddress,
  UserProfile,
} from '../types';
import { ResilientImage } from './ResilientImage';

interface CheckoutViewProps {
  user: SupabaseUser | null;
  profile: UserProfile | null;
  cart: CartItem[];
  products: Product[];
  onBack: () => void;
  onRequireAuth: () => void;
  onOrderCreated: (order: Order) => void;
  onViewOrders: () => void;
}

export function CheckoutView({
  user,
  profile,
  cart,
  products,
  onBack,
  onRequireAuth,
  onOrderCreated,
  onViewOrders,
}: CheckoutViewProps) {
  const [fullName, setFullName] = useState(profile?.full_name || '');
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

  useEffect(() => {
    if (profile) {
      setFullName((prev) => prev || profile.full_name);
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

  const subtotal = itemsWithProduct.reduce(
    (sum, item) => sum + item.product.price_inr * item.qty,
    0
  );
  const shippingFee =
    subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD_INR
      ? 0
      : STANDARD_SHIPPING_FEE_INR;
  const total = subtotal + shippingFee;

  if (placedOrder) {
    return (
      <div className="max-w-3xl mx-auto px-[5%] py-14">
        <div className="bg-[#fffdf8] border border-[#e5dfd3] p-8 sm:p-10">
          <div className="flex items-center gap-3 text-[#9a6746]">
            <CheckCircle2 className="w-6 h-6" />
            <span className="text-[11px] tracking-[0.22em] uppercase font-bold">
              Order Recorded
            </span>
          </div>

          <h1 className="font-serif-display text-3xl sm:text-4xl text-[#211f1b] mt-3">
            Thank you, {placedOrder.customer_name}.
          </h1>
          <p className="text-xs sm:text-sm text-[#5f594f] mt-2 leading-relaxed">
            Your order <strong className="text-[#211f1b] tabular-nums">{placedOrder.order_number}</strong>{' '}
            has been saved to your APNA KAPDA account.
          </p>

          <div className="mt-6 p-4 bg-[#f5f2eb] border border-[#e5dfd3] text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-[#817b70]">Order Status</span>
              <span className="font-semibold text-[#211f1b] uppercase tracking-wider">
                {placedOrder.order_status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#817b70]">Payment Method</span>
              <span className="font-semibold text-[#211f1b]">
                {placedOrder.payment_method === 'cod'
                  ? 'Cash on Delivery (COD)'
                  : 'Reserved — Online Payment Pending'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#817b70]">Payment Status</span>
              <span className="font-semibold text-[#9a6746] uppercase tracking-wider">
                {placedOrder.payment_status === 'cod_due'
                  ? 'Pay on Delivery'
                  : 'Awaiting Payment Gateway'}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-[#e5dfd3] tabular-nums">
              <span className="font-semibold text-[#211f1b]">Total Amount</span>
              <span className="font-bold text-[#211f1b]">
                {formatINR(placedOrder.total_inr)}
              </span>
            </div>
          </div>

          {placedOrder.payment_method === 'online_pending' && (
            <p className="text-xs text-[#69645b] mt-4 leading-relaxed">
              Your order is saved with <strong>Awaiting Payment</strong> status. No
              card or UPI charge was simulated; connect your live Razorpay/Stripe
              server webhook to collect online payments securely.
            </p>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onViewOrders}
              className="bg-[#24231f] text-white px-6 py-3.5 text-[11px] tracking-[0.18em] uppercase hover:bg-[#9a6746] transition-colors"
            >
              View My Orders
            </button>
            <button
              type="button"
              onClick={onBack}
              className="border border-[#24231f] text-[#211f1b] px-6 py-3.5 text-[11px] tracking-[0.18em] uppercase hover:bg-[#24231f] hover:text-white transition-colors"
            >
              Continue Shopping
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!user) {
      onRequireAuth();
      return;
    }

    if (!isSupabaseConfigured) {
      setErrorMsg(
        'Supabase is not configured yet. Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to save real orders.'
      );
      return;
    }

    if (itemsWithProduct.length === 0) {
      setErrorMsg('Your shopping bag is empty.');
      return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setErrorMsg('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (!/^\d{6}$/.test(address.pincode.trim())) {
      setErrorMsg('Please enter a valid 6-digit Indian PIN code.');
      return;
    }

    setSubmitting(true);

    if (saveAddressToProfile) {
      await updateUserProfile(user.id, {
        full_name: fullName,
        phone: cleanPhone,
        default_address: address,
      });
    }

    const result = await createOrder({
      userId: user.id,
      customerName: fullName,
      customerEmail: user.email || '',
      customerPhone: cleanPhone,
      shippingAddress: address,
      paymentMethod,
      subtotalInr: subtotal,
      shippingInr: shippingFee,
      totalInr: total,
      notes,
      items: itemsWithProduct.map((entry) => ({
        product_id: entry.product.id,
        product_name: entry.product.name,
        product_image: entry.product.image_url,
        selected_size: entry.size,
        unit_price_inr: entry.product.price_inr,
        quantity: entry.qty,
      })),
    });

    setSubmitting(false);

    if (result.error || !result.order) {
      setErrorMsg(result.error || 'Could not place order.');
      return;
    }

    setPlacedOrder(result.order);
    onOrderCreated(result.order);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-[5%] lg:px-[6%] py-10 lg:py-14">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-xs tracking-[0.14em] uppercase text-[#211f1b] hover:text-[#9a6746] mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back to Storefront</span>
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left: Shipping & Payment Method */}
        <div className="lg:col-span-7 bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8">
          <p className="text-[10px] tracking-[0.28em] uppercase text-[#9a6746] font-bold">
            Secure Checkout
          </p>
          <h1 className="font-serif-display text-3xl text-[#211f1b] mt-2 mb-6">
            Delivery &amp; Order Confirmation
          </h1>

          {!user ? (
            <div className="p-6 bg-[#f5f2eb] border border-[#e5dfd3]">
              <div className="flex items-center gap-2 text-[#211f1b] font-semibold text-sm">
                <Lock className="w-4 h-4 text-[#9a6746]" />
                <span>Sign in required to place an order</span>
              </div>
              <p className="text-xs text-[#69645b] mt-2 leading-relaxed">
                For order tracking and verified account protection via Supabase Row-Level
                Security, please sign in or create an account before completing checkout.
              </p>
              <button
                type="button"
                onClick={onRequireAuth}
                className="mt-4 bg-[#24231f] text-white px-5 py-3 text-[11px] tracking-[0.16em] uppercase hover:bg-[#9a6746] transition-colors"
              >
                Sign In / Create Account
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1.5">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Aarav Sharma"
                    className="w-full px-3.5 py-3 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1.5">
                    Mobile Number (+91) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9876543210"
                    className="w-full px-3.5 py-3 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746] tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1.5">
                  Street Address / House No. *
                </label>
                <input
                  type="text"
                  required
                  value={address.line1}
                  onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                  placeholder="42, Johari Bazaar Road"
                  className="w-full px-3.5 py-3 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1.5">
                  Apartment / Landmark (Optional)
                </label>
                <input
                  type="text"
                  value={address.line2 || ''}
                  onChange={(e) => setAddress({ ...address, line2: e.target.value })}
                  placeholder="Near Hawa Mahal Gate"
                  className="w-full px-3.5 py-3 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1.5">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={address.city}
                    onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    placeholder="Jaipur"
                    className="w-full px-3.5 py-3 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1.5">
                    State *
                  </label>
                  <input
                    type="text"
                    required
                    value={address.state}
                    onChange={(e) => setAddress({ ...address, state: e.target.value })}
                    placeholder="Rajasthan"
                    className="w-full px-3.5 py-3 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1.5">
                    PIN Code *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={address.pincode}
                    onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                    placeholder="302003"
                    className="w-full px-3.5 py-3 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746] tabular-nums"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-xs text-[#5f594f] cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveAddressToProfile}
                  onChange={(e) => setSaveAddressToProfile(e.target.checked)}
                  className="accent-[#9a6746]"
                />
                <span>Save this delivery address to my customer profile</span>
              </label>

              {/* Honest Payment Method Options */}
              <div className="pt-5 border-t border-[#e5dfd3]">
                <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-[#211f1b] mb-3">
                  Order &amp; Payment Method
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cod')}
                    className={`p-4 text-left border transition-colors ${
                      paymentMethod === 'cod'
                        ? 'border-[#24231f] bg-[#f5f2eb]'
                        : 'border-[#e5dfd3] hover:border-[#9a6746]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#211f1b]">
                        Cash on Delivery (COD)
                      </span>
                      <Truck className="w-4 h-4 text-[#9a6746]" />
                    </div>
                    <p className="text-[11px] text-[#817b70] mt-1.5 leading-relaxed">
                      Pay in cash or UPI directly at your doorstep upon delivery.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('online_pending')}
                    className={`p-4 text-left border transition-colors ${
                      paymentMethod === 'online_pending'
                        ? 'border-[#24231f] bg-[#f5f2eb]'
                        : 'border-[#e5dfd3] hover:border-[#9a6746]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#211f1b]">
                        Reserve Order (Pay Later)
                      </span>
                      <ShieldCheck className="w-4 h-4 text-[#9a6746]" />
                    </div>
                    <p className="text-[11px] text-[#817b70] mt-1.5 leading-relaxed">
                      Saves order as awaiting online payment until gateway checkout completes.
                    </p>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1.5">
                  Delivery Note (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Call on arrival, leave with reception, etc."
                  className="w-full px-3.5 py-3 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
                />
              </div>

              {errorMsg && (
                <div className="p-3.5 bg-[#fdf2f0] border border-[#e6c2b8] text-xs text-[#9a3b26]">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || itemsWithProduct.length === 0}
                className="w-full bg-[#24231f] text-white py-4 px-6 text-[11px] tracking-[0.2em] uppercase font-medium hover:bg-[#9a6746] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? 'Recording Order...'
                  : paymentMethod === 'cod'
                    ? `Place COD Order — ${formatINR(total)}`
                    : `Reserve Order (Pending Payment) — ${formatINR(total)}`}
              </button>
            </form>
          )}
        </div>

        {/* Right: Bag Summary */}
        <div className="lg:col-span-5 bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8 lg:sticky lg:top-28">
          <h2 className="font-serif-display text-2xl text-[#211f1b] pb-4 border-b border-[#e5dfd3]">
            Order Summary
          </h2>

          <div className="divide-y divide-[#e5dfd3] max-h-[360px] overflow-y-auto my-2">
            {itemsWithProduct.map(({ product, size, qty }) => (
              <div
                key={`${product.id}-${size}`}
                className="py-3.5 flex items-center gap-3.5"
              >
                <div className="w-14 h-18 bg-[#e9e3d8] overflow-hidden shrink-0">
                  <ResilientImage
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#211f1b] truncate">
                    {product.name}
                  </p>
                  <p className="text-[11px] text-[#817b70] mt-0.5 tabular-nums">
                    Size {size} &times; {qty}
                  </p>
                </div>
                <span className="text-xs font-semibold text-[#211f1b] tabular-nums">
                  {formatINR(product.price_inr * qty)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-[#e5dfd3] pt-4 space-y-2.5 text-xs tabular-nums">
            <div className="flex justify-between text-[#5f594f]">
              <span>Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between text-[#5f594f]">
              <span>Shipping</span>
              <span>
                {shippingFee === 0 ? 'Complimentary' : formatINR(shippingFee)}
              </span>
            </div>
            <div className="flex justify-between text-base font-bold text-[#211f1b] pt-3 border-t border-[#e5dfd3]">
              <span>Total</span>
              <span>{formatINR(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
