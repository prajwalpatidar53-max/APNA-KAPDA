import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  MapPin,
  PackageCheck,
  Search,
  User,
  X,
} from 'lucide-react';
import { formatINR } from '../data/catalog';
import type { Order, OrderStatus, PaymentStatus, Product } from '../types';
import {
  ADMIN_EASE,
  AdminTableSkeleton,
  orderStatusBadgeV2,
  paymentStatusBadgeV2,
} from './AdminMotion';
import {
  cancelOrderAdmin,
  updateAdminOrder,
  updateAdminOrderDelivery,
} from './adminService';

interface AdminOrdersProps {
  orders: Order[];
  products?: Product[];
  loading: boolean;
  initialOrderId?: string | null;
  onClearInitialOrder?: () => void;
  onRefresh: () => Promise<void>;
}

const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
];

const FULFILLMENT_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
  'shipped',
  'delivered',
];

const ADMIN_CANCELLABLE_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'packed',
  'shipped',
];

const PAYMENT_STATUSES: PaymentStatus[] = [
  'cod_due',
  'awaiting_payment',
  'paid',
  'refund_pending',
  'failed',
  'refunded',
  'cancelled',
];

type OrderSortOption = 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';

function isAdminCancellable(order: Order): boolean {
  return ADMIN_CANCELLABLE_STATUSES.includes(order.order_status);
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

function getAdminRefundSummary(order: Order): string {
  if (
    order.payment_status === 'refund_pending' ||
    order.refund_status === 'pending'
  ) {
    return 'Online payment was captured — Refund is Pending until confirmed by the payment provider.';
  }
  if (
    order.payment_status === 'refunded' ||
    order.refund_status === 'processed'
  ) {
    return 'Refund processed and confirmed.';
  }
  if (order.payment_method === 'cod') {
    return 'Cash on Delivery — Order cancelled without creating a refund.';
  }
  return 'Online payment was still awaiting capture — Reservation cancelled with no refund needed.';
}

export function AdminOrders({
  orders,
  loading,
  initialOrderId,
  onClearInitialOrder,
  onRefresh,
}: AdminOrdersProps) {
  const [search, setSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | OrderStatus>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | PaymentStatus>('all');
  const [orderScopeFilter, setOrderScopeFilter] = useState<'all' | 'live' | 'test'>('all');
  const [sortBy, setSortBy] = useState<OrderSortOption>('newest');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [editOrderStatus, setEditOrderStatus] = useState<OrderStatus>('pending');
  const [editPaymentStatus, setEditPaymentStatus] = useState<PaymentStatus>('cod_due');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [listNotice, setListNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const [editingDelivery, setEditingDelivery] = useState(false);
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [deliveryDraft, setDeliveryDraft] = useState({
    customer_name: '',
    customer_phone: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    pincode: '',
  });

  useEffect(() => {
    if (initialOrderId) {
      const found = orders.find((o) => o.id === initialOrderId);
      if (found) {
        openOrderDrawer(found);
      }
      onClearInitialOrder?.();
    }
  }, [initialOrderId, orders, onClearInitialOrder]);

  useEffect(() => {
    if (!selectedOrder) return;
    const latest = orders.find((o) => o.id === selectedOrder.id);
    if (latest) {
      setSelectedOrder(latest);
      setEditOrderStatus(latest.order_status);
      setEditPaymentStatus(latest.payment_status);
    }
  }, [orders, selectedOrder?.id]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = orders.filter((o) => {
      const matchScope =
        orderScopeFilter === 'all' ||
        (orderScopeFilter === 'test' ? Boolean(o.is_test_order) : !o.is_test_order);
      const matchOrderStatus =
        orderStatusFilter === 'all' || o.order_status === orderStatusFilter;
      const matchPaymentStatus =
        paymentStatusFilter === 'all' || o.payment_status === paymentStatusFilter;
      const matchQuery =
        !q ||
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.customer_email.toLowerCase().includes(q) ||
        o.customer_phone.toLowerCase().includes(q);
      return matchScope && matchOrderStatus && matchPaymentStatus && matchQuery;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortBy === 'amount_desc') {
        return Number(b.total_inr || 0) - Number(a.total_inr || 0);
      }
      if (sortBy === 'amount_asc') {
        return Number(a.total_inr || 0) - Number(b.total_inr || 0);
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [orders, search, orderStatusFilter, paymentStatusFilter, orderScopeFilter, sortBy]);

  const openOrderDrawer = (order: Order) => {
    setSelectedOrder(order);
    setEditOrderStatus(order.order_status);
    setEditPaymentStatus(order.payment_status);
    setEditingDelivery(false);
    setDeliveryDraft({
      customer_name: order.customer_name || '',
      customer_phone: order.customer_phone || '',
      line1: order.shipping_address?.line1 || '',
      line2: order.shipping_address?.line2 || '',
      city: order.shipping_address?.city || '',
      state: order.shipping_address?.state || '',
      pincode: order.shipping_address?.pincode || '',
    });
    setFeedback(null);
  };

  const openCancelDialog = (order: Order) => {
    setCancelTarget(order);
    setCancelReason('');
    setCancelError('');
  };

  const handleSaveOrderUpdate = async () => {
    if (!selectedOrder) return;
    setSaving(true);
    setFeedback(null);

    const payload: { order_status?: OrderStatus; payment_status?: PaymentStatus } = {
      payment_status: editPaymentStatus,
    };
    if (selectedOrder.order_status !== 'cancelled') {
      payload.order_status = editOrderStatus;
    }

    const res = await updateAdminOrder(selectedOrder.id, payload);
    setSaving(false);

    if (res.error) {
      setFeedback({ type: 'err', text: res.error });
      return;
    }

    setFeedback({
      type: 'ok',
      text: `Saved status updates for ${selectedOrder.order_number}.`,
    });
    await onRefresh();
  };

  const handleConfirmAdminCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget || cancelling) return;

    setCancelling(true);
    setCancelError('');
    setFeedback(null);
    setListNotice(null);

    const res = await cancelOrderAdmin(cancelTarget.id, cancelReason);
    setCancelling(false);

    if (res.error) {
      setCancelError(res.error);
      return;
    }

    const cancelledNum = cancelTarget.order_number;
    const cancelledId = cancelTarget.id;
    const wasPaid = cancelTarget.payment_status === 'paid';

    setCancelTarget(null);
    setCancelReason('');
    await onRefresh();

    const baseMessage = wasPaid
      ? `Order ${cancelledNum} cancelled. Payment marked Refund Pending. Manage product stock manually in Products.`
      : `Order ${cancelledNum} cancelled. Manage product stock manually in Products.`;
    const message = res.warning ? `${baseMessage} Notice: ${res.warning}` : baseMessage;
    const noticeType: 'ok' | 'err' = res.warning ? 'err' : 'ok';

    setListNotice({ type: noticeType, text: message });
    if (selectedOrder && selectedOrder.id === cancelledId) {
      setFeedback({ type: noticeType, text: message });
    }
  };

  return (
    <div className="space-y-5">
      {/* Filter Toolbar */}
      <div className="rounded-[22px] bg-white/88 backdrop-blur-sm border border-white shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-[#7c94a0] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order #, customer name, email..."
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430] placeholder:text-[#7c94a0] transition-colors"
            />
          </div>

          <select
            value={orderStatusFilter}
            onChange={(e) =>
              setOrderStatusFilter(e.target.value as 'all' | OrderStatus)
            }
            aria-label="Filter by order status"
            className="px-3.5 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430] capitalize"
          >
            <option value="all">All Order Statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>

          <select
            value={paymentStatusFilter}
            onChange={(e) =>
              setPaymentStatusFilter(e.target.value as 'all' | PaymentStatus)
            }
            aria-label="Filter by payment status"
            className="px-3.5 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430]"
          >
            <option value="all">All Payment Statuses</option>
            {PAYMENT_STATUSES.map((p) => (
              <option key={p} value={p}>
                {p.replace('_', ' ')}
              </option>
            ))}
          </select>

          <select
            value={orderScopeFilter}
            onChange={(e) =>
              setOrderScopeFilter(e.target.value as 'all' | 'live' | 'test')
            }
            aria-label="Filter by order scope"
            className="px-3.5 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430]"
          >
            <option value="all">All Orders (Live &amp; QA Test)</option>
            <option value="live">Live Customer Orders</option>
            <option value="test">QA Test Orders Only</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as OrderSortOption)}
            aria-label="Sort orders"
            className="px-3.5 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430]"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="amount_desc">Highest Total</option>
            <option value="amount_asc">Lowest Total</option>
          </select>
        </div>

        <p className="text-xs text-[#546e7a] tabular-nums shrink-0">
          Showing{' '}
          <strong className="text-[#0f2430] font-semibold">
            {filteredOrders.length}
          </strong>{' '}
          of {orders.length} orders
        </p>
      </div>

      {listNotice && (
        <div
          role="status"
          className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2.5 ${
            listNotice.type === 'err'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {listNotice.type === 'err' ? (
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          )}
          <span>{listNotice.text}</span>
        </div>
      )}

      {/* Orders Table / Mobile List */}
      <div className="rounded-[22px] bg-white/88 backdrop-blur-sm border border-white shadow-[0_8px_28px_-14px_rgba(15,36,48,0.12)] overflow-hidden">
        {loading ? (
          <AdminTableSkeleton rows={6} />
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-base font-semibold text-[#0f2430]">
              No matching orders
            </p>
            <p className="text-xs text-[#546e7a] mt-1.5">
              {orders.length === 0
                ? 'Customer orders placed through checkout will appear here.'
                : 'Try adjusting your order number search or status filters.'}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-[#f6fafb] text-[11px] font-semibold text-[#607b87]">
                    <th className="py-3.5 px-5">Order #</th>
                    <th className="py-3.5 px-3">Date</th>
                    <th className="py-3.5 px-3">Customer</th>
                    <th className="py-3.5 px-3">Items</th>
                    <th className="py-3.5 px-3">Payment</th>
                    <th className="py-3.5 px-3">Order Status</th>
                    <th className="py-3.5 px-5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 text-xs">
                  {filteredOrders.map((order) => {
                    const itemCount =
                      order.order_items?.reduce(
                        (sum, item) => sum + item.quantity,
                        0
                      ) ?? 0;
                    return (
                      <tr
                        key={order.id}
                        onClick={() => openOrderDrawer(order)}
                        className="hover:bg-[#f2f8fa] transition-colors cursor-pointer group"
                      >
                        <td className="py-3.5 px-5 font-semibold text-[#0f2430] tabular-nums whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="group-hover:text-[#0e7490] transition-colors">
                              {order.order_number}
                            </span>
                            {order.is_test_order && (
                              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                TEST
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-[#607b87] tabular-nums whitespace-nowrap">
                          {formatDateTime(order.created_at)}
                        </td>
                        <td className="py-3.5 px-3">
                          <p className="font-semibold text-[#0f2430]">
                            {order.customer_name}
                          </p>
                          <p className="text-[11px] text-[#607b87]">
                            {order.customer_email}
                          </p>
                        </td>
                        <td className="py-3.5 px-3 text-[#3c5662] tabular-nums whitespace-nowrap">
                          {itemCount} {itemCount === 1 ? 'item' : 'items'}
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#607b87]">
                              {order.payment_method === 'cod' ? 'COD' : 'Online'}
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize ${paymentStatusBadgeV2(
                                order.payment_status
                              )}`}
                            >
                              {order.payment_status.replace('_', ' ')}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize ${orderStatusBadgeV2(
                                order.order_status
                              )}`}
                            >
                              {order.order_status}
                            </span>
                            {order.order_status === 'cancelled' && order.cancelled_by && (
                              <span className="text-[11px] text-[#708a96] capitalize">
                                By {order.cancelled_by}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-5 text-right font-semibold text-[#0f2430] tabular-nums whitespace-nowrap">
                          {formatINR(order.total_inr)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Order Cards */}
            <div className="md:hidden divide-y divide-slate-200/70">
              {filteredOrders.map((order) => {
                const itemCount =
                  order.order_items?.reduce(
                    (sum, item) => sum + item.quantity,
                    0
                  ) ?? 0;
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => openOrderDrawer(order)}
                    className="w-full text-left p-4 hover:bg-[#f2f8fa] transition-colors cursor-pointer space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#0f2430] tabular-nums">
                          {order.order_number}
                        </span>
                        {order.is_test_order && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            TEST
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-[#0f2430] tabular-nums">
                        {formatINR(order.total_inr)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#607b87]">
                      <span className="truncate">{order.customer_name}</span>
                      <span className="tabular-nums shrink-0">
                        {itemCount} {itemCount === 1 ? 'item' : 'items'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize ${orderStatusBadgeV2(
                          order.order_status
                        )}`}
                      >
                        {order.order_status}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border capitalize ${paymentStatusBadgeV2(
                          order.payment_status
                        )}`}
                      >
                        {order.payment_method === 'cod' ? 'COD' : 'Online'} ·{' '}
                        {order.payment_status.replace('_', ' ')}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Order Inspection Slide-Over Drawer */}
      <AnimatePresence>
        {selectedOrder && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-[#071c27]/55 backdrop-blur-[3px] flex justify-end"
            onClick={() => setSelectedOrder(null)}
          >
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.28, ease: ADMIN_EASE }}
              className="w-full max-w-xl bg-[#f4f8fa] text-[#0f2430] h-full overflow-y-auto border-l border-white shadow-2xl flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-slate-200/80 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur-md z-10">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0e7490]">
                    Order Details
                  </p>
                  <h3 className="font-sans text-xl font-semibold text-[#0f2430] tabular-nums mt-0.5">
                    {selectedOrder.order_number}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  aria-label="Close order details"
                  className="p-2 rounded-full text-[#546e7a] hover:text-[#0f2430] hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-5 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-[#607b87] tabular-nums">
                    Placed on {formatDateTime(selectedOrder.created_at)}
                  </p>
                  {selectedOrder.is_test_order && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      QA Test Order
                    </span>
                  )}
                </div>

                {selectedOrder.is_test_order && (
                  <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-900 leading-relaxed">
                    <strong>Isolated Bulk Shipping QA Test Order:</strong> Synthetic
                    contact &amp; delivery details for dispatch PDF/label testing.
                    Product inventory stock was not deducted and this order is
                    excluded from revenue analytics.
                  </div>
                )}

                {/* Cancellation Audit Card */}
                {selectedOrder.order_status === 'cancelled' && (
                  <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-rose-800">
                        Order Cancelled &middot; Initiated by{' '}
                        {selectedOrder.cancelled_by === 'customer'
                          ? 'Customer'
                          : selectedOrder.cancelled_by === 'admin'
                            ? 'Admin'
                            : 'System'}
                      </span>
                      {selectedOrder.cancelled_at && (
                        <span className="text-[11px] text-rose-700 tabular-nums">
                          {formatDateTime(selectedOrder.cancelled_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-rose-800">
                      {getAdminRefundSummary(selectedOrder)}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-rose-900/80 pt-1">
                      <span>
                        Inventory Handling:{' '}
                        <strong className="text-rose-950">
                          {selectedOrder.stock_restoration_status === 'restored' ||
                          selectedOrder.stock_restored
                            ? 'Restored (Historical)'
                            : 'Manual — Update stock in Admin → Products'}
                        </strong>
                      </span>
                      <span>
                        Reason:{' '}
                        <strong className="text-rose-950">
                          {selectedOrder.cancellation_reason || 'No reason provided'}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}

                {/* Status Controls */}
                <div className="rounded-2xl bg-white border border-slate-200/80 p-5 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <PackageCheck className="w-4 h-4 text-[#0e7490]" />
                    <h4 className="font-sans text-xs font-semibold text-[#0f2430]">
                      Update Fulfillment &amp; Payment Status
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#546e7a] mb-1.5">
                        Order Status
                      </label>
                      {selectedOrder.order_status === 'cancelled' ? (
                        <div className="px-3 py-2.5 rounded-xl text-xs bg-rose-50 border border-rose-200 text-rose-700 font-semibold">
                          Cancelled
                        </div>
                      ) : (
                        <select
                          value={editOrderStatus}
                          onChange={(e) =>
                            setEditOrderStatus(e.target.value as OrderStatus)
                          }
                          className="w-full px-3 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430] capitalize"
                        >
                          {FULFILLMENT_STATUSES.map((s) => (
                            <option key={s} value={s} className="capitalize">
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#546e7a] mb-1.5">
                        Payment Status
                      </label>
                      <select
                        value={editPaymentStatus}
                        onChange={(e) =>
                          setEditPaymentStatus(e.target.value as PaymentStatus)
                        }
                        className="w-full px-3 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430]"
                      >
                        {PAYMENT_STATUSES.map((p) => (
                          <option key={p} value={p}>
                            {p.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {feedback && (
                    <p
                      className={`text-xs p-3 rounded-xl border ${
                        feedback.type === 'err'
                          ? 'bg-rose-50 border-rose-200 text-rose-800'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      }`}
                    >
                      {feedback.text}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleSaveOrderUpdate}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0f2430] text-white text-xs font-semibold hover:bg-[#0e7490] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{saving ? 'Updating...' : 'Save Order Status'}</span>
                    </button>

                    {isAdminCancellable(selectedOrder) && (
                      <button
                        type="button"
                        onClick={() => openCancelDialog(selectedOrder)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 transition-colors cursor-pointer"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Cancel Order</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Customer & Shipping Address */}
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
                      <div className="flex items-center gap-2 text-[#0e7490] mb-2">
                        <User className="w-3.5 h-3.5" />
                        <span className="text-xs font-semibold">Customer</span>
                      </div>
                      <p className="text-xs font-semibold text-[#0f2430]">
                        {selectedOrder.customer_name}
                      </p>
                      <p className="text-xs text-[#607b87] mt-1 break-all">
                        {selectedOrder.customer_email}
                      </p>
                      <p className="text-xs text-[#3c5662] mt-0.5 tabular-nums">
                        {selectedOrder.customer_phone}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 text-[#0e7490]">
                          <MapPin className="w-3.5 h-3.5" />
                          <span className="text-xs font-semibold">
                            Shipping Address
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDelivery((v) => !v);
                            setDeliveryDraft({
                              customer_name: selectedOrder.customer_name || '',
                              customer_phone: selectedOrder.customer_phone || '',
                              line1: selectedOrder.shipping_address?.line1 || '',
                              line2: selectedOrder.shipping_address?.line2 || '',
                              city: selectedOrder.shipping_address?.city || '',
                              state: selectedOrder.shipping_address?.state || '',
                              pincode: selectedOrder.shipping_address?.pincode || '',
                            });
                          }}
                          className="text-xs font-semibold text-[#0e7490] hover:text-[#0f2430] cursor-pointer"
                        >
                          {editingDelivery ? 'Cancel' : 'Edit'}
                        </button>
                      </div>
                      <p className="text-xs text-[#334e5a] leading-relaxed">
                        {selectedOrder.shipping_address.line1}
                        {selectedOrder.shipping_address.line2
                          ? `, ${selectedOrder.shipping_address.line2}`
                          : ''}
                        <br />
                        {selectedOrder.shipping_address.city},{' '}
                        {selectedOrder.shipping_address.state} &ndash;{' '}
                        <span className="tabular-nums font-medium">
                          {selectedOrder.shipping_address.pincode}
                        </span>
                      </p>
                    </div>
                  </div>

                  {editingDelivery && (
                    <div className="rounded-2xl border border-cyan-200 bg-cyan-50/50 p-4 space-y-3">
                      <p className="text-xs font-semibold text-[#0e7490]">
                        Fix Customer Contact / Delivery Address
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <input
                          type="text"
                          value={deliveryDraft.customer_name}
                          onChange={(e) =>
                            setDeliveryDraft((d) => ({
                              ...d,
                              customer_name: e.target.value,
                            }))
                          }
                          placeholder="Customer Name *"
                          className="px-3 py-2 rounded-xl bg-white border border-slate-200 focus:border-[#0e7490] text-[#0f2430] outline-none"
                        />
                        <input
                          type="tel"
                          value={deliveryDraft.customer_phone}
                          onChange={(e) =>
                            setDeliveryDraft((d) => ({
                              ...d,
                              customer_phone: e.target.value,
                            }))
                          }
                          placeholder="Phone (10 digits) *"
                          className="px-3 py-2 rounded-xl bg-white border border-slate-200 focus:border-[#0e7490] text-[#0f2430] outline-none"
                        />
                        <input
                          type="text"
                          value={deliveryDraft.line1}
                          onChange={(e) =>
                            setDeliveryDraft((d) => ({ ...d, line1: e.target.value }))
                          }
                          placeholder="Address Line 1 *"
                          className="sm:col-span-2 px-3 py-2 rounded-xl bg-white border border-slate-200 focus:border-[#0e7490] text-[#0f2430] outline-none"
                        />
                        <input
                          type="text"
                          value={deliveryDraft.line2}
                          onChange={(e) =>
                            setDeliveryDraft((d) => ({ ...d, line2: e.target.value }))
                          }
                          placeholder="Address Line 2 (Optional)"
                          className="sm:col-span-2 px-3 py-2 rounded-xl bg-white border border-slate-200 focus:border-[#0e7490] text-[#0f2430] outline-none"
                        />
                        <input
                          type="text"
                          value={deliveryDraft.city}
                          onChange={(e) =>
                            setDeliveryDraft((d) => ({ ...d, city: e.target.value }))
                          }
                          placeholder="City *"
                          className="px-3 py-2 rounded-xl bg-white border border-slate-200 focus:border-[#0e7490] text-[#0f2430] outline-none"
                        />
                        <input
                          type="text"
                          value={deliveryDraft.state}
                          onChange={(e) =>
                            setDeliveryDraft((d) => ({ ...d, state: e.target.value }))
                          }
                          placeholder="State *"
                          className="px-3 py-2 rounded-xl bg-white border border-slate-200 focus:border-[#0e7490] text-[#0f2430] outline-none"
                        />
                        <input
                          type="text"
                          maxLength={6}
                          value={deliveryDraft.pincode}
                          onChange={(e) =>
                            setDeliveryDraft((d) => ({
                              ...d,
                              pincode: e.target.value.replace(/\D/g, '').slice(0, 6),
                            }))
                          }
                          placeholder="6-digit PIN Code *"
                          className="px-3 py-2 rounded-xl bg-white border border-slate-200 focus:border-[#0e7490] text-[#0f2430] outline-none tabular-nums"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={savingDelivery}
                          onClick={async () => {
                            setSavingDelivery(true);
                            setFeedback(null);
                            const res = await updateAdminOrderDelivery(
                              selectedOrder.id,
                              {
                                customer_name: deliveryDraft.customer_name,
                                customer_phone: deliveryDraft.customer_phone,
                                shipping_address: {
                                  line1: deliveryDraft.line1,
                                  line2: deliveryDraft.line2,
                                  city: deliveryDraft.city,
                                  state: deliveryDraft.state,
                                  pincode: deliveryDraft.pincode,
                                },
                              }
                            );
                            setSavingDelivery(false);
                            if (res.error) {
                              setFeedback({ type: 'err', text: res.error });
                              return;
                            }
                            setEditingDelivery(false);
                            setFeedback({
                              type: 'ok',
                              text: `Saved delivery details for ${selectedOrder.order_number}.`,
                            });
                            await onRefresh();
                          }}
                          className="px-4 py-2 rounded-full bg-[#0f2430] text-white text-xs font-semibold hover:bg-[#0e7490] transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {savingDelivery ? 'Saving...' : 'Save Delivery Details'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Ordered Items */}
                <div className="rounded-2xl bg-white border border-slate-200/80 overflow-hidden shadow-sm">
                  <div className="px-4 py-3 bg-[#f6fafb] border-b border-slate-200/80">
                    <span className="text-xs font-semibold text-[#0f2430]">
                      Ordered Items
                    </span>
                  </div>
                  <div className="divide-y divide-slate-200/70">
                    {(selectedOrder.order_items ?? []).map((item, idx) => {
                      const itemKey = item.id ?? `${item.product_id}-${idx}`;
                      return (
                        <div key={itemKey} className="p-4">
                          <div className="flex items-center gap-3.5">
                            <div className="w-12 h-16 rounded-xl bg-slate-100 border border-slate-200/80 overflow-hidden shrink-0">
                              {item.product_image && (
                                <img
                                  src={item.product_image}
                                  alt={item.product_name}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-[#0f2430] truncate">
                                {item.product_name}
                              </p>
                              <p className="text-[11px] text-[#607b87] mt-0.5 tabular-nums">
                                Size: {item.selected_size} &middot; Qty: {item.quantity}{' '}
                                &middot; {formatINR(item.unit_price_inr)} each
                              </p>
                            </div>
                            <p className="text-xs font-semibold text-[#0f2430] tabular-nums">
                              {formatINR(item.unit_price_inr * item.quantity)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Totals & Notes */}
                <div className="rounded-2xl bg-white border border-slate-200/80 p-4 space-y-2 text-xs shadow-sm">
                  <div className="flex justify-between text-[#607b87]">
                    <span>Payment Method</span>
                    <span className="font-semibold text-[#0f2430]">
                      {selectedOrder.payment_method === 'cod'
                        ? 'Cash on Delivery (COD)'
                        : 'Online Payment (Pending Verification)'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[#607b87] tabular-nums">
                    <span>Subtotal</span>
                    <span className="text-[#0f2430] font-medium">
                      {formatINR(selectedOrder.subtotal_inr)}
                    </span>
                  </div>
                  {(selectedOrder.discount_inr ?? 0) > 0 && (
                    <div className="flex justify-between text-emerald-700 font-medium tabular-nums">
                      <span>
                        Discount (
                        {selectedOrder.applied_coupon_code
                          ? `Coupon ${selectedOrder.applied_coupon_code}`
                          : selectedOrder.applied_offer_title || 'Offer'}
                        )
                      </span>
                      <span>&minus;{formatINR(selectedOrder.discount_inr ?? 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[#607b87] tabular-nums">
                    <span>Shipping</span>
                    <span className="text-[#0f2430] font-medium">
                      {selectedOrder.shipping_inr === 0
                        ? 'Complimentary'
                        : formatINR(selectedOrder.shipping_inr)}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2.5 border-t border-slate-200/80 text-sm font-bold text-[#0f2430] tabular-nums">
                    <span>Order Total</span>
                    <span>{formatINR(selectedOrder.total_inr)}</span>
                  </div>
                  {selectedOrder.notes && (
                    <div className="pt-2.5 border-t border-slate-200/80">
                      <span className="text-[11px] font-semibold text-[#607b87]">
                        Customer Note:
                      </span>
                      <p className="text-xs text-[#334e5a] mt-1">
                        {selectedOrder.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Cancellation Confirmation Modal */}
      <AnimatePresence>
        {cancelTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[60] bg-[#071c27]/60 backdrop-blur-[3px] flex items-center justify-center p-4"
            onClick={() => !cancelling && setCancelTarget(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm admin order cancellation"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.22, ease: ADMIN_EASE }}
              className="w-full max-w-lg rounded-[26px] bg-white text-[#0f2430] border border-white p-6 sm:p-7 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200/80">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-600">
                    Admin Order Cancellation
                  </p>
                  <h3 className="font-sans text-xl font-semibold text-[#0f2430] mt-1 tabular-nums">
                    Cancel {cancelTarget.order_number}?
                  </h3>
                </div>
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => setCancelTarget(null)}
                  aria-label="Close modal"
                  className="p-1.5 rounded-full text-[#607b87] hover:text-[#0f2430] hover:bg-slate-100 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-[#f4f8fa] border border-slate-200/80 space-y-1.5">
                  <p className="font-semibold text-[#0f2430]">
                    Customer: {cancelTarget.customer_name} ({cancelTarget.customer_email})
                  </p>
                  <p className="text-[#546e7a] tabular-nums">
                    Order Total:{' '}
                    <strong className="text-[#0f2430]">
                      {formatINR(cancelTarget.total_inr)}
                    </strong>{' '}
                    &middot; Current Status:{' '}
                    <strong className="capitalize text-[#0f2430]">
                      {cancelTarget.order_status}
                    </strong>
                  </p>
                  <p className="text-[11px] text-[#607b87]">
                    {cancelTarget.payment_status === 'paid'
                      ? 'Payment Handling: Paid online — will be marked "refund_pending" until provider confirms.'
                      : cancelTarget.payment_method === 'cod'
                        ? 'Payment Handling: COD — order will be marked cancelled without creating a refund.'
                        : 'Payment Handling: Pending online — reservation cancelled without refund.'}
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-2">
                  <p className="text-[11px] font-semibold text-amber-800">
                    Manual Inventory Notice
                  </p>
                  <p className="text-[11px] text-amber-900/80 leading-relaxed">
                    Cancelling an order does not automatically restore stock. Adjust
                    product stock manually in{' '}
                    <strong className="text-amber-950">Products</strong> if these items
                    return to inventory.
                  </p>
                  <ul className="space-y-1 text-[11px] text-[#0f2430] tabular-nums pt-2 border-t border-amber-200/70">
                    {(cancelTarget.order_items ?? []).map((item, idx) => (
                      <li key={item.id ?? idx} className="flex justify-between">
                        <span>
                          {item.product_name} (Size {item.selected_size})
                        </span>
                        <span className="font-semibold">&times; {item.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <form onSubmit={handleConfirmAdminCancel} className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#3c5662] mb-1.5">
                    Cancellation Reason (Optional)
                  </label>
                  <textarea
                    rows={2}
                    maxLength={300}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="e.g. Out of stock verification, customer requested via WhatsApp/email..."
                    className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-[#f4f8fa] border border-slate-200/90 focus:border-[#0e7490] focus:bg-white outline-none text-[#0f2430] placeholder:text-[#7c94a0]"
                  />
                </div>

                {cancelError && (
                  <p className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-xl p-3">
                    {cancelError}
                  </p>
                )}

                <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    disabled={cancelling}
                    onClick={() => setCancelTarget(null)}
                    className="px-5 py-2.5 rounded-full border border-slate-200 text-xs font-semibold text-[#546e7a] hover:text-[#0f2430] hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    Keep Order
                  </button>
                  <button
                    type="submit"
                    disabled={cancelling}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>
                      {cancelling ? 'Cancelling...' : 'Confirm Order Cancellation'}
                    </span>
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
