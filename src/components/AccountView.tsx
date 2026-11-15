import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  LogOut,
  Package,
  Save,
  UserCheck,
  X,
} from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { formatINR } from '../data/catalog';
import {
  cancelCustomerOrder,
  fetchCustomerOrders,
  updateUserProfile,
} from '../services/storeService';
import type {
  Order,
  OrderStatus,
  ShippingAddress,
  UserProfile,
} from '../types';

interface AccountViewProps {
  user: SupabaseUser | null;
  profile: UserProfile | null;
  onBack: () => void;
  onProfileUpdated: () => void;
  onOrderCancelled?: () => void;
  onLogout: () => void;
}

const CUSTOMER_CANCELLABLE_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
];

const QUICK_CANCEL_REASONS = [
  'Ordered by mistake',
  'Need a different size',
  'Delivery taking too long',
  'Changed my mind',
];

function isCustomerCancellable(order: Order): boolean {
  return CUSTOMER_CANCELLABLE_STATUSES.includes(order.order_status);
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function getCustomerPaymentLabel(order: Order): string {
  if (order.order_status === 'cancelled') {
    if (
      order.payment_status === 'refund_pending' ||
      order.refund_status === 'pending'
    ) {
      return 'Refund Pending (Awaiting payment provider confirmation)';
    }
    if (
      order.payment_status === 'refunded' ||
      order.refund_status === 'processed'
    ) {
      return 'Refund Processed';
    }
    if (order.payment_method === 'cod') {
      return 'COD Cancelled (No payment collected)';
    }
    return 'Online Reservation Cancelled (No charge captured)';
  }
  return order.payment_status.replace('_', ' ');
}

export function AccountView({
  user,
  profile,
  onBack,
  onProfileUpdated,
  onOrderCancelled,
  onLogout,
}: AccountViewProps) {
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [address, setAddress] = useState<ShippingAddress>({
    line1: profile?.default_address?.line1 || '',
    line2: profile?.default_address?.line2 || '',
    city: profile?.default_address?.city || '',
    state: profile?.default_address?.state || '',
    pincode: profile?.default_address?.pincode || '',
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelModalError, setCancelModalError] = useState('');
  const [orderNotice, setOrderNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '');
      setPhone(profile.phone || '');
      setAddress({
        line1: profile.default_address?.line1 || '',
        line2: profile.default_address?.line2 || '',
        city: profile.default_address?.city || '',
        state: profile.default_address?.state || '',
        pincode: profile.default_address?.pincode || '',
      });
    }
  }, [profile]);

  const loadOrders = useCallback(async () => {
    if (!user) return;
    setLoadingOrders(true);
    setOrdersError('');
    const res = await fetchCustomerOrders(user.id);
    if (res.error) {
      setOrdersError(res.error);
    }
    setOrders(res.orders);
    setLoadingOrders(false);
  }, [user]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  if (!user) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setSaveMessage('');
    const res = await updateUserProfile(user.id, {
      full_name: fullName,
      phone,
      default_address: address,
    });
    setSavingProfile(false);
    if (res.error) {
      setSaveMessage(res.error);
      return;
    }
    setSaveMessage('Profile saved.');
    onProfileUpdated();
  };

  const openCancelDialog = (order: Order) => {
    setCancelTarget(order);
    setCancelReason('');
    setCancelModalError('');
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget || cancelling) return;

    setCancelling(true);
    setCancelModalError('');
    setOrderNotice(null);

    const res = await cancelCustomerOrder(cancelTarget.id, cancelReason);
    setCancelling(false);

    if (res.error) {
      setCancelModalError(res.error);
      return;
    }

    const cancelledOrderNumber = cancelTarget.order_number;
    const wasPaidOnline = cancelTarget.payment_status === 'paid';
    setCancelTarget(null);
    setCancelReason('');

    await loadOrders();
    onOrderCancelled?.();

    setOrderNotice({
      type: 'success',
      text: wasPaidOnline
        ? `Order ${cancelledOrderNumber} has been cancelled. Your refund is marked as Pending until confirmed by our payment provider.`
        : `Order ${cancelledOrderNumber} has been cancelled successfully.`,
    });
  };

  return (
    <div className="max-w-[1440px] mx-auto px-[5%] lg:px-[6%] py-10 lg:py-14">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 mb-8 border-b border-[#e5dfd3]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-xs tracking-[0.14em] uppercase text-[#211f1b] hover:text-[#9a6746]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Shop</span>
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-2 border border-[#211f1b] px-4 py-2 text-[10px] tracking-[0.16em] uppercase text-[#211f1b] hover:bg-[#211f1b] hover:text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Customer Profile Form */}
        <section className="lg:col-span-5 bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.26em] uppercase text-[#9a6746] font-bold">
            <UserCheck className="w-3.5 h-3.5" />
            <span>Customer Profile</span>
          </div>
          <h1 className="font-serif-display text-2xl sm:text-3xl text-[#211f1b] mt-2">
            {profile?.full_name || user.email}
          </h1>
          <p className="text-xs text-[#817b70] mt-1 mb-6">
            {user.email} &middot; Role: {profile?.role || 'customer'}
          </p>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1">
                Mobile Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746] tabular-nums"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-[#5f594f] mb-1">
                Street Address
              </label>
              <input
                type="text"
                value={address.line1}
                onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
              />
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <input
                type="text"
                placeholder="City"
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
                className="px-3 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
              />
              <input
                type="text"
                placeholder="State"
                value={address.state}
                onChange={(e) => setAddress({ ...address, state: e.target.value })}
                className="px-3 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
              />
              <input
                type="text"
                placeholder="PIN"
                maxLength={6}
                value={address.pincode}
                onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                className="px-3 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746] tabular-nums"
              />
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="w-full bg-[#24231f] text-white py-3 px-4 text-[11px] tracking-[0.16em] uppercase inline-flex items-center justify-center gap-2 hover:bg-[#9a6746] transition-colors disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingProfile ? 'Saving...' : 'Save Details'}</span>
            </button>

            {saveMessage && (
              <p className="text-xs text-[#9a6746] mt-2">{saveMessage}</p>
            )}
          </form>
        </section>

        {/* Order History */}
        <section className="lg:col-span-7 bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.26em] uppercase text-[#9a6746] font-bold">
            <Package className="w-3.5 h-3.5" />
            <span>Your Orders</span>
          </div>
          <h2 className="font-serif-display text-2xl sm:text-3xl text-[#211f1b] mt-2 mb-6">
            Order History
          </h2>

          {orderNotice && (
            <div
              role="status"
              className={`mb-5 p-3.5 border text-xs flex items-start gap-2.5 ${
                orderNotice.type === 'error'
                  ? 'bg-[#fdf2f0] border-[#e6c2b8] text-[#9a3b26]'
                  : 'bg-[#f5f2eb] border-[#c8bfae] text-[#211f1b]'
              }`}
            >
              {orderNotice.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#9a3b26]" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#9a6746]" />
              )}
              <span className="leading-relaxed">{orderNotice.text}</span>
            </div>
          )}

          {loadingOrders ? (
            <p className="text-xs text-[#817b70]">Loading your orders...</p>
          ) : ordersError ? (
            <div className="p-4 bg-[#fdf2f0] border border-[#e6c2b8] text-xs text-[#9a3b26] flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Unable to load your orders</p>
                <p className="mt-1">{ordersError}</p>
              </div>
            </div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center border border-dashed border-[#e5dfd3] bg-[#f5f2eb]/40">
              <p className="font-serif-display text-xl text-[#211f1b]">
                No orders placed yet.
              </p>
              <p className="text-xs text-[#817b70] mt-1.5">
                When you place a COD or reserved order, it will appear here.
              </p>
              <button
                type="button"
                onClick={onBack}
                className="mt-4 px-5 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.16em] uppercase"
              >
                Explore Collection
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {orders.map((order) => {
                const canCancel = isCustomerCancellable(order);
                const isCancelled = order.order_status === 'cancelled';

                return (
                  <div
                    key={order.id}
                    className={`border p-5 ${
                      isCancelled
                        ? 'border-[#dfd5c5] bg-[#f5f2eb]/55'
                        : 'border-[#e5dfd3] bg-[#f5f2eb]/30'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#e5dfd3]">
                      <div>
                        <span className="text-xs font-bold text-[#211f1b] tabular-nums">
                          {order.order_number}
                        </span>
                        <span className="mx-2 text-[#817b70]">&middot;</span>
                        <span className="text-[11px] text-[#817b70] tabular-nums">
                          {new Date(order.created_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>

                      <div
                        className={`text-[11px] uppercase tracking-wider font-semibold ${
                          isCancelled ? 'text-[#9a3b26]' : 'text-[#9a6746]'
                        }`}
                      >
                        {order.order_status} &middot;{' '}
                        {order.payment_status.replace('_', ' ')}
                      </div>
                    </div>

                    <div className="py-3 space-y-2 text-xs">
                      {order.order_items?.map((item, i) => (
                        <div
                          key={item.id || i}
                          className="flex items-center justify-between text-[#5f594f] tabular-nums"
                        >
                          <span>
                            {item.product_name} (Size {item.selected_size}) &times;{' '}
                            {item.quantity}
                          </span>
                          <span className="font-medium text-[#211f1b]">
                            {formatINR(item.unit_price_inr * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>

                    {isCancelled && (
                      <div className="my-2.5 p-3.5 bg-[#fffdf8] border border-[#e5dfd3] text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] tracking-[0.16em] uppercase font-bold text-[#9a3b26]">
                            Order Cancelled
                            {order.cancelled_by
                              ? ` · By ${
                                  order.cancelled_by === 'admin'
                                    ? 'Store Admin'
                                    : 'You'
                                }`
                              : ''}
                          </span>
                          {order.cancelled_at && (
                            <span className="text-[11px] text-[#817b70] tabular-nums">
                              {formatDateTime(order.cancelled_at)}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#5f594f]">
                          {getCustomerPaymentLabel(order)}
                        </p>
                        {order.cancellation_reason && (
                          <p className="text-[11px] text-[#5f594f]">
                            Reason: <span className="text-[#211f1b]">{order.cancellation_reason}</span>
                          </p>
                        )}
                      </div>
                    )}

                    <div className="pt-3 border-t border-[#e5dfd3] flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums">
                      <span className="text-[#817b70]">
                        Deliver to: {order.shipping_address.city},{' '}
                        {order.shipping_address.pincode}
                      </span>

                      <div className="flex flex-wrap items-center gap-3 ml-auto">
                        {(order.discount_inr ?? 0) > 0 && (
                          <span className="text-[11px] text-[#2b6345] font-medium">
                            {order.applied_coupon_code
                              ? `Coupon ${order.applied_coupon_code}`
                              : order.applied_offer_title || 'Offer'}{' '}
                            (&minus;{formatINR(order.discount_inr ?? 0)})
                          </span>
                        )}
                        <span className="font-bold text-[#211f1b]">
                          Total: {formatINR(order.total_inr)}
                        </span>

                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => openCancelDialog(order)}
                            className="inline-flex items-center gap-1.5 border border-[#9a3b26] px-3 py-1.5 text-[10px] tracking-[0.14em] uppercase font-semibold text-[#9a3b26] hover:bg-[#9a3b26] hover:text-white transition-colors cursor-pointer"
                          >
                            <Ban className="w-3 h-3" />
                            <span>Cancel Order</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Customer Cancellation Confirmation Modal */}
      {cancelTarget && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !cancelling && setCancelTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm order cancellation"
        >
          <div
            className="relative w-full max-w-[460px] bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={cancelling}
              onClick={() => setCancelTarget(null)}
              aria-label="Close cancellation dialog"
              className="absolute right-4 top-4 p-1.5 text-[#817b70] hover:text-[#211f1b] cursor-pointer disabled:opacity-40"
            >
              <X className="w-5 h-5" />
            </button>

            <p className="text-[10px] tracking-[0.24em] uppercase text-[#9a6746] font-bold">
              Order Cancellation
            </p>
            <h3 className="font-serif-display text-2xl sm:text-3xl text-[#211f1b] mt-2">
              Cancel order <span className="tabular-nums">{cancelTarget.order_number}</span>?
            </h3>
            <p className="text-xs text-[#5f594f] mt-2 leading-relaxed">
              This action cannot be undone. Your cancellation reason and timestamp will be
              saved on your order of{' '}
              <strong className="text-[#211f1b]">
                {cancelTarget.order_items?.reduce((s, i) => s + i.quantity, 0) || 1}{' '}
                item(s)
              </strong>
              .
            </p>

            <div className="mt-4 p-3.5 bg-[#f5f2eb] border border-[#e5dfd3] text-xs text-[#5f594f] space-y-1">
              <p className="font-semibold text-[#211f1b]">
                Total Amount: <span className="tabular-nums">{formatINR(cancelTarget.total_inr)}</span>
              </p>
              <p className="text-[11px]">
                {cancelTarget.payment_status === 'paid'
                  ? 'Paid Online: Your refund status will be marked as Pending until confirmed by the payment provider.'
                  : cancelTarget.payment_method === 'cod'
                    ? 'Cash on Delivery: No payment was collected; your order will simply be cancelled.'
                    : 'Online Payment Pending: Your reservation will be cancelled before any payment is captured.'}
              </p>
            </div>

            <form onSubmit={handleConfirmCancel} className="mt-5 space-y-4">
              <div>
                <p className="text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-2">
                  Reason for cancellation (Optional)
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {QUICK_CANCEL_REASONS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCancelReason(preset)}
                      className={`px-2.5 py-1 text-[11px] border transition-colors cursor-pointer ${
                        cancelReason === preset
                          ? 'bg-[#24231f] text-white border-[#24231f]'
                          : 'bg-[#fffdf8] text-[#5f594f] border-[#e5dfd3] hover:border-[#24231f]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Share an optional note..."
                  className="w-full px-3.5 py-2.5 border border-[#e5dfd3] bg-[#fffdf8] text-xs outline-none focus:border-[#9a6746]"
                />
              </div>

              {cancelModalError && (
                <div className="p-3 bg-[#fdf2f0] border border-[#e6c2b8] text-xs text-[#9a3b26]">
                  {cancelModalError}
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => setCancelTarget(null)}
                  className="flex-1 py-3 px-4 border border-[#24231f] text-[#211f1b] text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#f5f2eb] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Keep Order
                </button>
                <button
                  type="submit"
                  disabled={cancelling}
                  className="flex-1 py-3 px-4 bg-[#9a3b26] text-white text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#7d2e1d] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {cancelling ? 'Cancelling...' : 'Confirm Cancellation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
