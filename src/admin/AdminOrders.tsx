import { useEffect, useMemo, useState } from 'react';
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
  cancelOrderAdmin,
  updateAdminOrder,
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

function orderStatusStyle(status: OrderStatus): string {
  switch (status) {
    case 'delivered':
      return 'border-[#2b6345] bg-[#ecfdf5] text-[#2b6345]';
    case 'cancelled':
      return 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]';
    case 'shipped':
    case 'packed':
      return 'border-[#d6c2a8] bg-[#f9f4ec] text-[#9a6746]';
    case 'confirmed':
      return 'border-[#24231f] bg-[#24231f] text-white';
    default:
      return 'border-[#e5dfd3] bg-[#f5f2eb] text-[#5f594f]';
  }
}

function paymentStatusStyle(status: PaymentStatus): string {
  switch (status) {
    case 'paid':
    case 'refunded':
      return 'border-[#2b6345] bg-[#ecfdf5] text-[#2b6345]';
    case 'refund_pending':
      return 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]';
    case 'failed':
    case 'cancelled':
      return 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]';
    default:
      return 'border-[#e5dfd3] bg-[#f5f2eb] text-[#5f594f]';
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
  products = [],
  loading,
  initialOrderId,
  onClearInitialOrder,
  onRefresh,
}: AdminOrdersProps) {
  const [search, setSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | OrderStatus>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | PaymentStatus>('all');
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
    return orders.filter((o) => {
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
      return matchOrderStatus && matchPaymentStatus && matchQuery;
    });
  }, [orders, search, orderStatusFilter, paymentStatusFilter]);

  const openOrderDrawer = (order: Order) => {
    setSelectedOrder(order);
    setEditOrderStatus(order.order_status);
    setEditPaymentStatus(order.payment_status);
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
      <div className="bg-[#fffdf8] border border-[#e5dfd3] p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-[#817b70] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order #, customer name, email..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
            />
          </div>

          <select
            value={orderStatusFilter}
            onChange={(e) =>
              setOrderStatusFilter(e.target.value as 'all' | OrderStatus)
            }
            aria-label="Filter by order status"
            className="px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b] capitalize"
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
            className="px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
          >
            <option value="all">All Payment Statuses</option>
            {PAYMENT_STATUSES.map((p) => (
              <option key={p} value={p}>
                {p.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <p className="text-[11px] text-[#817b70] tabular-nums">
          Showing <strong className="text-[#211f1b]">{filteredOrders.length}</strong> of{' '}
          {orders.length} orders
        </p>
      </div>

      {listNotice && (
        <div
          role="status"
          className={`p-3.5 border text-xs flex items-center gap-2.5 ${
            listNotice.type === 'err'
              ? 'bg-[#fef2f2] border-[#fecaca] text-[#b91c1c]'
              : 'bg-[#ecfdf5] border-[#a7f3d0] text-[#2b6345]'
          }`}
        >
          {listNotice.type === 'err' ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span>{listNotice.text}</span>
        </div>
      )}

      {/* Orders Table */}
      <div className="bg-[#fffdf8] border border-[#e5dfd3] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs text-[#817b70]">
            Loading customer orders from Supabase...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-serif-display text-2xl text-[#211f1b]">
              No matching orders
            </p>
            <p className="text-xs text-[#817b70] mt-1.5">
              {orders.length === 0
                ? 'Customer orders placed through checkout will appear here.'
                : 'Try adjusting your order number search or status filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#e5dfd3] bg-[#f5f2eb]/50 text-[10px] tracking-[0.16em] uppercase text-[#817b70]">
                  <th className="py-3.5 px-4 font-semibold">Order #</th>
                  <th className="py-3.5 px-3 font-semibold">Date</th>
                  <th className="py-3.5 px-3 font-semibold">Customer</th>
                  <th className="py-3.5 px-3 font-semibold">Items</th>
                  <th className="py-3.5 px-3 font-semibold">Payment</th>
                  <th className="py-3.5 px-3 font-semibold">Order Status</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5dfd3] text-xs">
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
                      className="hover:bg-[#f5f2eb]/50 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-4 font-semibold text-[#211f1b] tabular-nums whitespace-nowrap">
                        {order.order_number}
                      </td>
                      <td className="py-3.5 px-3 text-[#5f594f] tabular-nums whitespace-nowrap">
                        {formatDateTime(order.created_at)}
                      </td>
                      <td className="py-3.5 px-3">
                        <p className="font-medium text-[#211f1b]">
                          {order.customer_name}
                        </p>
                        <p className="text-[11px] text-[#817b70]">
                          {order.customer_email}
                        </p>
                      </td>
                      <td className="py-3.5 px-3 text-[#5f594f] tabular-nums whitespace-nowrap">
                        {itemCount} {itemCount === 1 ? 'item' : 'items'}
                      </td>
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5f594f]">
                            {order.payment_method === 'cod' ? 'COD' : 'Online'}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[10px] tracking-[0.1em] uppercase font-semibold border ${paymentStatusStyle(
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
                            className={`px-2.5 py-1 text-[10px] tracking-[0.12em] uppercase font-semibold border ${orderStatusStyle(
                              order.order_status
                            )}`}
                          >
                            {order.order_status}
                          </span>
                          {order.order_status === 'cancelled' && order.cancelled_by && (
                            <span className="text-[10px] text-[#817b70] capitalize">
                              By {order.cancelled_by}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-semibold text-[#211f1b] tabular-nums whitespace-nowrap">
                        {formatINR(order.total_inr)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Inspection Slide-Over Drawer */}
      {selectedOrder && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex justify-end"
          onClick={() => setSelectedOrder(null)}
        >
          <aside
            className="w-full max-w-xl bg-[#fffdf8] h-full overflow-y-auto border-l border-[#e5dfd3] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-[#e5dfd3] flex items-center justify-between sticky top-0 bg-[#fffdf8] z-10">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#9a6746] font-bold">
                  Order Details
                </p>
                <h3 className="font-serif-display text-2xl text-[#211f1b] tabular-nums">
                  {selectedOrder.order_number}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                aria-label="Close order details"
                className="p-2 text-[#817b70] hover:text-[#211f1b] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 flex-1">
              <p className="text-xs text-[#817b70] tabular-nums">
                Placed on {formatDateTime(selectedOrder.created_at)}
              </p>

              {/* Cancellation Audit Card (Shown when Cancelled) */}
              {selectedOrder.order_status === 'cancelled' && (
                <div className="bg-[#fef2f2] border border-[#fecaca] p-4 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[10px] tracking-[0.16em] uppercase font-bold text-[#b91c1c]">
                      Order Cancelled &middot; Initiated by{' '}
                      {selectedOrder.cancelled_by === 'customer'
                        ? 'Customer'
                        : selectedOrder.cancelled_by === 'admin'
                          ? 'Admin'
                          : 'System'}
                    </span>
                    {selectedOrder.cancelled_at && (
                      <span className="text-[11px] text-[#7f1d1d] tabular-nums">
                        {formatDateTime(selectedOrder.cancelled_at)}
                      </span>
                    )}
                  </div>
                  <p className="text-[#7f1d1d]">
                    {getAdminRefundSummary(selectedOrder)}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#5f594f] pt-1">
                    <span>
                      Inventory Handling:{' '}
                      <strong className="text-[#211f1b]">
                        {selectedOrder.stock_restoration_status === 'restored' ||
                        selectedOrder.stock_restored
                          ? 'Restored (Historical)'
                          : 'Manual — Update stock in Admin → Products'}
                      </strong>
                    </span>
                    <span>
                      Reason:{' '}
                      <strong className="text-[#211f1b]">
                        {selectedOrder.cancellation_reason || 'No reason provided'}
                      </strong>
                    </span>
                  </div>
                </div>
              )}

              {/* Status Controls */}
              <div className="bg-[#f5f2eb] border border-[#e5dfd3] p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PackageCheck className="w-4 h-4 text-[#9a6746]" />
                    <h4 className="text-[11px] tracking-[0.16em] uppercase font-bold text-[#211f1b]">
                      Update Fulfillment &amp; Payment Status
                    </h4>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] tracking-[0.14em] uppercase text-[#5f594f] mb-1">
                      Order Status
                    </label>
                    {selectedOrder.order_status === 'cancelled' ? (
                      <div className="px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] text-[#b91c1c] font-semibold uppercase tracking-wider">
                        Cancelled
                      </div>
                    ) : (
                      <select
                        value={editOrderStatus}
                        onChange={(e) =>
                          setEditOrderStatus(e.target.value as OrderStatus)
                        }
                        className="w-full px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] outline-none text-[#211f1b] capitalize"
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
                    <label className="block text-[10px] tracking-[0.14em] uppercase text-[#5f594f] mb-1">
                      Payment Status
                    </label>
                    <select
                      value={editPaymentStatus}
                      onChange={(e) =>
                        setEditPaymentStatus(e.target.value as PaymentStatus)
                      }
                      className="w-full px-3 py-2 text-xs bg-[#fffdf8] border border-[#e5dfd3] outline-none text-[#211f1b]"
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
                    className={`text-xs p-2.5 border ${
                      feedback.type === 'err'
                        ? 'bg-[#fef2f2] border-[#fecaca] text-[#b91c1c]'
                        : 'bg-[#ecfdf5] border-[#a7f3d0] text-[#2b6345]'
                    }`}
                  >
                    {feedback.text}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveOrderUpdate}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#24231f] text-white text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#9a6746] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{saving ? 'Updating...' : 'Save Order Status'}</span>
                  </button>

                  {isAdminCancellable(selectedOrder) && (
                    <button
                      type="button"
                      onClick={() => openCancelDialog(selectedOrder)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-[#b91c1c] text-[#b91c1c] text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#b91c1c] hover:text-white transition-colors cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Cancel Order</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Customer & Shipping Address */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-[#e5dfd3] p-4">
                  <div className="flex items-center gap-2 text-[#9a6746] mb-2">
                    <User className="w-3.5 h-3.5" />
                    <span className="text-[10px] tracking-[0.16em] uppercase font-bold">
                      Customer
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-[#211f1b]">
                    {selectedOrder.customer_name}
                  </p>
                  <p className="text-xs text-[#5f594f] mt-1">
                    {selectedOrder.customer_email}
                  </p>
                  <p className="text-xs text-[#5f594f] mt-0.5 tabular-nums">
                    {selectedOrder.customer_phone}
                  </p>
                </div>

                <div className="border border-[#e5dfd3] p-4">
                  <div className="flex items-center gap-2 text-[#9a6746] mb-2">
                    <MapPin className="w-3.5 h-3.5" />
                    <span className="text-[10px] tracking-[0.16em] uppercase font-bold">
                      Shipping Address
                    </span>
                  </div>
                  <p className="text-xs text-[#211f1b] leading-relaxed">
                    {selectedOrder.shipping_address.line1}
                    {selectedOrder.shipping_address.line2
                      ? `, ${selectedOrder.shipping_address.line2}`
                      : ''}
                    <br />
                    {selectedOrder.shipping_address.city},{' '}
                    {selectedOrder.shipping_address.state} &ndash;{' '}
                    <span className="tabular-nums">
                      {selectedOrder.shipping_address.pincode}
                    </span>
                  </p>
                </div>
              </div>

              {/* Ordered Items */}
              <div className="border border-[#e5dfd3]">
                <div className="px-4 py-3 bg-[#f5f2eb]/60 border-b border-[#e5dfd3]">
                  <span className="text-[10px] tracking-[0.16em] uppercase font-bold text-[#211f1b]">
                    Ordered Items
                  </span>
                </div>
                <div className="divide-y divide-[#e5dfd3]">
                  {(selectedOrder.order_items ?? []).map((item, idx) => {
                    const itemKey = item.id ?? `${item.product_id}-${idx}`;
                    return (
                      <div key={itemKey} className="p-4">
                        <div className="flex items-center gap-3.5">
                          <div className="w-12 h-16 bg-[#e9e3d8] overflow-hidden shrink-0">
                            {item.product_image && (
                              <img
                                src={item.product_image}
                                alt={item.product_name}
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-[#211f1b] truncate">
                              {item.product_name}
                            </p>
                            <p className="text-[11px] text-[#817b70] mt-0.5 tabular-nums">
                              Size: {item.selected_size} &middot; Qty: {item.quantity}{' '}
                              &middot; {formatINR(item.unit_price_inr)} each
                            </p>
                          </div>
                          <p className="text-xs font-semibold text-[#211f1b] tabular-nums">
                            {formatINR(item.unit_price_inr * item.quantity)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Totals & Notes */}
              <div className="border border-[#e5dfd3] p-4 space-y-2 text-xs">
                <div className="flex justify-between text-[#5f594f]">
                  <span>Payment Method</span>
                  <span className="font-semibold text-[#211f1b] uppercase">
                    {selectedOrder.payment_method === 'cod'
                      ? 'Cash on Delivery (COD)'
                      : 'Online Payment (Pending Verification)'}
                  </span>
                </div>
                <div className="flex justify-between text-[#5f594f] tabular-nums">
                  <span>Subtotal</span>
                  <span>{formatINR(selectedOrder.subtotal_inr)}</span>
                </div>
                <div className="flex justify-between text-[#5f594f] tabular-nums">
                  <span>Shipping</span>
                  <span>
                    {selectedOrder.shipping_inr === 0
                      ? 'Complimentary'
                      : formatINR(selectedOrder.shipping_inr)}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[#e5dfd3] text-sm font-bold text-[#211f1b] tabular-nums">
                  <span>Order Total</span>
                  <span>{formatINR(selectedOrder.total_inr)}</span>
                </div>
                {selectedOrder.notes && (
                  <div className="pt-2 border-t border-[#e5dfd3]">
                    <span className="text-[10px] tracking-[0.14em] uppercase font-bold text-[#817b70]">
                      Customer Note:
                    </span>
                    <p className="text-xs text-[#211f1b] mt-1">
                      {selectedOrder.notes}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Admin Cancellation Confirmation Modal */}
      {cancelTarget && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => !cancelling && setCancelTarget(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm admin order cancellation"
        >
          <div
            className="w-full max-w-lg bg-[#fffdf8] border border-[#e5dfd3] p-6 sm:p-7 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#e5dfd3]">
              <div>
                <p className="text-[10px] tracking-[0.2em] uppercase text-[#b91c1c] font-bold">
                  Admin Order Cancellation
                </p>
                <h3 className="font-serif-display text-2xl text-[#211f1b] mt-1 tabular-nums">
                  Cancel {cancelTarget.order_number}?
                </h3>
              </div>
              <button
                type="button"
                disabled={cancelling}
                onClick={() => setCancelTarget(null)}
                aria-label="Close modal"
                className="p-1.5 text-[#817b70] hover:text-[#211f1b] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="p-3.5 bg-[#f5f2eb] border border-[#e5dfd3] space-y-1.5">
                <p className="font-semibold text-[#211f1b]">
                  Customer: {cancelTarget.customer_name} ({cancelTarget.customer_email})
                </p>
                <p className="text-[#5f594f] tabular-nums">
                  Order Total: <strong className="text-[#211f1b]">{formatINR(cancelTarget.total_inr)}</strong> &middot;{' '}
                  Current Status: <strong className="capitalize">{cancelTarget.order_status}</strong>
                </p>
                <p className="text-[11px] text-[#5f594f]">
                  {cancelTarget.payment_status === 'paid'
                    ? 'Payment Handling: Paid online — will be marked "refund_pending" until provider confirms.'
                    : cancelTarget.payment_method === 'cod'
                      ? 'Payment Handling: COD — order will be marked cancelled without creating a refund.'
                      : 'Payment Handling: Pending online — reservation cancelled without refund.'}
                </p>
              </div>

              <div className="border border-[#e5dfd3] p-3 space-y-2">
                <p className="text-[10px] tracking-[0.14em] uppercase font-bold text-[#817b70]">
                  Manual Inventory Notice
                </p>
                <p className="text-[11px] text-[#5f594f] leading-relaxed">
                  Cancelling an order does not automatically restore stock. Adjust product stock manually in <strong className="text-[#211f1b]">Products</strong> if these items return to inventory.
                </p>
                <ul className="space-y-1 text-[11px] text-[#211f1b] tabular-nums pt-1 border-t border-[#e5dfd3]">
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
                <label className="block text-[10px] tracking-[0.14em] uppercase font-semibold text-[#5f594f] mb-1.5">
                  Cancellation Reason (Optional)
                </label>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Out of stock verification, customer requested via WhatsApp/email..."
                  className="w-full px-3.5 py-2.5 text-xs bg-[#f5f2eb]/60 border border-[#e5dfd3] focus:border-[#9a6746] outline-none text-[#211f1b]"
                />
              </div>

              {cancelError && (
                <p className="text-xs text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] p-3">
                  {cancelError}
                </p>
              )}

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => setCancelTarget(null)}
                  className="px-5 py-2.5 border border-[#e5dfd3] text-[10px] tracking-[0.16em] uppercase font-semibold text-[#5f594f] hover:text-[#211f1b] cursor-pointer disabled:opacity-50"
                >
                  Keep Order
                </button>
                <button
                  type="submit"
                  disabled={cancelling}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#b91c1c] text-white text-[10px] tracking-[0.16em] uppercase font-semibold hover:bg-[#991b1b] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>{cancelling ? 'Cancelling...' : 'Confirm Order Cancellation'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
